// ── PFC-S3.3 P1: Poka-Yoke core validator ──

import { describe, expect, test } from 'bun:test';
import {
  guardWrite,
  parseShallowFrontmatter,
  validate,
  type PokaSchema,
} from '../src/cft/pokayoke';

describe('Poka-Yoke validate — primitives', () => {
  test('string min/max/pattern', () => {
    const schema: PokaSchema = { kind: 'string', min: 3, max: 5, pattern: /^[a-z]+$/ };
    expect(validate('abc', schema).ok).toBe(true);
    expect(validate('ab', schema).ok).toBe(false);
    expect(validate('abcdef', schema).ok).toBe(false);
    expect(validate('ABC', schema).ok).toBe(false);
    expect(validate(123, schema).ok).toBe(false);
  });

  test('number integer + bounds', () => {
    const schema: PokaSchema = { kind: 'number', integer: true, min: 0, max: 100 };
    expect(validate(50, schema).ok).toBe(true);
    expect(validate(50.5, schema).ok).toBe(false);
    expect(validate(-1, schema).ok).toBe(false);
    expect(validate(NaN, schema).ok).toBe(false);
  });

  test('enum rejects non-members', () => {
    const schema: PokaSchema = { kind: 'enum', values: ['LOW', 'MED', 'HIGH'] };
    expect(validate('MED', schema).ok).toBe(true);
    const r = validate('CRITICAL', schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('enum');
  });

  test('literal must match exactly', () => {
    expect(validate('foo', { kind: 'literal', value: 'foo' }).ok).toBe(true);
    const r = validate('bar', { kind: 'literal', value: 'foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('literal');
  });
});

describe('Poka-Yoke validate — composite', () => {
  const noteSchema: PokaSchema = {
    kind: 'object',
    shape: {
      title: { kind: 'string', min: 1 },
      severity: { kind: 'enum', values: ['LOW', 'MED', 'HIGH'] },
      tags: { kind: 'array', of: { kind: 'string' } },
    },
    required: ['title', 'severity'],
  };

  test('object required missing → path + code correct', () => {
    const r = validate({ tags: [] }, noteSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const byPath = r.errors.map(e => e.path.join('.'));
      expect(byPath).toContain('title');
      expect(byPath).toContain('severity');
    }
  });

  test('array wrong element type reports index in path', () => {
    const r = validate({ title: 't', severity: 'LOW', tags: ['a', 2, 'c'] }, noteSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const target = r.errors.find(e => e.path.join('.') === 'tags.1');
      expect(target).toBeDefined();
    }
  });

  test('strict rejects extra keys', () => {
    const strict: PokaSchema = {
      kind: 'object',
      shape: { a: { kind: 'string' } },
      required: ['a'],
      strict: true,
    };
    const r = validate({ a: 'x', b: 'y' }, strict);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some(e => e.code === 'extra')).toBe(true);
    }
  });

  test('union first-match wins', () => {
    const schema: PokaSchema = {
      kind: 'union',
      variants: [
        { kind: 'literal', value: 'yes' },
        { kind: 'literal', value: 'no' },
        { kind: 'number' },
      ],
    };
    expect(validate('yes', schema).ok).toBe(true);
    expect(validate(42, schema).ok).toBe(true);
    expect(validate('maybe', schema).ok).toBe(false);
  });
});

describe('Poka-Yoke parseShallowFrontmatter', () => {
  test('normal block', () => {
    const raw = '---\ntitle: Hello\nseverity: LOW\n---\n\n# body\n';
    const fm = parseShallowFrontmatter(raw);
    expect(fm).toEqual({ title: 'Hello', severity: 'LOW' });
  });

  test('missing block returns null', () => {
    expect(parseShallowFrontmatter('# no frontmatter\n')).toBeNull();
  });

  test('strips quoted values', () => {
    const fm = parseShallowFrontmatter("---\nname: 'single'\nlabel: \"double\"\n---\n");
    expect(fm).toEqual({ name: 'single', label: 'double' });
  });
});

describe('Poka-Yoke guardWrite', () => {
  const fmSchema: PokaSchema = {
    kind: 'object',
    shape: {
      severity: { kind: 'enum', values: ['LOW', 'MED', 'HIGH'] },
      title: { kind: 'string', min: 1 },
    },
    required: ['severity', 'title'],
  };

  test('ok path — valid frontmatter + body has required substring', () => {
    const content = '---\nseverity: LOW\ntitle: x\n---\n# Incident\n\nresolved.\n';
    const r = guardWrite({
      path: '/tmp/note.md',
      content,
      frontmatterSchema: fmSchema,
      bodyContains: ['Incident'],
      minBodyLength: 5,
    });
    expect(r.ok).toBe(true);
  });

  test('fail path — missing frontmatter + body too short', () => {
    const r = guardWrite({
      path: '/tmp/bad.md',
      content: 'tiny',
      frontmatterSchema: fmSchema,
      minBodyLength: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.reasonOneLine).toContain('/tmp/bad.md');
    }
  });

  test('bodyContains missing reports as required', () => {
    const content = '---\nseverity: LOW\ntitle: x\n---\nbody here\n';
    const r = guardWrite({
      path: '/t/n.md',
      content,
      frontmatterSchema: fmSchema,
      bodyContains: ['MISSING_PHRASE'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some(e => e.code === 'required' && e.expected === 'MISSING_PHRASE')).toBe(true);
    }
  });
});
