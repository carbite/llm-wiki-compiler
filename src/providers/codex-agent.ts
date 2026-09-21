/**
 * OpenAI Codex CLI-backed LLM provider.
 *
 * A thin {@link CliAgentConfig} over the shared {@link CliAgentProvider} engine
 * in `./cli-agent.ts`. Every request launches a fresh `codex exec` process in an
 * empty throwaway directory. The child is ephemeral, read-only sandboxed,
 * non-interactive, and receives only a small environment allowlist needed to
 * locate Codex and its locally managed login. llmwiki never opens Codex
 * credential files or forwards API-key environment variables.
 */

import { CliAgentProvider, type CliAgentConfig, type CliAgentProviderOptions } from "./cli-agent.js";

const MINIMUM_CODEX_VERSION = "0.152.1";

/** Codex CLI identity and diagnostics for the shared agent engine. */
const CODEX_CONFIG: CliAgentConfig = {
  binaryName: "codex",
  displayName: "Codex CLI",
  installProduct: "the OpenAI Codex CLI",
  loginCommand: "codex login",
  installNoun: "the local Codex installation",
  minVersion: MINIMUM_CODEX_VERSION,
  providerName: "codex-agent",
};

/** Testable resource bounds; retained as a named export for existing callers. */
export type CodexAgentProviderOptions = CliAgentProviderOptions;

/** Codex CLI-backed provider using the CLI's locally managed ChatGPT login. */
export class CodexAgentProvider extends CliAgentProvider {
  constructor(model?: string, options: CodexAgentProviderOptions = {}) {
    super(CODEX_CONFIG, model, options);
  }
}
