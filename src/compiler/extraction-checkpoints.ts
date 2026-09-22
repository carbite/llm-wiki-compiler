/**
 * Durable per-source checkpoints for concept extraction.
 *
 * Extraction can take hours across a large source set. A successful response is
 * atomically recorded under `.llmwiki/extraction-checkpoints/` before the next
 * source starts, so a later provider/process failure does not discard it. Each
 * record is bound to the exact prompt, provider and model through a fingerprint;
 * stale records are ignored rather than trusted. Failures use the same per-source
 * record so operators can see what remains retryable without a shared-file race.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { atomicWrite } from "../utils/atomic-write.js";
import { readConfinedLeaf } from "../utils/confined-read.js";
import {
  EXTRACTION_CHECKPOINTS_DIR,
  MAX_EXTRACTION_CHECKPOINT_BYTES,
} from "../utils/constants.js";
import { getActiveProviderName, resolveActiveModelId } from "../utils/provider.js";

const CHECKPOINT_VERSION = 1;
const MAX_ERROR_CHARS = 2_000;

interface CheckpointBase {
  version: typeof CHECKPOINT_VERSION;
  sourceFile: string;
  fingerprint: string;
  updatedAt: string;
}

interface SuccessCheckpoint extends CheckpointBase {
  status: "success";
  rawOutput: string;
}

interface FailureCheckpoint extends CheckpointBase {
  status: "failure";
  error: string;
}

type ExtractionCheckpoint = SuccessCheckpoint | FailureCheckpoint;

/** Hash arbitrary text without exposing source or prompt bytes in filenames. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable safe filename for a source path, including recursive source names. */
function checkpointLeaf(root: string, sourceFile: string): string {
  return path.join(root, EXTRACTION_CHECKPOINTS_DIR, `${sha256(sourceFile)}.json`);
}

/** The lexical checkpoint directory used as the confined read expectation. */
function checkpointDir(root: string): string {
  return path.join(root, EXTRACTION_CHECKPOINTS_DIR);
}

/** Return a record only for a plain JSON object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Check the common checkpoint envelope fields. */
function hasCheckpointBase(record: Record<string, unknown>): boolean {
  return record.version === CHECKPOINT_VERSION &&
    typeof record.sourceFile === "string" &&
    typeof record.fingerprint === "string" &&
    typeof record.updatedAt === "string";
}

/** Check the bounded parsed value has the checkpoint envelope we consume. */
function isCheckpoint(value: unknown): value is ExtractionCheckpoint {
  const record = asRecord(value);
  if (!record || !hasCheckpointBase(record)) return false;
  const success = record.status === "success" && typeof record.rawOutput === "string";
  const failure = record.status === "failure" && typeof record.error === "string";
  return success || failure;
}

/** Read a record through the root-confined, no-follow bounded reader. */
async function readCheckpoint(root: string, sourceFile: string): Promise<ExtractionCheckpoint | null> {
  const read = await readConfinedLeaf(
    root,
    checkpointLeaf(root, sourceFile),
    checkpointDir(root),
    MAX_EXTRACTION_CHECKPOINT_BYTES,
  );
  if (read.kind !== "ok") return null;
  try {
    const parsed: unknown = JSON.parse(read.body);
    return isCheckpoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write one bounded record atomically inside the project root. */
async function writeCheckpoint(root: string, sourceFile: string, record: ExtractionCheckpoint): Promise<void> {
  const body = JSON.stringify(record);
  if (Buffer.byteLength(body) > MAX_EXTRACTION_CHECKPOINT_BYTES) {
    throw new Error(`extraction checkpoint exceeds ${MAX_EXTRACTION_CHECKPOINT_BYTES} bytes`);
  }
  await atomicWrite(checkpointLeaf(root, sourceFile), body, {
    confineRoot: root,
    durable: true,
    mode: 0o600,
  });
}

/** Bind a checkpoint to every input that can alter structured extraction. */
export function extractionFingerprint(systemPrompt: string, toolSchema: unknown): string {
  return sha256(JSON.stringify({
    provider: getActiveProviderName(),
    model: resolveActiveModelId(),
    systemPrompt,
    toolSchema,
  }));
}

/** Return a matching successful raw response, ignoring stale/failure records. */
export async function loadExtractionCheckpoint(
  root: string,
  sourceFile: string,
  fingerprint: string,
): Promise<string | null> {
  const record = await readCheckpoint(root, sourceFile);
  if (record?.status !== "success" || record.fingerprint !== fingerprint) return null;
  return record.rawOutput;
}

/** Atomically retain a successful structured response before later phases run. */
export async function saveExtractionCheckpoint(
  root: string,
  sourceFile: string,
  fingerprint: string,
  rawOutput: string,
): Promise<void> {
  await writeCheckpoint(root, sourceFile, {
    version: CHECKPOINT_VERSION,
    status: "success",
    sourceFile,
    fingerprint,
    rawOutput,
    updatedAt: new Date().toISOString(),
  });
}

/** Persist a bounded diagnostic for a source whose extraction remains retryable. */
export async function saveExtractionFailure(
  root: string,
  sourceFile: string,
  fingerprint: string,
  error: unknown,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
  await writeCheckpoint(root, sourceFile, {
    version: CHECKPOINT_VERSION,
    status: "failure",
    sourceFile,
    fingerprint,
    error: message,
    updatedAt: new Date().toISOString(),
  });
}
