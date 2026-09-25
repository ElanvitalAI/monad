// Tokenizer for when-clause. Split into its own file so the table of
// token shapes is testable without pulling in the parser.
//
// Tokens:
//   ident       — [a-zA-Z_][a-zA-Z0-9_.]*   (dotted ids allowed for
//                 namespaced keys like `pfc.autoModeActive`)
//   literal     — quoted string, number, true, false, null, undefined
//   and/or/bang — &&, ||, !
//   eq/neq      — ==, !=
//   lparen/rparen — (, )
//
// Non-tokens (errors): single &, single |, unterminated string, dangling
// dot, non-ASCII letters (keep grammar predictable for JSON config).

export type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'literal'; value: unknown }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'bang' }
  | { kind: 'eq' }
  | { kind: 'neq' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

export interface TokenizeSuccess { ok: true; tokens: readonly Token[] }
export interface TokenizeFailure { ok: false; error: string }
export type TokenizeResult = TokenizeSuccess | TokenizeFailure;

const IDENT_START = /[a-zA-Z_]/;
const IDENT_CONT = /[a-zA-Z0-9_.]/;
const DIGIT = /[0-9]/;

export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i]!;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }

    if (ch === '&') {
      if (src[i + 1] !== '&') return { ok: false, error: `single '&' at position ${i} (did you mean '&&'?)` };
      tokens.push({ kind: 'and' }); i += 2; continue;
    }

    if (ch === '|') {
      if (src[i + 1] !== '|') return { ok: false, error: `single '|' at position ${i} (did you mean '||'?)` };
      tokens.push({ kind: 'or' }); i += 2; continue;
    }

    if (ch === '=') {
      if (src[i + 1] !== '=') return { ok: false, error: `single '=' at position ${i} (did you mean '=='?)` };
      tokens.push({ kind: 'eq' }); i += 2; continue;
    }

    if (ch === '!') {
      if (src[i + 1] === '=') { tokens.push({ kind: 'neq' }); i += 2; continue; }
      tokens.push({ kind: 'bang' }); i++; continue;
    }

    // String literal
    if (ch === '"' || ch === '\'') {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) {
          // Minimal escape: \\, \', \", \n, \t
          const next = src[j + 1]!;
          if (next === '\\' || next === '\'' || next === '"') value += next;
          else if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else value += src[j] + next;
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      if (j >= n) return { ok: false, error: `unterminated string starting at position ${i}` };
      tokens.push({ kind: 'literal', value });
      i = j + 1;
      continue;
    }

    // Number literal
    if (DIGIT.test(ch) || (ch === '-' && i + 1 < n && DIGIT.test(src[i + 1]!))) {
      let j = i + 1;
      let sawDot = false;
      while (j < n) {
        const c = src[j]!;
        if (c === '.' && !sawDot) { sawDot = true; j++; continue; }
        if (DIGIT.test(c)) { j++; continue; }
        break;
      }
      const raw = src.slice(i, j);
      const num = Number(raw);
      if (Number.isNaN(num)) return { ok: false, error: `invalid number '${raw}' at position ${i}` };
      tokens.push({ kind: 'literal', value: num });
      i = j;
      continue;
    }

    // Identifier or keyword literal
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_CONT.test(src[j]!)) j++;
      const ident = src.slice(i, j);
      // Guard: ident must not end with a dot (dangling namespace)
      if (ident.endsWith('.') || ident.includes('..')) {
        return { ok: false, error: `invalid identifier '${ident}' at position ${i}` };
      }
      if (ident === 'true') tokens.push({ kind: 'literal', value: true });
      else if (ident === 'false') tokens.push({ kind: 'literal', value: false });
      else if (ident === 'null') tokens.push({ kind: 'literal', value: null });
      else if (ident === 'undefined') tokens.push({ kind: 'literal', value: undefined });
      else tokens.push({ kind: 'ident', value: ident });
      i = j;
      continue;
    }

    return { ok: false, error: `unexpected character '${ch}' at position ${i}` };
  }

  return { ok: true, tokens };
}
