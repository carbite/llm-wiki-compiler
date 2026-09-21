/**
 * Adapt tool schemas to Codex's strict structured-output object contract.
 *
 * Codex requires every object to reject extra keys and list all declared
 * properties as required. Narrow a private copy of the transport schema;
 * the shared tool definition and validation of the original result stay intact.
 */

type Schema = Record<string, unknown>;

/** Whether a schema node is an object rather than a boolean schema or array. */
function isSchema(value: unknown): value is Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize a child only when it is a schema object. */
function normalizeChild(value: unknown): void {
  if (isSchema(value)) normalizeObjectSchema(value);
}

/** Normalize child schemas without treating examples or defaults as schemas. */
function normalizeChildren(schema: Schema): void {
  for (const key of ["properties", "$defs", "definitions"]) {
    const children = schema[key];
    if (isSchema(children)) Object.values(children).forEach(normalizeChild);
  }
  for (const key of ["items", "anyOf", "allOf", "oneOf", "prefixItems"]) {
    const children = schema[key];
    const entries = Array.isArray(children) ? children : [children];
    entries.forEach(normalizeChild);
  }
}

/** Apply Codex's object constraints recursively to the copied schema. */
function normalizeObjectSchema(schema: Schema): void {
  normalizeChildren(schema);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object") || isSchema(schema.properties)) {
    schema.properties ??= {};
    schema.additionalProperties = false;
    schema.required = Object.keys(schema.properties as Schema);
  }
}

/** Return a stricter transport schema without mutating a shared tool definition. */
export function toCodexOutputSchema(schema: Schema): Schema {
  const copy = structuredClone(schema);
  normalizeObjectSchema(copy);
  return copy;
}
