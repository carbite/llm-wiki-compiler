/**
 * Recovery coverage for durable extraction checkpoints and per-source failure
 * isolation. A simulated crash boundary re-runs phase 1 without committed
 * state; the second pass must reuse the successful source and call the provider
 * only for the source that failed previously.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { runExtractionPhases } from "../src/compiler/extraction-phase.js";
import { makeCompileProjectRoot } from "./fixtures/compile-project.js";
import type { SourceChange, WikiState } from "../src/utils/types.js";

const EMPTY_STATE: WikiState = { version: 1, indexHash: "", sources: {} };

/** Return one schema-valid extraction object. */
function extraction(name: string): string {
  return JSON.stringify({ concepts: [{ concept: name, summary: "summary", is_new: true }] });
}

describe("extraction recovery", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.LLMWIKI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("checkpoints successes, records failures, and retries only failed sources", async () => {
    process.env.LLMWIKI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    root = await makeCompileProjectRoot({
      dirSuffix: "extraction-recovery",
      sourceFile: "a.md",
      sourceContent: "# A\n\nALPHA",
    });
    await writeFile(path.join(root, "sources", "b.md"), "# B\n\nBETA", "utf8");
    const changes: SourceChange[] = ["a.md", "b.md"].map((file) => ({ file, status: "new" }));
    let failBeta = true;
    const calls: string[] = [];
    vi.spyOn(AnthropicProvider.prototype, "toolCall").mockImplementation(async (system) => {
      const name = system.includes("ALPHA") ? "Alpha" : "Beta";
      calls.push(name);
      if (name === "Beta" && failBeta) throw new Error("401 simulated source failure");
      return extraction(name);
    });

    const first = await runExtractionPhases(root, changes, EMPTY_STATE, {
      scoped: changes, detected: changes,
    }, 1);
    expect(first.map((item) => item.concepts.length)).toEqual([1, 0]);
    expect(calls).toEqual(["Alpha", "Beta", "Beta"]);

    failBeta = false;
    calls.length = 0;
    const second = await runExtractionPhases(root, changes, EMPTY_STATE, {
      scoped: changes, detected: changes,
    }, 1);
    expect(second.map((item) => item.concepts.length)).toEqual([1, 1]);
    expect(calls).toEqual(["Beta"]);
  });
});
