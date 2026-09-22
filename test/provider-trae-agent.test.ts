/**
 * Behavioral contract for the TraeCode CLI-backed LLM provider.
 *
 * TraeAgentProvider shares the CliAgentProvider engine with codex-agent, so the
 * exhaustive argv/environment/termination coverage lives in
 * provider-codex-agent.test.ts. This file pins the trae-specific surface: the
 * provider resolves the `trae-cli` binary (not `codex`), names TraeCode CLI in
 * its diagnostics, and still enforces the shared schema and cleanup contract.
 */

import { access, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraeAgentProvider } from "../src/providers/trae-agent.js";
import { CONCEPT_EXTRACTION_TOOL } from "../src/compiler/prompts.js";
import type { FakeCodex } from "./fixtures/fake-codex.js";
import {
  CliAgentProviderHarness,
  STRING_TOOL as TOOL,
} from "./fixtures/cli-agent-provider-harness.js";

const harness = new CliAgentProviderHarness("trae-cli");

/** Install a fake `trae-cli` and steer literal PATH lookup to it. */
async function useFakeTrae(
  options: Parameters<CliAgentProviderHarness["useFake"]>[0] = {},
): Promise<FakeCodex> {
  return harness.useFake(options);
}

afterEach(async () => {
  await harness.cleanup();
});

describe("TraeAgentProvider process boundary", () => {
  it("runs an ephemeral, read-only exec against the trae-cli binary and passes the model flag", async () => {
    const fake = await useFakeTrae({ textOutput: "compiled page" });
    process.env.OPENAI_API_KEY = "sk-parent-must-not-leak";
    const provider = new TraeAgentProvider("Seed-Evolving", { timeoutMs: 2_000 });

    const call = await harness.expectModelCompletion(provider, fake, "compiled page");
    expect(call.args).toEqual(expect.arrayContaining(["--model", "Seed-Evolving", "-"]));
  });

  it("passes no model flag when the operator leaves model selection to the CLI", async () => {
    const fake = await useFakeTrae();
    const provider = new TraeAgentProvider(undefined, { timeoutMs: 2_000 });
    await harness.expectNoModelFlag(provider, fake);
  });

  it("returns schema-valid structured output through the shared engine", async () => {
    const fake = await useFakeTrae({ toolOutput: { value: "safe" } });
    const provider = new TraeAgentProvider(undefined, { timeoutMs: 2_000 });
    await harness.expectStructuredSuccess(provider, fake);
  });

  it("repairs omitted extraction defaults and string contradiction slugs", async () => {
    await useFakeTrae({ toolOutput: {
      concepts: [{ concept: "Topic", summary: "Summary", contradicted_by: ["other-topic"] }],
    } });
    const provider = new TraeAgentProvider(undefined, { timeoutMs: 2_000 });
    const raw = await provider.toolCall(
      "system", [{ role: "user", content: "x" }], [CONCEPT_EXTRACTION_TOOL], 99,
    );
    expect(JSON.parse(raw)).toMatchObject({
      concepts: [{ concept: "Topic", is_new: true, contradicted_by: [{ slug: "other-topic" }] }],
    });
  });

  it("names TraeCode CLI when the binary is absent", async () => {
    await harness.prepareMissingBinary("llmwiki-trae-missing-");
    await expect(new TraeAgentProvider(undefined, { timeoutMs: 2_000 })
      .complete("system", [{ role: "user", content: "x" }], 1))
      .rejects.toThrow(/TraeCode CLI.*not installed/i);
  });

  it("cannot serve embeddings and says so", async () => {
    await expect(new TraeAgentProvider().embed("text"))
      .rejects.toThrow(/trae provider cannot serve embeddings/i);
  });

  it("marks malformed structured output retryable so the shared loop can recover", async () => {
    await useFakeTrae({ rawToolOutput: "not-json" });
    const provider = new TraeAgentProvider(undefined, { timeoutMs: 2_000 });
    const error = await provider
      .toolCall("system", [{ role: "user", content: "x" }], [TOOL], 99)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/invalid JSON/i);
    // A model that mostly honours --output-schema deserves a retry, not a hard compile abort.
    expect((error as { nonRetryable?: unknown }).nonRetryable).toBe(false);
  });

  it("keeps a missing binary non-retryable", async () => {
    const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "llmwiki-trae-nonretry-"));
    harness.trackRoot(root);
    const emptyBin = path.join(root, "bin");
    await mkdir(emptyBin);
    process.env.TMPDIR = root;
    process.env.PATH = emptyBin;
    const error = await new TraeAgentProvider(undefined, { timeoutMs: 2_000 })
      .complete("system", [{ role: "user", content: "x" }], 1)
      .catch((caught: unknown) => caught);
    expect((error as { nonRetryable?: unknown }).nonRetryable).toBe(true);
  });
});
