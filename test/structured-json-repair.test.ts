/**
 * Unit coverage for conservative structured-response repair.
 *
 * The repair layer handles common CLI-agent transport wrappers while refusing
 * to invent data from an incomplete or unbalanced response.
 */

import { describe, expect, it } from "vitest";
import { parseRepairableJson } from "../src/providers/structured-json-repair.js";

describe("parseRepairableJson", () => {
  it("accepts a Markdown-fenced object", () => {
    const parsed = parseRepairableJson("```json\n{\"value\":1}\n```");
    expect(parsed).toEqual({ value: { value: 1 }, repaired: true });
  });

  it("extracts an explained object and removes trailing commas", () => {
    const parsed = parseRepairableJson('Result follows: {"items":["a",],} done');
    expect(parsed).toEqual({ value: { items: ["a"] }, repaired: true });
  });

  it("unwraps a JSON string containing an encoded object", () => {
    const parsed = parseRepairableJson(JSON.stringify('{"value":"safe"}'));
    expect(parsed).toEqual({ value: { value: "safe" }, repaired: true });
  });

  it("refuses an incomplete object", () => {
    expect(parseRepairableJson('{"value":')).toBeUndefined();
  });
});
