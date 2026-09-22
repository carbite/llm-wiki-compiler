/** Shared process-boundary fixture for Codex- and Trae-backed provider tests. */

import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import type { LLMProvider, LLMTool } from "../../src/utils/provider.js";
import { installFakeCodex, type CapturedCodexCall, type FakeCodex } from "./fake-codex.js";

export const STRING_TOOL: LLMTool = {
  name: "return_value",
  description: "Return one string value",
  input_schema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};

/** Own fake binaries, temporary roots, PATH routing, and environment cleanup. */
export class CliAgentProviderHarness {
  readonly originalEnv = { ...process.env };
  private readonly fakes: FakeCodex[] = [];
  private readonly tempRoots: string[] = [];

  constructor(private readonly binaryName = "codex") {}

  async useFake(options: Parameters<typeof installFakeCodex>[0] = {}): Promise<FakeCodex> {
    const fake = await installFakeCodex({ ...options, binaryName: this.binaryName });
    this.fakes.push(fake);
    process.env.PATH = `${fake.binDir}${path.delimiter}${this.originalEnv.PATH ?? ""}`;
    return fake;
  }

  trackRoot(root: string): void {
    this.tempRoots.push(root);
  }

  async expectModelCompletion(
    provider: LLMProvider,
    fake: FakeCodex,
    expected: string,
  ): Promise<CapturedCodexCall> {
    await expect(provider.complete("system", [{ role: "user", content: "source" }], 17))
      .resolves.toBe(expected);
    const [call] = await fake.calls();
    expect(call.args).toEqual(expect.arrayContaining([
      "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check",
      "--ignore-user-config", "--ignore-rules", "--color", "never",
    ]));
    expect(call.args).not.toContain("--json");
    expect(call.env.OPENAI_API_KEY).toBeUndefined();
    await expect(access(call.cwd)).rejects.toThrow();
    return call;
  }

  async expectNoModelFlag(provider: LLMProvider, fake: FakeCodex): Promise<void> {
    await provider.complete("system", [{ role: "user", content: "hello" }], 4096);
    expect((await fake.calls())[0].args).not.toContain("--model");
  }

  async expectStructuredSuccess(
    provider: LLMProvider,
    fake: FakeCodex,
  ): Promise<CapturedCodexCall> {
    await expect(provider.toolCall("system", [{ role: "user", content: "x" }], [STRING_TOOL], 99))
      .resolves.toBe('{"value":"safe"}');
    const [call] = await fake.calls();
    expect(call.args).toContain("--output-schema");
    await expect(access(call.cwd)).rejects.toThrow();
    return call;
  }

  async prepareMissingBinary(prefix: string): Promise<void> {
    const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", prefix));
    this.trackRoot(root);
    const emptyBin = path.join(root, "bin");
    await mkdir(emptyBin);
    process.env.TMPDIR = root;
    process.env.PATH = emptyBin;
  }

  async cleanup(): Promise<void> {
    process.env = { ...this.originalEnv };
    await Promise.all(this.fakes.splice(0).map((fake) => fake.cleanup()));
    await Promise.all(this.tempRoots.splice(0).map((root) => (
      rm(root, { recursive: true, force: true })
    )));
  }
}
