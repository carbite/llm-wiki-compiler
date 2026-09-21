/**
 * Behavioral contract for the TraeCode CLI-backed LLM provider.
 *
 * TraeAgentProvider shares the CliAgentProvider engine with codex-agent, so the
 * exhaustive argv/environment/termination coverage lives in
 * provider-codex-agent.test.ts. This file pins the trae-specific surface: the
 * provider resolves the `trae-cli` binary (not `codex`), names TraeCode CLI in
 * its diagnostics, and still enforces the shared schema and cleanup contract.
 */

import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraeAgentProvider } from "../src/providers/trae-agent.js";
import type { LLMTool } from "../src/utils/provider.js";
import { installFakeCodex, type FakeCodex } from "./fixtures/fake-codex.js";

const originalEnv = { ...process.env };
const fakes: FakeCodex[] = [];
const tempRoots: string[] = [];
const TOOL: LLMTool = {
  name: "return_value",
  description: "Return one string value",
  input_schema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};

/** Install a fake `trae-cli` and steer literal PATH lookup to it. */
async function useFakeTrae(options: Parameters<typeof installFakeCodex>[0] = {}): Promise<FakeCodex> {
  const fake = await installFakeCodex({ ...options, binaryName: "trae-cli" });
  fakes.push(fake);
  process.env.PATH = `${fake.binDir}${path.delimiter}${originalEnv.PATH ?? ""}`;
  return fake;
}

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(fakes.splice(0).map((fake) => fake.cleanup()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TraeAgentProvider process boundary", () => {
  it("runs an ephemeral, read-only exec against the trae-cli binary and passes the model flag", async () => {
    const fake = await useFakeTrae({ textOutput: "compiled page" });
    process.env.OPENAI_API_KEY = "sk-parent-must-not-leak";
    const provider = new TraeAgentProvider("Seed-Evolving", { timeoutMs: 2_000 });

    await expect(provider.complete("system", [{ role: "user", content: "source" }], 17))
      .resolves.toBe("compiled page");
    const [call] = await fake.calls();
    expect(call.args).toEqual(expect.arrayContaining([
      "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check",
      "--ignore-user-config", "--ignore-rules", "--color", "never",
      "--model", "Seed-Evolving", "-",
    ]));
    expect(call.args).not.toContain("--json");
    expect(call.env.OPENAI_API_KEY).toBeUndefined();
    await expect(access(call.cwd)).rejects.toThrow();
  });

  it("passes no model flag when the operator leaves model selection to the CLI", async () => {
    const fake = await useFakeTrae();
    await new TraeAgentProvider(undefined, { timeoutMs: 2_000 })
      .complete("system", [{ role: "user", content: "hello" }], 4096);
    expect((await fake.calls())[0].args).not.toContain("--model");
  });

  it("returns schema-valid structured output through the shared engine", async () => {
    const fake = await useFakeTrae({ toolOutput: { value: "safe" } });
    const provider = new TraeAgentProvider(undefined, { timeoutMs: 2_000 });
    await expect(provider.toolCall("system", [{ role: "user", content: "x" }], [TOOL], 99))
      .resolves.toBe('{"value":"safe"}');
    const [call] = await fake.calls();
    expect(call.args).toContain("--output-schema");
    await expect(access(call.cwd)).rejects.toThrow();
  });

  it("names TraeCode CLI when the binary is absent", async () => {
    const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "llmwiki-trae-missing-"));
    tempRoots.push(root);
    const emptyBin = path.join(root, "bin");
    await mkdir(emptyBin);
    process.env.TMPDIR = root;
    process.env.PATH = emptyBin;
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
    tempRoots.push(root);
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
