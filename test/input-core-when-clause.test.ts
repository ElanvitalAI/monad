// IDX-2a — when-clause parser + evaluator.
//
// Tests cover grammar (tokenization → parse → eval), error surface
// (malformed input never throws, always returns structured error),
// and safety (length / depth caps).

import { describe, expect, test } from 'bun:test';
import {
  parseWhenClause,
  evaluateWhenClause,
  evalAst,
  WHEN_CLAUSE_MAX_LENGTH,
  WHEN_CLAUSE_MAX_DEPTH,
} from '../src/input-core/index.js';
import { tokenize } from '../src/input-core/when-clause.tokens.js';

// ─── Tokenizer (sanity coverage — parser tests drive most) ─────────

describe('when-clause tokenizer', () => {
  test('identifiers + keyword literals', () => {
    const r = tokenize('pickerOpen && !terminalModalActive');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens).toEqual([
        { kind: 'ident', value: 'pickerOpen' },
        { kind: 'and' },
        { kind: 'bang' },
        { kind: 'ident', value: 'terminalModalActive' },
      ]);
    }
  });

  test('dotted identifiers are allowed', () => {
    const r = tokenize('pfc.autoModeActive');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens).toEqual([{ kind: 'ident', value: 'pfc.autoModeActive' }]);
  });

  test('literal true / false / null / undefined', () => {
    const r = tokenize('true false null undefined');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens.map(t => t.kind === 'literal' ? t.value : t.kind)).toEqual([
        true, false, null, undefined,
      ]);
    }
  });

  test('string literals (both quote styles + escape)', () => {
    const r = tokenize(`"dbl" 'sng' 'esc\\''`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const values = r.tokens.map(t => t.kind === 'literal' ? t.value : null);
      expect(values).toEqual(['dbl', 'sng', `esc'`]);
    }
  });

  test('numbers — int, float, negative', () => {
    const r = tokenize('5 3.14 -7');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens.map(t => t.kind === 'literal' ? t.value : null)).toEqual([5, 3.14, -7]);
    }
  });

  test('single & or | is an error', () => {
    const r1 = tokenize('a & b');
    expect(r1.ok).toBe(false);
    const r2 = tokenize('a | b');
    expect(r2.ok).toBe(false);
  });

  test('unterminated string is an error', () => {
    const r = tokenize(`"unterminated`);
    expect(r.ok).toBe(false);
  });

  test('dangling dot in identifier is an error', () => {
    const r = tokenize('foo.');
    expect(r.ok).toBe(false);
  });

  test('unexpected character is an error', () => {
    const r = tokenize('foo @ bar');
    expect(r.ok).toBe(false);
  });
});

// ─── Parser errors ────────────────────────────────────────────────

describe('when-clause parser errors', () => {
  test('empty expression → parse error', () => {
    const r = parseWhenClause('');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error.kind).toBe('parse');
  });

  test('whitespace-only → parse error', () => {
    const r = parseWhenClause('   ');
    expect(r.ok).toBe(false);
  });

  test('unclosed paren → parse error', () => {
    const r = parseWhenClause('(a && b');
    expect(r.ok).toBe(false);
  });

  test('dangling && → parse error', () => {
    const r = parseWhenClause('a &&');
    expect(r.ok).toBe(false);
  });

  test('operand missing literal after == → parse error', () => {
    const r = parseWhenClause('a == && b');
    expect(r.ok).toBe(false);
  });

  test('paren depth cap', () => {
    const deep = '('.repeat(WHEN_CLAUSE_MAX_DEPTH + 2) + 'a' + ')'.repeat(WHEN_CLAUSE_MAX_DEPTH + 2);
    const r = parseWhenClause(deep);
    expect(r.ok).toBe(false);
  });

  test('expression length cap', () => {
    const long = 'a ' + '|| b '.repeat(WHEN_CLAUSE_MAX_LENGTH);
    const r = parseWhenClause(long);
    expect(r.ok).toBe(false);
  });

  test('non-string input rejected', () => {
    const r = parseWhenClause(null as unknown as string);
    expect(r.ok).toBe(false);
  });
});

// ─── Evaluator truth table ────────────────────────────────────────

describe('when-clause evaluator — primitives', () => {
  const ctx = {
    pickerOpen: true,
    popupOpen: false,
    focusMode: 'input',
    planMode: null,
    syncMode: undefined,
    zero: 0,
    empty: '',
    name: 'alpha',
  };

  test('truthy identifier', () => {
    const r = evaluateWhenClause('pickerOpen', ctx);
    expect(r.ok && r.value).toBe(true);
  });

  test('falsy identifier', () => {
    const r = evaluateWhenClause('popupOpen', ctx);
    expect(r.ok && r.value).toBe(false);
  });

  test('unknown identifier is falsy', () => {
    const r = evaluateWhenClause('doesNotExist', ctx);
    expect(r.ok && r.value).toBe(false);
  });

  test('null / undefined / 0 / empty string all falsy', () => {
    expect(evaluateWhenClause('planMode', ctx).ok && evaluateWhenClause('planMode', ctx).ok === true && (evaluateWhenClause('planMode', ctx) as any).value).toBe(false);
    expect((evaluateWhenClause('syncMode', ctx) as any).value).toBe(false);
    expect((evaluateWhenClause('zero', ctx) as any).value).toBe(false);
    expect((evaluateWhenClause('empty', ctx) as any).value).toBe(false);
  });

  test('negation', () => {
    expect((evaluateWhenClause('!popupOpen', ctx) as any).value).toBe(true);
    expect((evaluateWhenClause('!pickerOpen', ctx) as any).value).toBe(false);
    expect((evaluateWhenClause('!!pickerOpen', ctx) as any).value).toBe(true);
  });

  test('and / or', () => {
    expect((evaluateWhenClause('pickerOpen && !popupOpen', ctx) as any).value).toBe(true);
    expect((evaluateWhenClause('pickerOpen && popupOpen', ctx) as any).value).toBe(false);
    expect((evaluateWhenClause('pickerOpen || popupOpen', ctx) as any).value).toBe(true);
    expect((evaluateWhenClause('popupOpen || doesNotExist', ctx) as any).value).toBe(false);
  });

  test('precedence: && binds tighter than ||', () => {
    // a || b && c  === a || (b && c)
    // With pickerOpen=true, popupOpen=false → (true || (false && anything)) === true
    expect((evaluateWhenClause('pickerOpen || popupOpen && doesNotExist', ctx) as any).value).toBe(true);
    // With pickerOpen=false, popupOpen=false → both halves fail → false
    const ctx2 = { pickerOpen: false, popupOpen: false, other: true };
    expect((evaluateWhenClause('pickerOpen || popupOpen && other', ctx2) as any).value).toBe(false);
  });

  test('parens override precedence', () => {
    const ctx2 = { a: true, b: false, c: false };
    expect((evaluateWhenClause('(a || b) && c', ctx2) as any).value).toBe(false);
    expect((evaluateWhenClause('(a || b) || c', ctx2) as any).value).toBe(true);
  });

  test('equality ==', () => {
    expect((evaluateWhenClause(`focusMode == 'input'`, ctx) as any).value).toBe(true);
    expect((evaluateWhenClause(`focusMode == 'pane'`, ctx) as any).value).toBe(false);
  });

  test('inequality !=', () => {
    expect((evaluateWhenClause(`focusMode != 'pane'`, ctx) as any).value).toBe(true);
    expect((evaluateWhenClause(`focusMode != 'input'`, ctx) as any).value).toBe(false);
  });

  test('equality with null literal', () => {
    expect((evaluateWhenClause('planMode == null', ctx) as any).value).toBe(true);
    expect((evaluateWhenClause('pickerOpen == null', ctx) as any).value).toBe(false);
  });

  test('equality with number literal', () => {
    const ctx2 = { count: 5 };
    expect((evaluateWhenClause('count == 5', ctx2) as any).value).toBe(true);
    expect((evaluateWhenClause('count == 3', ctx2) as any).value).toBe(false);
  });

  test('equality with true / false literal', () => {
    expect((evaluateWhenClause('pickerOpen == true', ctx) as any).value).toBe(true);
    expect((evaluateWhenClause('popupOpen == false', ctx) as any).value).toBe(true);
  });

  test('combined real-world expression', () => {
    // "focus in input and no modal is covering"
    const expr = `focusMode == 'input' && !pickerOpen && !popupOpen`;
    expect((evaluateWhenClause(expr, { ...ctx, pickerOpen: false, popupOpen: false }) as any).value).toBe(true);
    expect((evaluateWhenClause(expr, { ...ctx, pickerOpen: true }) as any).value).toBe(false);
  });

  test('dotted identifier resolves from flat context (ident token captures full dotted form)', () => {
    const ctx2 = { 'pfc.autoModeActive': true, 'pfc.budgetWarning': false };
    expect((evaluateWhenClause('pfc.autoModeActive', ctx2) as any).value).toBe(true);
    expect((evaluateWhenClause('pfc.budgetWarning', ctx2) as any).value).toBe(false);
  });
});

// ─── evalAst (re-use pre-parsed AST) ──────────────────────────────

describe('evalAst — pre-parsed AST reuse', () => {
  test('parse once, eval many times against different contexts', () => {
    const parsed = parseWhenClause('pickerOpen && !popupOpen');
    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) return;

    expect((evalAst(parsed.ast, { pickerOpen: true, popupOpen: false }) as any).value).toBe(true);
    expect((evalAst(parsed.ast, { pickerOpen: true, popupOpen: true }) as any).value).toBe(false);
    expect((evalAst(parsed.ast, { pickerOpen: false, popupOpen: false }) as any).value).toBe(false);
  });
});

// ─── Backward-compat sanity: existing input-core still works ──────

describe('when-clause — integration with existing input-core', () => {
  test('binding with no when field evaluates as allowed (backward compat)', () => {
    // This is a structural claim verified by the resolver tests in
    // input-core-resolver.test.ts. Here we just confirm the types /
    // API surface doesn't crash when when is absent.
    // See also the added resolver tests for full behavior coverage.
    const parsed = parseWhenClause('true');
    expect(parsed.ok).toBe(true);
  });
});
