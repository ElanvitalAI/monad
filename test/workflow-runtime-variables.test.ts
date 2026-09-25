// Archon-port T2.1 (2026-05-08) — variable interpolation + when expr.

import { describe, it, expect } from 'bun:test';
import { interpolate, evaluateWhen } from '../src/workflow-runtime/index.js';
import type { NodeOutput } from '../src/workflow-runtime/index.js';

const okOutput = (v: unknown): NodeOutput => ({ ok: true, output: v, durationMs: 1 });

describe('interpolate', () => {
  it('substitutes $ARGUMENTS and $ARTIFACTS_DIR', () => {
    const r = interpolate('args=$ARGUMENTS dir=$ARTIFACTS_DIR', {
      arguments: 'hello',
      artifactsDir: '/tmp/run-1',
      outputs: {},
    });
    expect(r.text).toBe('args=hello dir=/tmp/run-1');
    expect(r.missing).toEqual([]);
  });

  it('substitutes $<id>.output for string output', () => {
    const r = interpolate('result: $first.output', {
      arguments: '',
      artifactsDir: '',
      outputs: { first: okOutput('cool') },
    });
    expect(r.text).toBe('result: cool');
  });

  it('substitutes $<id>.output.field for JSON output', () => {
    const r = interpolate('name=$first.output.user.name', {
      arguments: '',
      artifactsDir: '',
      outputs: { first: okOutput({ user: { name: 'Alice', age: 30 } }) },
    });
    expect(r.text).toBe('name=Alice');
  });

  it('records missing references', () => {
    const r = interpolate('$ghost.output and $other.output.foo', {
      arguments: '',
      artifactsDir: '',
      outputs: {},
    });
    expect(r.text).toBe(' and ');
    expect(r.missing).toEqual(['$ghost.output', '$other.output.foo']);
  });

  it('serializes non-string outputs as JSON', () => {
    const r = interpolate('$first.output', {
      arguments: '',
      artifactsDir: '',
      outputs: { first: okOutput([1, 2, 3]) },
    });
    expect(r.text).toBe('[1,2,3]');
  });

  it('handles backslash escape', () => {
    const r = interpolate('keep \\$ARGUMENTS literal', {
      arguments: 'X',
      artifactsDir: '',
      outputs: {},
    });
    expect(r.text).toBe('keep $ARGUMENTS literal');
  });

  it('handles kebab-case node ids', () => {
    const r = interpolate('$scan-codebase.output', {
      arguments: '',
      artifactsDir: '',
      outputs: { 'scan-codebase': okOutput('result') },
    });
    expect(r.text).toBe('result');
  });
});

describe('evaluateWhen', () => {
  const ctx = {
    arguments: '',
    artifactsDir: '',
    outputs: {
      a: { ok: true, output: 'yes', durationMs: 1 },
      b: { ok: false, output: '', error: 'bad', durationMs: 1 },
      c: { ok: true, output: { mode: 'plan', count: 5 }, durationMs: 1 },
    },
  };

  it('empty expression → true', () => {
    expect(evaluateWhen('', ctx)).toBe(true);
  });

  it('ok flag check', () => {
    expect(evaluateWhen('$a.ok == true', ctx)).toBe(true);
    expect(evaluateWhen('$a.ok == false', ctx)).toBe(false);
    expect(evaluateWhen('$b.ok == false', ctx)).toBe(true);
  });

  it('output equality (==)', () => {
    expect(evaluateWhen("$a.output == 'yes'", ctx)).toBe(true);
    expect(evaluateWhen("$a.output == 'no'", ctx)).toBe(false);
  });

  it('output inequality (!=)', () => {
    expect(evaluateWhen("$a.output != 'no'", ctx)).toBe(true);
  });

  it('field path equality', () => {
    expect(evaluateWhen("$c.output.mode == 'plan'", ctx)).toBe(true);
    expect(evaluateWhen("$c.output.mode == 'execute'", ctx)).toBe(false);
  });

  it('truthy bare reference', () => {
    expect(evaluateWhen('$a.output', ctx)).toBe(true);
    expect(evaluateWhen('$b.output', ctx)).toBe(false); // empty string
  });

  it('missing reference defaults to falsy', () => {
    expect(evaluateWhen('$ghost.output', ctx)).toBe(false);
    expect(evaluateWhen("$ghost.output == 'x'", ctx)).toBe(false);
  });
});
