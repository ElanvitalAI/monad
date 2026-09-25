// when-clause — VSCode-style boolean expression over a context-key
// snapshot. Pure, deterministic, zero allocation on the happy path.
//
// Grammar (minimal, matches IDX-2a §1.4):
//
//   expr   := or
//   or     := and ('||' and)*
//   and    := not ('&&' not)*
//   not    := '!' not | atom
//   atom   := identifier                       # truthy check
//          |  identifier ('==' | '!=') literal # equality
//          |  '(' expr ')'
//   literal := string | number | boolean | 'null' | 'undefined'
//
// Not supported (deliberate): regex =~, numeric comparison < > <= >=,
// `in`, function calls, arbitrary property access. If/when we need
// these, extend atom rule; grammar stays structurally the same.
//
// Safety: inputs capped at `MAX_EXPR_LENGTH`, nesting capped at
// `MAX_PAREN_DEPTH`. Over-limit inputs are rejected at parse time.
// A parse error produces a structured `WhenClauseError`; the caller
// decides fail-open vs fail-closed. Resolver uses fail-closed (the
// binding is skipped) so invalid when-clauses can't escalate keys to
// actions they shouldn't reach.

import { tokenize, type Token } from './when-clause.tokens.js';

export interface WhenClauseContext {
  readonly [key: string]: unknown;
}

export interface WhenClauseError {
  kind: 'parse' | 'eval';
  message: string;
  expr: string;
}

export type WhenClauseResult =
  | { ok: true; value: boolean }
  | { ok: false; error: WhenClauseError };

export const MAX_EXPR_LENGTH = 2000;
export const MAX_PAREN_DEPTH = 32;

// ── AST ─────────────────────────────────────────────────────────────

type Node =
  | { kind: 'ident'; name: string }
  | { kind: 'literal'; value: unknown }
  | { kind: 'not'; inner: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node }
  | { kind: 'eq'; name: string; value: unknown }
  | { kind: 'neq'; name: string; value: unknown };

// ── Parser ──────────────────────────────────────────────────────────

class ParseState {
  pos = 0;
  depth = 0;
  constructor(readonly tokens: readonly Token[], readonly expr: string) {}
  peek(): Token | null { return this.tokens[this.pos] ?? null; }
  consume(): Token | null { return this.tokens[this.pos++] ?? null; }
  eof(): boolean { return this.pos >= this.tokens.length; }
  error(msg: string): WhenClauseError {
    return { kind: 'parse', message: msg, expr: this.expr };
  }
}

function parseOr(s: ParseState): Node {
  let left = parseAnd(s);
  while (s.peek()?.kind === 'or') {
    s.consume();
    const right = parseAnd(s);
    left = { kind: 'or', left, right };
  }
  return left;
}

function parseAnd(s: ParseState): Node {
  let left = parseNot(s);
  while (s.peek()?.kind === 'and') {
    s.consume();
    const right = parseNot(s);
    left = { kind: 'and', left, right };
  }
  return left;
}

function parseNot(s: ParseState): Node {
  if (s.peek()?.kind === 'bang') {
    s.consume();
    const inner = parseNot(s);
    return { kind: 'not', inner };
  }
  return parseAtom(s);
}

function parseAtom(s: ParseState): Node {
  const tok = s.peek();
  if (!tok) throw s.error('unexpected end of expression');

  if (tok.kind === 'lparen') {
    if (s.depth >= MAX_PAREN_DEPTH) throw s.error(`paren depth exceeds ${MAX_PAREN_DEPTH}`);
    s.consume();
    s.depth++;
    const inner = parseOr(s);
    s.depth--;
    const close = s.consume();
    if (!close || close.kind !== 'rparen') throw s.error('expected closing paren');
    return inner;
  }

  if (tok.kind === 'ident') {
    s.consume();
    const op = s.peek();
    if (op?.kind === 'eq' || op?.kind === 'neq') {
      s.consume();
      const litTok = s.consume();
      if (!litTok || litTok.kind !== 'literal') {
        throw s.error(`expected literal after ${op.kind === 'eq' ? '==' : '!='}`);
      }
      return op.kind === 'eq'
        ? { kind: 'eq', name: tok.value, value: litTok.value }
        : { kind: 'neq', name: tok.value, value: litTok.value };
    }
    return { kind: 'ident', name: tok.value };
  }

  if (tok.kind === 'literal') {
    // Standalone literal (truthy check). e.g. `true` or `false` as whole expr.
    s.consume();
    return { kind: 'literal', value: tok.value };
  }

  throw s.error(`unexpected token '${tok.kind}'`);
}

function parseExpr(tokens: readonly Token[], expr: string): Node {
  const s = new ParseState(tokens, expr);
  const node = parseOr(s);
  if (!s.eof()) throw s.error(`unexpected token after expression`);
  return node;
}

// ── Evaluator ───────────────────────────────────────────────────────

function truthy(v: unknown): boolean {
  // Parallel to VSCode's ContextKeyExpr default-value semantics: any
  // non-nullish, non-false, non-zero, non-empty-string value is true.
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return true;  // objects/arrays always truthy
}

function evalNode(n: Node, ctx: WhenClauseContext): boolean {
  switch (n.kind) {
    case 'ident':   return truthy(ctx[n.name]);
    case 'literal': return truthy(n.value);
    case 'not':     return !evalNode(n.inner, ctx);
    case 'and':     return evalNode(n.left, ctx) && evalNode(n.right, ctx);
    case 'or':      return evalNode(n.left, ctx) || evalNode(n.right, ctx);
    case 'eq':      return ctx[n.name] === n.value;
    case 'neq':     return ctx[n.name] !== n.value;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/** Parse a when-clause without evaluating it. Returns the opaque AST
 *  for later evaluation, or an error. */
export function parseWhenClause(expr: string): { ok: true; ast: Node } | { ok: false; error: WhenClauseError } {
  if (typeof expr !== 'string') {
    return { ok: false, error: { kind: 'parse', message: 'expression must be a string', expr: String(expr) } };
  }
  const trimmed = expr.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'parse', message: 'expression is empty', expr } };
  }
  if (trimmed.length > MAX_EXPR_LENGTH) {
    return { ok: false, error: { kind: 'parse', message: `expression exceeds ${MAX_EXPR_LENGTH} chars`, expr } };
  }
  const tokResult = tokenize(trimmed);
  if (tokResult.ok === false) {
    return { ok: false, error: { kind: 'parse', message: tokResult.error, expr } };
  }
  try {
    const ast = parseExpr(tokResult.tokens, trimmed);
    return { ok: true, ast };
  } catch (err) {
    if (err && typeof err === 'object' && 'kind' in (err as object)) {
      return { ok: false, error: err as WhenClauseError };
    }
    return { ok: false, error: { kind: 'parse', message: String(err), expr: trimmed } };
  }
}

/** Evaluate a when-clause string against a context snapshot. This is
 *  the hot-path API — callers that re-evaluate the same expression
 *  many times should cache the AST via `parseWhenClause` + `evalAst`. */
export function evaluateWhenClause(expr: string, ctx: WhenClauseContext): WhenClauseResult {
  const parsed = parseWhenClause(expr);
  if (parsed.ok === false) return { ok: false, error: parsed.error };
  try {
    return { ok: true, value: evalNode(parsed.ast, ctx) };
  } catch (err) {
    return { ok: false, error: { kind: 'eval', message: String(err), expr } };
  }
}

/** Evaluate a pre-parsed AST. For resolver-hot-path reuse. */
export function evalAst(ast: WhenClauseAst, ctx: WhenClauseContext): WhenClauseResult {
  try {
    return { ok: true, value: evalNode(ast as Node, ctx) };
  } catch (err) {
    return { ok: false, error: { kind: 'eval', message: String(err), expr: '(pre-parsed)' } };
  }
}

/** Opaque AST type — callers treat as black box. Used when a binding
 *  will be evaluated many times and we want to avoid re-parsing. */
export type WhenClauseAst = Node;
