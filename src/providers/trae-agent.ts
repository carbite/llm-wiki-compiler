/**
 * TraeCode CLI-backed LLM provider.
 *
 * A thin {@link CliAgentConfig} over the shared {@link CliAgentProvider} engine
 * in `./cli-agent.ts`. TraeCode CLI exposes the same non-interactive `exec`
 * contract as Codex (read-only, ephemeral, stdin prompt, `--output-last-message`,
 * optional `--output-schema`), so llmwiki drives it identically and never opens
 * its credential files or forwards API-key environment variables. Authentication
 * is the CLI's own locally managed login (`trae-cli login`). llmwiki defaults to
 * `Seed-Evolving`; `LLMWIKI_MODEL` can override it.
 */

import { CliAgentProvider, type CliAgentConfig, type CliAgentProviderOptions } from "./cli-agent.js";

const MINIMUM_TRAE_VERSION = "0.201.4";

/** TraeCode CLI identity and diagnostics for the shared agent engine. */
const TRAE_CONFIG: CliAgentConfig = {
  binaryName: "trae-cli",
  displayName: "TraeCode CLI",
  installProduct: "the TraeCode CLI",
  loginCommand: "trae-cli login",
  installNoun: "the local TraeCode CLI installation",
  minVersion: MINIMUM_TRAE_VERSION,
  providerName: "trae",
};

/** Testable resource bounds; retained as a named export for symmetry with codex-agent. */
export type TraeAgentProviderOptions = CliAgentProviderOptions;

/** TraeCode CLI-backed provider using the CLI's locally managed login. */
export class TraeAgentProvider extends CliAgentProvider {
  constructor(model?: string, options: TraeAgentProviderOptions = {}) {
    super(TRAE_CONFIG, model, options);
  }
}
