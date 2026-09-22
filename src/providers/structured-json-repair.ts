/**
 * Conservative local repair for structured CLI-agent responses.
 *
 * Agent CLIs occasionally wrap an otherwise valid JSON value in a Markdown
 * fence, prepend a short explanation, double-encode the value as a JSON string,
 * or leave a trailing comma. These transformations recover only those
 * unambiguous cases; schema validation remains the authority after repair.
 */

/** A successfully parsed value and whether transport text needed repair. */
export interface RepairedJson {
  value: unknown;
  repaired: boolean;
}

/** Parse one candidate without letting syntax errors escape. */
function tryParse(candidate: string): unknown | undefined {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/** Remove a single whole-value Markdown fence. */
function stripFence(raw: string): string {
  const match = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? raw.trim();
}

interface JsonScanState {
  stack: string[];
  quoted: boolean;
  escaped: boolean;
}

/** Consume quoted content and quote boundaries before structural scanning. */
function consumeQuotedCharacter(state: JsonScanState, char: string): boolean {
  if (!state.quoted && char !== '"') return false;
  if (!state.quoted) state.quoted = true;
  else if (state.escaped) state.escaped = false;
  else if (char === "\\") state.escaped = true;
  else if (char === '"') state.quoted = false;
  return true;
}

/** Update bracket state, reporting completion or invalid nesting. */
function scanBracket(state: JsonScanState, char: string): "continue" | "done" | "invalid" {
  if (char === "{" || char === "[") state.stack.push(char);
  if (char !== "}" && char !== "]") return "continue";
  const expected = char === "}" ? "{" : "[";
  if (state.stack.pop() !== expected) return "invalid";
  return state.stack.length === 0 ? "done" : "continue";
}

/** Locate the first balanced JSON object or array outside quoted strings. */
function balancedJsonSlice(raw: string): string | undefined {
  const start = raw.search(/[\[{]/);
  if (start < 0) return undefined;
  const state: JsonScanState = { stack: [], quoted: false, escaped: false };
  for (let i = start; i < raw.length; i += 1) {
    if (consumeQuotedCharacter(state, raw[i])) continue;
    const status = scanBracket(state, raw[i]);
    if (status === "invalid") return undefined;
    if (status === "done") return raw.slice(start, i + 1);
  }
  return undefined;
}

/** Remove commas immediately before a closing object/array token. */
function withoutTrailingCommas(raw: string): string {
  let result = "";
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    if (char === "," && /^[\s]*[}\]]/.test(raw.slice(i + 1))) continue;
    result += char;
  }
  return result;
}

/** Unwrap a JSON string that itself contains a JSON object or array. */
function unwrapEncodedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const nested = tryParse(stripFence(value));
  return nested === undefined ? value : nested;
}

/**
 * Parse JSON after applying only deterministic, lossless transport repairs.
 * Returns undefined when no candidate parses; callers still retry the model.
 */
export function parseRepairableJson(raw: string): RepairedJson | undefined {
  const direct = tryParse(raw);
  if (direct !== undefined) {
    const value = unwrapEncodedJson(direct);
    return { value, repaired: value !== direct };
  }
  const stripped = stripFence(raw);
  const balanced = balancedJsonSlice(stripped) ?? stripped;
  for (const candidate of [stripped, balanced, withoutTrailingCommas(balanced)]) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return { value: unwrapEncodedJson(parsed), repaired: true };
  }
  return undefined;
}

/** True for plain JSON objects accepted by the structured-output boundary. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Repair common extraction-shape slips without weakening the published schema. */
export function repairStructuredValue(toolName: string, value: unknown): unknown {
  if (toolName !== "extract_concepts" || !isRecord(value) || !Array.isArray(value.concepts)) {
    return value;
  }
  const concepts = value.concepts.map((item) => {
    if (!isRecord(item) || !Array.isArray(item.contradicted_by)) return item;
    const contradictedBy = item.contradicted_by.map((entry) => (
      typeof entry === "string" ? { slug: entry } : entry
    ));
    return { ...item, contradicted_by: contradictedBy };
  });
  return { ...value, concepts };
}
