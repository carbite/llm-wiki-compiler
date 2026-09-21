/**
 * Shared engine for local agent-CLI-backed LLM providers.
 *
 * Codex CLI and TraeCode CLI expose the same non-interactive `exec` contract:
 * a read-only, ephemeral run in a throwaway directory that reads one prompt on
 * stdin and writes its final message to `--output-last-message`, optionally
 * constrained by `--output-schema`. This module implements that boundary once,
 * parameterized by a {@link CliAgentConfig} (binary name plus the labels that
 * make every failure name the right CLI). The concrete providers in
 * `codex-agent.ts` and `trae-agent.ts` are thin configs over it.
 *
 * Every request launches a fresh child in an empty throwaway directory. The
 * child is ephemeral, read-only sandboxed, non-interactive, and receives only a
 * small environment allowlist needed to locate the CLI and its locally managed
 * login. llmwiki never opens the CLI's credential files or forwards API-key
 * environment variables.
 */

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { openFileNoFollow } from "../utils/no-follow-open.js";
import { tmpdir } from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { toCodexOutputSchema } from "./codex-output-schema.js";
import type { LLMMessage, LLMProvider, LLMTool } from "../utils/provider.js";
import { registerCodexProcess, signalCodexTree } from "./codex-agent-lifecycle.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TERMINATE_GRACE_MS = 1_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const OUTPUT_FILE = "last-message.txt";
const SCHEMA_FILE = "output-schema.json";

/**
 * Default environment allowlist. Deliberately small: only what the CLI needs to
 * locate itself, resolve TLS, and honour an egress proxy. `CODEX_HOME` and
 * `TRAE_HOME` are both included so either CLI's locally managed login is
 * reachable; an unset one is simply never copied.
 */
const DEFAULT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "CODEX_HOME",
  "TRAE_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Preserve the operator's network route when the host requires an egress proxy.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
] as const;

const ajv = new Ajv({ allErrors: true, strict: false });

/** The CLI-specific identity and wording an agent provider is built from. */
export interface CliAgentConfig {
  /** Executable name resolved on PATH, e.g. "codex" or "trae-cli". */
  binaryName: string;
  /** Human-facing CLI name used in every diagnostic, e.g. "Codex CLI". */
  displayName: string;
  /** Product phrase for the install hint, e.g. "the OpenAI Codex CLI". */
  installProduct: string;
  /** Login command shown when auth fails, e.g. "codex login". */
  loginCommand: string;
  /** Noun phrase for "check the local ... installation" messages. */
  installNoun: string;
  /** Minimum verified compatible CLI version, surfaced on arg-incompatibility. */
  minVersion: string;
  /** LLMWIKI_PROVIDER name this config backs, e.g. "codex-agent" or "trae". */
  providerName: string;
  /** Environment variables copied into the child; defaults to {@link DEFAULT_ENV_ALLOWLIST}. */
  envAllowlist?: readonly string[];
}

/** Testable resource bounds; production uses the secure defaults above. */
export interface CliAgentProviderOptions {
  timeoutMs?: number;
  terminateGraceMs?: number;
  maxOutputBytes?: number;
}

/**
 * Provider failure surfaced to the shared retry loop.
 *
 * Infrastructure failures (missing binary, auth, incompatible flags, timeout,
 * output cap) are `nonRetryable`: retrying the same call cannot help. Output-shape
 * failures (malformed JSON, schema-invalid JSON, no readable final message) are
 * retryable — they are a transient slip of a model that mostly, but not always,
 * honours `--output-schema`, and the shared backoff loop lets the identical
 * request succeed on a later attempt instead of failing an entire compile.
 */
class CliAgentError extends Error {
  readonly nonRetryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "CliAgentError";
    this.nonRetryable = options.retryable !== true;
  }
}

/** Report the required local dependency without exposing lookup internals. */
function missingError(config: CliAgentConfig): CliAgentError {
  return new CliAgentError(
    `${config.displayName} is not installed or is unavailable on PATH. ` +
      `Install ${config.installProduct}, run \`${config.loginCommand}\`, and retry.`,
  );
}

interface ProcessResult {
  code: number;
  stderr: string;
}

type TerminationReason = "timeout" | "output-limit";

interface ProcessState {
  stderr: string;
  stderrBytes: number;
  reason?: TerminationReason;
  timeout: NodeJS.Timeout;
  forceTimer?: NodeJS.Timeout;
}

/** Render system and conversation roles into one stdin-only request. */
function buildPrompt(system: string, messages: LLMMessage[], structured = false): string {
  const conversation = messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
  const outputRule = structured
    ? "Return only one JSON value matching the supplied output schema."
    : "Return only the requested final content, without commentary or a Markdown fence.";
  return [
    "Fulfill this single llmwiki language-model request without inspecting files or using tools.",
    outputRule,
    "",
    "System instructions:",
    system,
    "",
    "Conversation:",
    conversation,
  ].join("\n");
}

/** Construct the complete, deliberately small child environment. */
function childEnvironment(allowlist: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const name of allowlist) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  if (env.PATH && process.platform !== "win32") env.PATH = interpreterSafePath(env.PATH);
  return env;
}

/** Keep env-based Node shebangs away from wrappers that synthesize variables. */
function interpreterSafePath(searchPath: string): string {
  const runtimeDirectory = path.dirname(process.execPath);
  const directories = searchPath.split(path.delimiter)
    .filter((directory) => directory && directory !== runtimeDirectory);
  return [runtimeDirectory, ...directories].join(path.delimiter);
}

/** Select the CLI before changing interpreter lookup, preserving PATH precedence. */
function resolveExecutable(searchPath: string | undefined, config: CliAgentConfig): string {
  if (process.platform === "win32") return config.binaryName;
  if (!searchPath) throw missingError(config);
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, config.binaryName);
    try {
      accessSync(candidate, fsConstants.X_OK);
      if (!statSync(candidate).isFile()) continue;
      return candidate;
    } catch {
      // Continue through eligible entries in the original PATH order.
    }
  }
  throw missingError(config);
}

/** Retain child diagnostics while enforcing their byte ceiling. */
function captureStderr(state: ProcessState, chunk: Buffer, limit: number): boolean {
  state.stderrBytes += chunk.byteLength;
  if (state.stderrBytes > limit) return false;
  state.stderr += chunk.toString("utf8");
  return true;
}

/** Resolve or reject one child based on how it terminated. */
function finishProcess(
  code: number | null,
  state: ProcessState,
  options: Required<CliAgentProviderOptions>,
  config: CliAgentConfig,
  resolve: (result: ProcessResult) => void,
  reject: (error: Error) => void,
): void {
  clearTimeout(state.timeout);
  if (state.forceTimer) clearTimeout(state.forceTimer);
  if (state.reason === "timeout") {
    reject(new CliAgentError(`${config.displayName} timed out after ${options.timeoutMs}ms.`));
  } else if (state.reason === "output-limit") {
    reject(new CliAgentError(`${config.displayName} exceeded the ${options.maxOutputBytes}-byte output limit.`));
  } else {
    resolve({ code: code ?? 1, stderr: state.stderr });
  }
}

/** Spawn one bounded child, escalating SIGTERM to SIGKILL when needed. */
function runAgent(
  args: string[],
  cwd: string,
  prompt: string,
  options: Required<CliAgentProviderOptions>,
  config: CliAgentConfig,
  retainCustody: (release: () => void) => void,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const executable = resolveExecutable(process.env.PATH, config);
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      env: childEnvironment(config.envAllowlist ?? DEFAULT_ENV_ALLOWLIST),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const state: ProcessState = {
      stderr: "",
      stderrBytes: 0,
      timeout: setTimeout(() => terminate("timeout"), options.timeoutMs),
    };
    retainCustody(registerCodexProcess(child, cwd, options.terminateGraceMs));
    function terminate(reason: TerminationReason): void {
      if (state.reason) return;
      state.reason = reason;
      signalCodexTree(child, "SIGTERM");
      state.forceTimer = setTimeout(
        () => signalCodexTree(child, "SIGKILL"),
        options.terminateGraceMs,
      );
    }
    const capture = (chunk: Buffer): void => {
      if (!captureStderr(state, chunk, options.maxOutputBytes)) terminate("output-limit");
    };
    child.stdout.resume();
    child.stderr.on("data", capture);
    child.once("error", (error: NodeJS.ErrnoException) => reject(spawnError(error, config)));
    child.once("close", (code) => {
      finishProcess(code, state, options, config, resolve, reject);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
  });
}

/** Translate spawn failures without ever echoing unsanitized process detail. */
function spawnError(error: NodeJS.ErrnoException, config: CliAgentConfig): CliAgentError {
  if (error.code === "ENOENT") return missingError(config);
  return new CliAgentError(
    `${config.displayName} could not start (${error.code ?? "unknown process error"}). ` +
      `Check ${config.installNoun} and retry.`,
  );
}

/** Read at most `limit + 1` bytes so a hostile output file cannot race a stat. */
async function readBoundedFile(filePath: string, limit: number, config: CliAgentConfig): Promise<string> {
  const handle = await openFileNoFollow(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) {
      throw new CliAgentError(`${config.displayName} last-message output was not a regular file.`);
    }
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) {
      throw new CliAgentError(`${config.displayName} last message exceeded the ${limit}-byte output limit.`);
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Build fixed safety flags plus optional model/schema arguments. */
function agentArgs(cwd: string, outputPath: string, model?: string, schemaPath?: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--color", "never",
    "--cd", cwd,
    "--output-last-message", outputPath,
    ...(schemaPath ? ["--output-schema", schemaPath] : []),
    ...(model ? ["--model", model] : []),
    "-",
  ];
}

/** Turn a non-zero exit into an actionable error without echoing child output. */
function exitError(result: ProcessResult, config: CliAgentConfig): CliAgentError {
  const authFailed = /auth|credential|log(?:ged)?[- ]?in/i.test(result.stderr);
  const incompatible = /(?:unknown|unexpected|unrecognized|invalid)\s+(?:argument|option)/i
    .test(result.stderr);
  if (incompatible) {
    return new CliAgentError(
      `Installed ${config.displayName} is incompatible with ${config.providerName}. ` +
        `Upgrade to ${config.displayName} ${config.minVersion} or newer. ` +
        "Child output was withheld to protect secrets.",
    );
  }
  if (authFailed) {
    return new CliAgentError(
      `${config.displayName} authentication failed: it is not authenticated or its login was rejected. ` +
        `Run \`${config.loginCommand}\` and retry. ` +
        "Child output was withheld to protect secrets.",
    );
  }
  return new CliAgentError(
    `${config.displayName} failed with exit code ${result.code}. Check ${config.installNoun} and retry. ` +
      "Child output was withheld to protect secrets.",
  );
}

/**
 * Base provider for a local agent CLI reached through its non-interactive
 * `exec` boundary, using the CLI's own locally managed login. Concrete
 * providers supply a {@link CliAgentConfig}; behaviour is otherwise identical.
 */
export class CliAgentProvider implements LLMProvider {
  protected readonly model?: string;
  protected readonly options: Required<CliAgentProviderOptions>;
  private readonly config: CliAgentConfig;

  constructor(config: CliAgentConfig, model?: string, options: CliAgentProviderOptions = {}) {
    this.config = config;
    this.model = model?.trim() || undefined;
    this.options = {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      terminateGraceMs: options.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    };
  }

  /** Complete one request. `maxTokens` is unsupported by the CLI and intentionally not forwarded. */
  async complete(system: string, messages: LLMMessage[], _maxTokens: number): Promise<string> {
    return this.invoke(buildPrompt(system, messages));
  }

  /** The CLI buffers its final message; expose it as one callback chunk after completion. */
  async stream(
    system: string,
    messages: LLMMessage[],
    _maxTokens: number,
    onToken?: (text: string) => void,
  ): Promise<string> {
    const text = await this.invoke(buildPrompt(system, messages));
    onToken?.(text);
    return text;
  }

  /** Request one schema-constrained JSON result and validate it again before returning it. */
  async toolCall(
    system: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    _maxTokens: number,
  ): Promise<string> {
    if (tools.length !== 1) {
      throw new CliAgentError(
        `${this.config.displayName} requires exactly one structured tool schema; received ${tools.length}.`,
      );
    }
    const schema = tools[0].input_schema;
    const raw = await this.invoke(buildPrompt(system, messages, true), toCodexOutputSchema(schema));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CliAgentError(
        `${this.config.displayName} returned invalid JSON for a structured request.`,
        { retryable: true },
      );
    }
    const validate = ajv.compile(schema);
    if (!validate(parsed)) {
      throw new CliAgentError(
        `${this.config.displayName} response failed schema validation: ${ajv.errorsText(validate.errors)}`,
        { retryable: true },
      );
    }
    return JSON.stringify(parsed);
  }

  /** Agent CLIs expose no embeddings API; an explicit existing backend is required. */
  async embed(_text: string): Promise<number[]> {
    throw new CliAgentError(
      `The ${this.config.providerName} provider cannot serve embeddings. ` +
        "Set LLMWIKI_EMBEDDING_PROVIDER to an existing embedding backend.",
    );
  }

  /** Execute one request with private artifacts that are removed on every path. */
  private async invoke(prompt: string, schema?: Record<string, unknown>): Promise<string> {
    const cwd = await mkdtemp(path.join(tmpdir(), `llmwiki-${this.config.providerName}-`));
    const outputPath = path.join(cwd, OUTPUT_FILE);
    const schemaPath = schema ? path.join(cwd, SCHEMA_FILE) : undefined;
    let releaseCustody = (): void => undefined;
    try {
      if (schemaPath) await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
      const result = await runAgent(
        agentArgs(cwd, outputPath, this.model, schemaPath),
        cwd,
        prompt,
        this.options,
        this.config,
        (release) => { releaseCustody = release; },
      );
      if (result.code !== 0) throw exitError(result, this.config);
      try {
        return await readBoundedFile(outputPath, this.options.maxOutputBytes, this.config);
      } catch (error) {
        if (error instanceof CliAgentError) throw error;
        throw new CliAgentError(
          `${this.config.displayName} completed without a readable final message. ` +
            `Its diagnostics were withheld to protect secrets; retry after checking ${this.config.installNoun}.`,
          { retryable: true },
        );
      }
    } finally {
      try {
        await rm(cwd, { recursive: true, force: true });
      } finally {
        releaseCustody();
      }
    }
  }
}
