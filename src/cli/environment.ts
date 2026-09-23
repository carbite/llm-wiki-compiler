/**
 * Load project environment configuration without crossing an agent CLI's credential boundary.
 *
 * Explicit `codex-agent` or `trae` selection must be determined from argv or the
 * inherited shell environment before dotenv can open a project file containing
 * API keys.
 */

import { createRequire } from "node:module";
import { DEFAULT_PROVIDER } from "../utils/constants.js";

/** Agent-CLI providers whose selection suppresses project `.env` loading. */
const AGENT_PROVIDERS = new Set(["codex-agent", "trae"]);
const require = createRequire(import.meta.url);

/** Parse one provider option spelling without interpreting other arguments. */
function providerValue(argument: string, nextArgument?: string): string | undefined {
  if (argument === "--provider") return nextArgument;
  const prefix = "--provider=";
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : undefined;
}

/** Collapse missing and whitespace-only provider names to no override. */
function normalizedProvider(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Return the last provider override before Commander’s option terminator. */
function providerFlag(argv: string[]): string | undefined {
  const commandArguments = argv.slice(2);
  const terminator = commandArguments.indexOf("--");
  const scannable = terminator < 0 ? commandArguments : commandArguments.slice(0, terminator);
  const providers = scannable.map((argument, index) => providerValue(argument, scannable[index + 1]));
  return normalizedProvider(providers.reverse().find((value) => value !== undefined));
}

/** Load `.env` unless explicit effective selection names an agent CLI provider. */
export function loadCliEnvironment(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const selectedProvider = providerFlag(argv) ?? normalizedProvider(env.LLMWIKI_PROVIDER) ?? DEFAULT_PROVIDER;
  if (AGENT_PROVIDERS.has(selectedProvider)) return;
  require("dotenv/config");
}
