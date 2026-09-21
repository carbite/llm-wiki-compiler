/**
 * Real-entry-point regressions for `LLMWIKI_PROVIDER=trae` and
 * `llmwiki compile --provider trae`.
 *
 * TraeCode CLI is mocked only at the executable boundary (a fake named
 * `trae-cli`). The exhaustive argv/termination/secret-scrub coverage lives in
 * the codex-agent CLI suite because both providers share one engine; this file
 * pins the trae-specific wiring the shared tests cannot: the built CLI resolves
 * the `trae-cli` binary, runs the full compile pipeline, and fails closed on
 * embeddings with a trae-named remediation.
 */

import { access, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAimockLifecycle } from "./fixtures/aimock-helper.js";
import { installFakeCodex, type FakeCodex } from "./fixtures/fake-codex.js";
import { expectCLIFailure, expectCLIExit, runCLI } from "./fixtures/run-cli.js";

const aimock = useAimockLifecycle("trae-agent-cli");
const fakes: FakeCodex[] = [];
const EMBEDDING_PRELOAD = path.resolve("test/fixtures/mock-embeddings.mjs");

/** Install a fake `trae-cli` at the executable boundary and register cleanup. */
async function fakeTrae(options: Parameters<typeof installFakeCodex>[0] = {}): Promise<FakeCodex> {
  const fake = await installFakeCodex({ ...options, binaryName: "trae-cli" });
  fakes.push(fake);
  return fake;
}

/** Environment for trae chat plus an explicit keyless embedding backend. */
function traeEnv(fake: FakeCodex): NodeJS.ProcessEnv {
  return {
    PATH: `${fake.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    NODE_OPTIONS: `--import=${EMBEDDING_PRELOAD}`,
    LLMWIKI_PROVIDER: "trae",
    LLMWIKI_EMBEDDING_PROVIDER: "ollama",
    OLLAMA_HOST: "http://127.0.0.1:1/v1",
    OLLAMA_EMBEDDINGS_HOST: "http://127.0.0.1:1/v1",
    OPENAI_API_KEY: "sk-parent-trap-must-not-reach-trae",
  };
}

/** Valid extraction result used by the real compile pipeline. */
function extractedConcept(): unknown {
  return {
    concepts: [{
      concept: "Trae Agent Concept",
      summary: "Produced through the process-boundary trae-cli fake.",
      is_new: true,
      tags: ["trae"],
      confidence: 0.9,
    }],
  };
}

afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.cleanup();
});

describe("trae through the real llmwiki CLI", () => {
  it.each([
    { label: "environment", args: ["compile"], baseProvider: "trae" },
    { label: "provider flag", args: ["compile", "--provider", "trae"], baseProvider: "openai" },
  ])("runs the full compile pipeline via $label selection", async ({ args, baseProvider }) => {
    const cwd = await aimock.makeWorkspace("# Trae source\n\nA durable source about trae agent compilation.\n");
    const fake = await fakeTrae({
      toolOutput: extractedConcept(),
      textOutput: "# Trae Agent Concept\n\nCompiled by the TraeCode CLI provider.",
    });
    const env = { ...traeEnv(fake), LLMWIKI_PROVIDER: baseProvider };

    const result = await runCLI(args, cwd, env);

    expectCLIExit(result, 0);
    const pages = await readdir(path.join(cwd, "wiki", "concepts"));
    expect(pages).toHaveLength(1);
    expect(await readFile(path.join(cwd, "wiki", "concepts", pages[0]), "utf8"))
      .toContain("Compiled by the TraeCode CLI provider");
    const calls = await fake.calls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.some((call) => call.args.includes("--output-schema"))).toBe(true);
    expect(calls.some((call) => !call.args.includes("--output-schema"))).toBe(true);
    for (const call of calls) {
      expect(call.env.OPENAI_API_KEY).toBeUndefined();
      expect(call.env.NODE_OPTIONS).toBeUndefined();
      await expect(access(call.cwd)).rejects.toThrow();
    }
  }, 30_000);

  it("fails before invoking trae-cli when no embedding provider is explicit", async () => {
    const cwd = await aimock.makeWorkspace("# Source\n\nEmbeddings must be explicit.\n");
    const fake = await fakeTrae();
    const result = await runCLI(["compile"], cwd, {
      PATH: `${fake.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      LLMWIKI_PROVIDER: "trae",
      LLMWIKI_EMBEDDING_PROVIDER: "",
      OPENAI_API_KEY: "sk-must-not-be-used",
    });
    expectCLIFailure(result);
    expect(result.stderr).toMatch(/trae[\s\S]*LLMWIKI_EMBEDDING_PROVIDER/i);
    expect(await fake.calls()).toEqual([]);
  });

  it("fails actionably naming TraeCode CLI when the binary is absent", async () => {
    const cwd = await aimock.makeWorkspace("# Source\n\nTraeCode CLI must be installed.\n");
    const result = await runCLI(["compile"], cwd, {
      PATH: "/nonexistent-path-for-trae-test",
      LLMWIKI_PROVIDER: "trae",
      LLMWIKI_EMBEDDING_PROVIDER: "ollama",
    });
    expectCLIFailure(result);
    expect(result.stderr).toMatch(/TraeCode CLI.*install|install.*TraeCode CLI/i);
    expect(result.stderr).not.toContain("ANTHROPIC_API_KEY");
  });
});
