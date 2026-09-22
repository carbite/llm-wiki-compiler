/** Shared full-CLI fixture for local agent provider compile tests. */

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import { installFakeCodex, type FakeCodex } from "./fake-codex.js";
import { expectCLIFailure, type CLIResult } from "./run-cli.js";

const EMBEDDING_PRELOAD = path.resolve("test/fixtures/mock-embeddings.mjs");

/** Own one provider's fake binaries and build its compile inputs. */
export class CliAgentCompileHarness {
  private readonly fakes: FakeCodex[] = [];

  constructor(
    private readonly binaryName: string,
    private readonly providerName: string,
    private readonly conceptLabel: string,
  ) {}

  async install(options: Parameters<typeof installFakeCodex>[0] = {}): Promise<FakeCodex> {
    const fake = await installFakeCodex({ ...options, binaryName: this.binaryName });
    this.fakes.push(fake);
    return fake;
  }

  environment(fake: FakeCodex): NodeJS.ProcessEnv {
    return {
      PATH: `${fake.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      NODE_OPTIONS: `--import=${EMBEDDING_PRELOAD}`,
      LLMWIKI_PROVIDER: this.providerName,
      LLMWIKI_EMBEDDING_PROVIDER: "ollama",
      OLLAMA_HOST: "http://127.0.0.1:1/v1",
      OLLAMA_EMBEDDINGS_HOST: "http://127.0.0.1:1/v1",
      OPENAI_API_KEY: `test-parent-trap-${this.providerName}`,
    };
  }

  extraction(): unknown {
    return {
      concepts: [{
        concept: `${this.conceptLabel} Agent Concept`,
        summary: `Produced through the process-boundary ${this.binaryName} fake.`,
        is_new: true,
        tags: [this.providerName],
        confidence: 0.9,
      }],
    };
  }

  async expectSuccessfulCompile(cwd: string, fake: FakeCodex, bodyText: string): Promise<void> {
    const pages = await readdir(path.join(cwd, "wiki", "concepts"));
    expect(pages).toHaveLength(1);
    expect(await readFile(path.join(cwd, "wiki", "concepts", pages[0]), "utf8"))
      .toContain(bodyText);
    const calls = await fake.calls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.some((call) => call.args.includes("--output-schema"))).toBe(true);
    expect(calls.some((call) => !call.args.includes("--output-schema"))).toBe(true);
    for (const call of calls) {
      expect(call.env.OPENAI_API_KEY).toBeUndefined();
      expect(call.env.NODE_OPTIONS).toBeUndefined();
      await expect(access(call.cwd)).rejects.toThrow();
    }
  }

  async expectEmbeddingPreflightFailure(result: CLIResult, fake: FakeCodex): Promise<void> {
    expectCLIFailure(result);
    expect(result.stderr).toMatch(new RegExp(
      `${this.providerName}[\\s\\S]*LLMWIKI_EMBEDDING_PROVIDER`, "i",
    ));
    expect(await fake.calls()).toEqual([]);
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.fakes.splice(0).map((fake) => fake.cleanup()));
  }
}
