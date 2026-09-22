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

import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAimockLifecycle } from "./fixtures/aimock-helper.js";
import type { FakeCodex } from "./fixtures/fake-codex.js";
import { expectCLIFailure, expectCLIExit, runCLI } from "./fixtures/run-cli.js";
import { CliAgentCompileHarness } from "./fixtures/cli-agent-compile-harness.js";

const aimock = useAimockLifecycle("trae-agent-cli");
const agent = new CliAgentCompileHarness("trae-cli", "trae", "Trae");

/** Install a fake `trae-cli` at the executable boundary and register cleanup. */
async function fakeTrae(
  options: Parameters<CliAgentCompileHarness["install"]>[0] = {},
): Promise<FakeCodex> {
  return agent.install(options);
}

/** Environment for trae chat plus an explicit keyless embedding backend. */
function traeEnv(fake: FakeCodex): NodeJS.ProcessEnv {
  return agent.environment(fake);
}

/** Valid extraction result used by the real compile pipeline. */
function extractedConcept(): unknown {
  return agent.extraction();
}

afterEach(async () => {
  await agent.cleanup();
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
    await agent.expectSuccessfulCompile(cwd, fake, "Compiled by the TraeCode CLI provider");
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
    await agent.expectEmbeddingPreflightFailure(result, fake);
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
