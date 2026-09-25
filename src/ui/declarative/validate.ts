// ── Presentation P3 · JSONSchema validator (custom · dep-free) ──
//
// Small recursive validator for the subset of JSONSchema we emit from
// attribute classes + widget schemas. Goals:
//   - No runtime dependency (avoid pulling ajv into the TUI runtime)
//   - Strict `additionalProperties: false` enforcement out of the box
//   - Clear error paths (`$.config.padding.top`) for LLM feedback
//
// Supported keywords (subset):
//   - type: 'object' | 'array' | 'string' | 'number' | 'integer' |
//     'boolean' | 'null' · also tuple `['object', 'null']`
//   - properties · required · additionalProperties (boolean)
//   - items (single schema · not tuple form)
//   - enum
//   - minimum · maximum
//   - oneOf (first-match wins)
//   - $ref · not supported (schemas we emit are inline)

export interface ValidationError {
  /** Dotted path from the root input, e.g. `$.config.padding.top`. */
  readonly path: string;
  /** Human-readable message. */
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly ValidationError[];
}

type Schema = Record<string, unknown>;

function primitiveType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, declared: unknown): boolean {
  if (Array.isArray(declared)) {
    return declared.some((t) => matchesType(value, t));
  }
  if (typeof declared !== 'string') return true;
  const actual = primitiveType(value);
  if (declared === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }
  if (declared === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return actual === declared;
}

function validate(
  value: unknown,
  schema: Schema | undefined,
  path: string,
  errors: ValidationError[],
): void {
  if (!schema || typeof schema !== 'object') return;

  // oneOf — first-match wins · silent if any branch succeeds
  if (Array.isArray(schema.oneOf)) {
    const candidates = schema.oneOf as Schema[];
    for (const candidate of candidates) {
      const probe: ValidationError[] = [];
      validate(value, candidate, path, probe);
      if (probe.length === 0) return;
    }
    errors.push({ path, message: `value does not match any oneOf branch` });
    return;
  }

  // type
  if ('type' in schema) {
    if (!matchesType(value, schema.type)) {
      errors.push({
        path,
        message: `expected type ${JSON.stringify(schema.type)} · got ${primitiveType(value)}`,
      });
      return;
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    const allowed = schema.enum as unknown[];
    if (!allowed.some((v) => v === value)) {
      errors.push({
        path,
        message: `value not in enum ${JSON.stringify(allowed)}`,
      });
      return;
    }
  }

  // number range
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path, message: `value ${value} < minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ path, message: `value ${value} > maximum ${schema.maximum}` });
    }
  }

  // object
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
    const required = (schema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in (value as object))) {
        errors.push({ path: `${path}.${key}`, message: `required property missing` });
      }
    }
    for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
      if (key in props) {
        validate(sub, props[key], `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}.${key}`, message: `unknown property` });
      }
    }
  }

  // array
  if (Array.isArray(value)) {
    const items = schema.items as Schema | undefined;
    if (items) {
      value.forEach((v, i) => validate(v, items, `${path}[${i}]`, errors));
    }
  }
}

/** Run validation · returns collected errors (up to 50 to avoid
 *  unbounded LLM error-log output). Empty errors → ok. */
export function validateJSON(value: unknown, schema: Schema): ValidationResult {
  const errors: ValidationError[] = [];
  validate(value, schema, '$', errors);
  const truncated = errors.length > 50 ? errors.slice(0, 50) : errors;
  return { ok: truncated.length === 0, errors: truncated };
}
