/**
 * Concept-extraction phase (Phase 1) for the compilation pipeline.
 *
 * Owns the single responsibility of turning source files into
 * {@link ExtractionResult}s via the LLM: reading each source, sending it (with
 * the confined wiki index as dedup context) to the extraction model, and
 * fanning the batch out under a shared concurrency limit with per-source
 * recovery. Expands the directly-changed batch to any unchanged sources
 * whose concepts overlap newly-extracted slugs. No pages are written here — the
 * results feed the page-generation phase in the orchestration spine.
 */

import { readFile } from "fs/promises";
import path from "path";
import {
  readConfinedWikiFile,
  warnDroppedWikiReadIfPresent,
} from "./confined-wiki-read.js";
import { callClaude } from "../utils/llm.js";
import {
  CONCEPT_EXTRACTION_TOOL,
  buildExtractionPrompt,
  parseConcepts,
} from "./prompts.js";
import {
  findLateAffectedSources,
  type ExtractionResult,
} from "./deps.js";
import {
  extractionFingerprint,
  loadExtractionCheckpoint,
  saveExtractionCheckpoint,
  saveExtractionFailure,
} from "./extraction-checkpoints.js";
import * as output from "../utils/output.js";
import { verbose } from "../utils/output.js";
import { INDEX_FILE, SOURCES_DIR } from "../utils/constants.js";
import pLimit from "p-limit";
import type {
  ExtractedConcept,
  SourceChange,
  WikiState,
} from "../utils/types.js";

interface ExtractionContext {
  root: string;
  existingIndex: string;
  limit: ReturnType<typeof pLimit>;
}

type ExtractionAttempt =
  | { file: string; result: ExtractionResult }
  | { file: string; error: unknown };

/** Infrastructure errors cannot improve by repeating the same source. */
function isNonRetryable(error: unknown): boolean {
  return (error as { nonRetryable?: unknown })?.nonRetryable === true;
}

/** Narrow an attempt to its failure branch. */
function isFailedAttempt(item: ExtractionAttempt): item is { file: string; error: unknown } {
  return "error" in item;
}

/** Run one source without allowing its failure to reject the whole batch. */
async function attemptSource(context: ExtractionContext, file: string): Promise<ExtractionAttempt> {
  return context.limit(async () => {
    try {
      return { file, result: await extractForSource(context.root, file, context.existingIndex) };
    } catch (error) {
      return { file, error };
    }
  });
}

/** Extract every file in input order while all provider calls settle. */
function attemptRound(context: ExtractionContext, files: string[]): Promise<ExtractionAttempt[]> {
  return Promise.all(files.map((file) => attemptSource(context, file)));
}

/** Materialize a final failed source so downstream state marks it retryable. */
async function failedResult(root: string, file: string, error: unknown): Promise<ExtractionResult> {
  const sourcePath = path.join(root, SOURCES_DIR, file);
  const sourceContent = await readFile(sourcePath, "utf-8");
  const message = error instanceof Error ? error.message : String(error);
  return {
    sourceFile: file,
    sourcePath,
    sourceContent,
    concepts: [],
    error: message,
    fatalError: isNonRetryable(error)
      ? (error instanceof Error ? error : new Error(message))
      : undefined,
  };
}

/** Convert settled attempts to ordered extraction results. */
function materializeAttempts(
  root: string,
  files: string[],
  attempts: Map<string, ExtractionAttempt>,
): Promise<ExtractionResult[]> {
  return Promise.all(files.map(async (file) => {
    const item = attempts.get(file)!;
    return isFailedAttempt(item) ? failedResult(root, file, item.error) : item.result;
  }));
}

/** Retry only first-round failures, then return one ordered result per file. */
async function extractSourcesRecoverable(
  context: ExtractionContext,
  files: string[],
): Promise<ExtractionResult[]> {
  const first = await attemptRound(context, files);
  const byFile = new Map<string, ExtractionAttempt>();
  for (const item of first) byFile.set(item.file, item);
  const failedFiles = first
    .filter(isFailedAttempt)
    .filter((item) => !isNonRetryable(item.error))
    .map((item) => item.file);
  if (failedFiles.length === 0) return materializeAttempts(context.root, files, byFile);
  output.status("↻", output.warn(`Retrying ${failedFiles.length} failed source extraction(s)...`));
  const retried = await attemptRound(context, failedFiles);
  for (const item of retried) byFile.set(item.file, item);
  return materializeAttempts(context.root, files, byFile);
}

/**
 * The two views a compile has of its own changes. They answer different
 * questions and are NOT interchangeable, so they travel as one named pair
 * rather than as two same-typed positional arguments that can be swapped.
 */
export interface ChangeSets {
  /** What this run acts on, after any `changeFilter`. */
  scoped: SourceChange[];
  /** Everything found on disk, before any `changeFilter`. */
  detected: SourceChange[];
}

/**
 * Phase 1: extract concepts for the directly-changed batch, then repeatedly
 * expand to unchanged sources whose concepts overlap newly extracted slugs.
 * Every batch shares one `pLimit(concurrency)` cap. Discovery continues to a
 * fixed point because a late owner's extraction can reveal another owner that
 * was absent from its prior state entry.
 */
export async function runExtractionPhases(
  root: string,
  toCompile: SourceChange[],
  state: WikiState,
  changeSets: ChangeSets,
  concurrency: number,
): Promise<ExtractionResult[]> {
  const limit = pLimit(concurrency);
  const existingIndex = await readConfinedExtractionIndex(root);
  const context = { root, existingIndex, limit };
  const extractions = await extractSourcesRecoverable(context, toCompile.map((c) => c.file));

  while (true) {
    const extracted = new Set(extractions.map((result) => result.sourceFile));
    const lateAffected = findLateAffectedSources(
      extractions, state, changeSets.scoped, extracted, changeSets.detected,
    );
    if (lateAffected.length === 0) break;
    for (const file of lateAffected) {
      output.status("~", output.info(`${file} [shares concept with new source]`));
    }
    const batch = await extractSourcesRecoverable(context, lateAffected);
    extractions.push(...batch);
  }

  return extractions;
}

/**
 * Phase 1: Extract concepts from a source without generating pages.
 * Returns extraction data for the generation phase.
 */
async function extractForSource(
  root: string,
  sourceFile: string,
  existingIndex: string,
): Promise<ExtractionResult> {
  output.status("*", output.info(`Extracting: ${sourceFile}`));

  const sourcePath = path.join(root, SOURCES_DIR, sourceFile);
  const sourceContent = await readFile(sourcePath, "utf-8");
  const lines = sourceContent.split("\n").length;
  const chars = sourceContent.length;
  verbose(`source ${sourceFile}: ${lines} lines, ${chars} chars`);
  const system = buildExtractionPrompt(sourceContent, existingIndex);
  const fingerprint = extractionFingerprint(system, CONCEPT_EXTRACTION_TOOL);
  const cached = await loadExtractionCheckpoint(root, sourceFile, fingerprint);
  const cachedConcepts = cached === null ? [] : parseConcepts(cached);
  if (cachedConcepts.length > 0) {
    output.status("↳", output.dim(`Reusing extraction checkpoint: ${sourceFile}`));
    reportConcepts(cachedConcepts);
    return { sourceFile, sourcePath, sourceContent, concepts: cachedConcepts };
  }
  const rawOutput = await extractConcepts(system).catch(async (error: unknown) => {
    await saveExtractionFailure(root, sourceFile, fingerprint, error);
    throw error;
  });
  const concepts = parseConcepts(rawOutput);
  if (concepts.length === 0) {
    const error = new Error("structured extraction returned no valid concepts");
    await saveExtractionFailure(root, sourceFile, fingerprint, error);
    throw error;
  }
  await saveExtractionCheckpoint(root, sourceFile, fingerprint, rawOutput);

  reportConcepts(concepts);
  return { sourceFile, sourcePath, sourceContent, concepts };
}

/** Print one successful extraction in the existing CLI format. */
function reportConcepts(concepts: ExtractedConcept[]): void {
  const names = concepts.map((concept) => concept.concept).join(", ");
  output.status("*", output.dim(`  Found ${concepts.length} concepts: ${names}`));
}

/**
 * Read `wiki/index.md` through the confined helper for the EXTRACTION prompt.
 * The index bytes are sent to the extraction LLM as dedup context, so a
 * symlinked `wiki/index.md` whose target escapes the project root is dropped
 * (warned, skipped) and extraction proceeds with an EMPTY index — its
 * out-of-tree bytes never reach the provider. An absent index yields an empty
 * string, byte-identical to before.
 *
 * This is the fixed-file (`readConfinedWikiFile`) twin of the per-page
 * `readWikiPageContentOrWarn(..., warnAlways=false)` policy: absence is normal,
 * so the drop warning fires only when the file physically exists.
 */
async function readConfinedExtractionIndex(root: string): Promise<string> {
  const result = await readConfinedWikiFile(root, INDEX_FILE);
  if ("content" in result) return result.content;
  // An absent index shares the escapes-dir reason; warn only when index.md
  // physically exists (an escaping symlink or a fail-closed read).
  await warnDroppedWikiReadIfPresent(path.join(root, INDEX_FILE), INDEX_FILE, result.dropped);
  return "";
}

/**
 * Call Claude to extract concepts from a source document.
 * @param sourceContent - Full source document text.
 * @param existingIndex - Current wiki index for deduplication.
 * @returns Parsed array of extracted concepts.
 */
async function extractConcepts(system: string): Promise<string> {
  return callClaude({
    system,
    messages: [{ role: "user", content: "Extract the key concepts from this source." }],
    tools: [CONCEPT_EXTRACTION_TOOL],
  });
}
