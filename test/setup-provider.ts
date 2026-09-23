/**
 * Keep generic tests on the historical deterministic provider.
 *
 * The product default is Trae + local Ollama. Most tests exercise unrelated
 * filesystem and workflow behavior and must not contact a developer's Ollama
 * daemon. Tests of the product default explicitly delete LLMWIKI_PROVIDER.
 */
import { beforeEach } from "vitest";

beforeEach(() => {
  if (!process.env.LLMWIKI_PROVIDER?.trim()) {
    process.env.LLMWIKI_PROVIDER = "anthropic";
  }
});
