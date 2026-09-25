// ── Presentation P3 · custom JSONSchema validator ──

import { describe, test, expect } from 'bun:test';
import { validateJSON } from '../../../src/ui/declarative/validate.js';

describe('validateJSON · primitive types', () => {
  test('string type matches', () => {
    expect(validateJSON('hi', { type: 'string' }).ok).toBe(true);
    expect(validateJSON(42, { type: 'string' }).ok).toBe(false);
  });

  test('integer vs number distinction', () => {
    expect(validateJSON(1, { type: 'integer' }).ok).toBe(true);
    expect(validateJSON(1.5, { type: 'integer' }).ok).toBe(false);
    expect(validateJSON(1.5, { type: 'number' }).ok).toBe(true);
    expect(validateJSON(NaN, { type: 'number' }).ok).toBe(false);
  });

  test('array type accepts arrays only', () => {
    expect(validateJSON([], { type: 'array' }).ok).toBe(true);
    expect(validateJSON({}, { type: 'array' }).ok).toBe(false);
  });

  test('tuple type (array form) allows multiple', () => {
    expect(validateJSON(null, { type: ['string', 'null'] }).ok).toBe(true);
    expect(validateJSON('x', { type: ['string', 'null'] }).ok).toBe(true);
    expect(validateJSON(3, { type: ['string', 'null'] }).ok).toBe(false);
  });
});

describe('validateJSON · object properties', () => {
  test('additionalProperties: false rejects unknown fields', () => {
    const schema = {
      type: 'object',
      properties: { known: { type: 'string' } },
      additionalProperties: false,
    };
    const ok = validateJSON({ known: 'x' }, schema);
    expect(ok.ok).toBe(true);
    const fail = validateJSON({ known: 'x', extra: 1 }, schema);
    expect(fail.ok).toBe(false);
    expect(fail.errors[0]?.message).toContain('unknown property');
  });

  test('required field missing → error', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    };
    const r = validateJSON({}, schema);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('required');
  });

  test('nested object validation · path carries through', () => {
    const schema = {
      type: 'object',
      properties: {
        nest: {
          type: 'object',
          properties: { x: { type: 'number' } },
          additionalProperties: false,
        },
      },
    };
    const r = validateJSON({ nest: { x: 'not-a-number' } }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.path).toBe('$.nest.x');
  });
});

describe('validateJSON · enum + range + oneOf', () => {
  test('enum rejects value outside set', () => {
    const schema = { type: 'string', enum: ['a', 'b'] };
    expect(validateJSON('a', schema).ok).toBe(true);
    expect(validateJSON('c', schema).ok).toBe(false);
  });

  test('minimum / maximum enforce number bounds', () => {
    const schema = { type: 'integer', minimum: 0, maximum: 10 };
    expect(validateJSON(5, schema).ok).toBe(true);
    expect(validateJSON(-1, schema).ok).toBe(false);
    expect(validateJSON(11, schema).ok).toBe(false);
  });

  test('oneOf · first match wins', () => {
    const schema = {
      oneOf: [{ type: 'string' }, { type: 'null' }],
    };
    expect(validateJSON('x', schema).ok).toBe(true);
    expect(validateJSON(null, schema).ok).toBe(true);
    expect(validateJSON(3, schema).ok).toBe(false);
  });
});
