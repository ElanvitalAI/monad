// ── PFC-S3.3: Poka-Yoke (mistake-proofing) ──
//
// Detection primitive #3 in the CFT detection batch. Validates data
// structure BEFORE destructive operations (file writes, tool dispatch,
// etc.) so malformed inputs fail fast with a structured
// `ValidationFailure[]` instead of silently corrupting state.
//
// Scope: zero-dep shape validator + a high-level `guardWrite()` helper
// tailored to Obsidian-style frontmatter+body notes. The shape maps
// 1:1 onto zod for a future migration when (and if) we take that
// dependency.

export type PokaSchema =
  | { kind: 'string'; min?: number; max?: number; pattern?: RegExp }
  | { kind: 'number'; min?: number; max?: number; integer?: boolean }
  | { kind: 'boolean' }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'enum'; values: readonly (string | number)[] }
  | { kind: 'array'; of: PokaSchema; min?: number; max?: number }
  | { kind: 'object'; shape: Record<string, PokaSchema>; required?: readonly string[]; strict?: boolean }
  | { kind: 'union'; variants: readonly PokaSchema[] };

export interface ValidationFailure {
  path: string[];
  message: string;
  code:
    | 'type'
    | 'required'
    | 'enum'
    | 'min'
    | 'max'
    | 'pattern'
    | 'literal'
    | 'extra'
    | 'union';
  expected?: unknown;
  received?: unknown;
}

export type ValidateResult =
  | { ok: true; value: unknown }
  | { ok: false; errors: ValidationFailure[] };

// ── Core validator ────────────────────────────────────────────────────

export function validate(value: unknown, schema: PokaSchema): ValidateResult {
  const errors: ValidationFailure[] = [];
  walk(value, schema, [], errors);
  if (errors.length === 0) return { ok: true, value };
  return { ok: false, errors };
}

function walk(
  value: unknown,
  schema: PokaSchema,
  path: string[],
  errors: ValidationFailure[],
): void {
  switch (schema.kind) {
    case 'string':
      return walkString(value, schema, path, errors);
    case 'number':
      return walkNumber(value, schema, path, errors);
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({ path, message: 'expected boolean', code: 'type', received: value });
      }
      return;
    case 'literal':
      if (value !== schema.value) {
        errors.push({
          path, message: `expected literal ${JSON.stringify(schema.value)}`,
          code: 'literal', expected: schema.value, received: value,
        });
      }
      return;
    case 'enum':
      if (!schema.values.includes(value as string | number)) {
        errors.push({
          path, message: `not in enum [${schema.values.join(', ')}]`,
          code: 'enum', expected: schema.values, received: value,
        });
      }
      return;
    case 'array':
      return walkArray(value, schema, path, errors);
    case 'object':
      return walkObject(value, schema, path, errors);
    case 'union':
      return walkUnion(value, schema, path, errors);
  }
}

function walkString(
  value: unknown,
  schema: Extract<PokaSchema, { kind: 'string' }>,
  path: string[],
  errors: ValidationFailure[],
): void {
  if (typeof value !== 'string') {
    errors.push({ path, message: 'expected string', code: 'type', received: value });
    return;
  }
  if (schema.min !== undefined && value.length < schema.min) {
    errors.push({ path, message: `length < ${schema.min}`, code: 'min', expected: schema.min, received: value.length });
  }
  if (schema.max !== undefined && value.length > schema.max) {
    errors.push({ path, message: `length > ${schema.max}`, code: 'max', expected: schema.max, received: value.length });
  }
  if (schema.pattern && !schema.pattern.test(value)) {
    errors.push({ path, message: `pattern mismatch ${schema.pattern}`, code: 'pattern', expected: schema.pattern.source, received: value });
  }
}

function walkNumber(
  value: unknown,
  schema: Extract<PokaSchema, { kind: 'number' }>,
  path: string[],
  errors: ValidationFailure[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ path, message: 'expected finite number', code: 'type', received: value });
    return;
  }
  if (schema.integer && !Number.isInteger(value)) {
    errors.push({ path, message: 'expected integer', code: 'type', received: value });
  }
  if (schema.min !== undefined && value < schema.min) {
    errors.push({ path, message: `< ${schema.min}`, code: 'min', expected: schema.min, received: value });
  }
  if (schema.max !== undefined && value > schema.max) {
    errors.push({ path, message: `> ${schema.max}`, code: 'max', expected: schema.max, received: value });
  }
}

function walkArray(
  value: unknown,
  schema: Extract<PokaSchema, { kind: 'array' }>,
  path: string[],
  errors: ValidationFailure[],
): void {
  if (!Array.isArray(value)) {
    errors.push({ path, message: 'expected array', code: 'type', received: value });
    return;
  }
  if (schema.min !== undefined && value.length < schema.min) {
    errors.push({ path, message: `length < ${schema.min}`, code: 'min', expected: schema.min, received: value.length });
  }
  if (schema.max !== undefined && value.length > schema.max) {
    errors.push({ path, message: `length > ${schema.max}`, code: 'max', expected: schema.max, received: value.length });
  }
  value.forEach((item, i) => walk(item, schema.of, [...path, String(i)], errors));
}

function walkObject(
  value: unknown,
  schema: Extract<PokaSchema, { kind: 'object' }>,
  path: string[],
  errors: ValidationFailure[],
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push({ path, message: 'expected object', code: 'type', received: value });
    return;
  }
  const obj = value as Record<string, unknown>;
  const required = new Set(schema.required ?? []);
  for (const key of required) {
    if (!(key in obj)) {
      errors.push({ path: [...path, key], message: `required key missing`, code: 'required', expected: key });
    }
  }
  for (const [key, sub] of Object.entries(schema.shape)) {
    if (key in obj) {
      walk(obj[key], sub, [...path, key], errors);
    } else if (required.has(key)) {
      // already reported above
    }
  }
  if (schema.strict) {
    for (const key of Object.keys(obj)) {
      if (!(key in schema.shape)) {
        errors.push({ path: [...path, key], message: `extra key`, code: 'extra', received: key });
      }
    }
  }
}

function walkUnion(
  value: unknown,
  schema: Extract<PokaSchema, { kind: 'union' }>,
  path: string[],
  errors: ValidationFailure[],
): void {
  // First-match wins; collect all variants' errors only if all fail.
  const collected: ValidationFailure[][] = [];
  for (const variant of schema.variants) {
    const sub: ValidationFailure[] = [];
    walk(value, variant, path, sub);
    if (sub.length === 0) return;
    collected.push(sub);
  }
  errors.push({
    path,
    message: `no union variant matched (${collected.length} candidates)`,
    code: 'union',
    received: value,
  });
}

// ── Shallow YAML frontmatter parser ───────────────────────────────────
//
// Scoped to Obsidian-style key: value frontmatter. Returns null when
// no frontmatter block is present. Full YAML belongs in the Obsidian
// bridge's richer parser; this one is intentionally tiny so guardWrite
// can stay standalone.

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function parseShallowFrontmatter(raw: string): Record<string, string> | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  const out: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const raw = m[2]!.trim();
    out[key] = stripQuotes(raw);
  }
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ── guardWrite — pre-write structural gate ────────────────────────────

export interface GuardWriteArgs {
  path: string;
  content: string;
  frontmatterSchema?: PokaSchema;
  bodyContains?: readonly string[];
  minBodyLength?: number;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; errors: ValidationFailure[]; reasonOneLine: string };

export function guardWrite(args: GuardWriteArgs): GuardResult {
  const errors: ValidationFailure[] = [];

  const parsed = parseShallowFrontmatter(args.content);
  if (args.frontmatterSchema) {
    if (!parsed) {
      errors.push({
        path: ['frontmatter'],
        message: 'frontmatter block missing',
        code: 'required',
      });
    } else {
      const r = validate(parsed, args.frontmatterSchema);
      if (!r.ok) errors.push(...r.errors.map(e => ({ ...e, path: ['frontmatter', ...e.path] })));
    }
  }

  const bodyOffset = parsed ? (args.content.match(FRONTMATTER_RE)?.[0].length ?? 0) : 0;
  const body = args.content.slice(bodyOffset);

  if (args.minBodyLength !== undefined && body.length < args.minBodyLength) {
    errors.push({
      path: ['body'],
      message: `body length < ${args.minBodyLength}`,
      code: 'min',
      expected: args.minBodyLength,
      received: body.length,
    });
  }
  if (args.bodyContains) {
    for (const needle of args.bodyContains) {
      if (!body.includes(needle)) {
        errors.push({
          path: ['body'],
          message: `missing required substring: ${JSON.stringify(needle)}`,
          code: 'required',
          expected: needle,
        });
      }
    }
  }

  if (errors.length === 0) return { ok: true };
  const reasonOneLine =
    `guardWrite rejected ${args.path}: ${errors.length} issue(s) — `
    + errors.slice(0, 3).map(e => `${e.path.join('.')}:${e.code}`).join(', ')
    + (errors.length > 3 ? '…' : '');
  return { ok: false, errors, reasonOneLine };
}
