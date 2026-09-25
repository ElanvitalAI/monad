// ── Lightweight syntax highlighter — Catppuccin Mocha palette ──
// Regex-based, not a real tokenizer. Used by preview-pane for in-TUI code
// coloring. Each language function takes the raw line and returns an
// ANSI-colored string.
//
// IMPORTANT — ANSI-nesting bug
// ────────────────────────────
// The original implementation ran replace calls sequentially against the
// same string. Once the first replace inserted an ANSI escape like
// `\x1b[38;2;203;166;247m`, a LATER replace (e.g. `\b(\d+)\b` for
// number literals) matched digits INSIDE that escape — `38`, `2`, `203`,
// `166`, `247` all got recoloured, producing corrupted nested escapes
// that rendered as garbage in strict terminal parsers. We now split each
// line by ANSI escape boundaries and apply replaces ONLY to plain-text
// segments. The escape sequences themselves pass through untouched.
//
// codex has an equivalent utility (ansi-escape/lib.rs) that normalises
// tabs globally. We expose `normalizeTabs` here so both this colouriser
// and the chat tool-render layer can depend on a single definition.

import chalk from 'chalk';
import { ICONS } from '../tui.js';

export const SYN = {
  keyword:  chalk.hex('#cba6f7'),
  string:   chalk.hex('#a6e3a1'),
  comment:  chalk.hex('#6c7086'),
  number:   chalk.hex('#fab387'),
  func:     chalk.hex('#89b4fa'),
  type:     chalk.hex('#89dceb'),
  import:   chalk.hex('#cba6f7'),
  tag:      chalk.hex('#f38ba8'),
  attr:     chalk.hex('#f9e2af'),
  value:    chalk.hex('#a6e3a1'),
  punct:    chalk.hex('#9399b2'),
  text:     (s: string) => s,
  heading:  chalk.bold.hex('#89b4fa'),
  link:     chalk.underline.hex('#89b4fa'),
  bullet:   chalk.hex('#f9e2af'),
  code:     chalk.bgHex('#313244').hex('#cdd6f4'),
};

/** Width used when expanding literal tab characters in code previews.
 *  4 matches codex (ansi-escape/lib.rs:6-21) and avoids the gutter
 *  alignment problems that tabs introduce when mixed with our line-
 *  number prefixes. Exported so the chat tool-render path can use the
 *  same value. */
export const TAB_WIDTH = 4;
const TAB_EXPANSION = ' '.repeat(TAB_WIDTH);

/** Expand literal `\t` characters to `TAB_WIDTH` spaces. Callers that
 *  already split line-number prefixes (Read output uses `\t` as the
 *  number/content separator) must pass ONLY the content portion — this
 *  helper is intentionally unconditional. */
export function normalizeTabs(text: string): string {
  if (!text.includes('\t')) return text;
  return text.replace(/\t/g, TAB_EXPANSION);
}

/** Apply `regex.replace(fn)` to a line but skip any substring that lies
 *  inside an ANSI SGR escape (`\x1b[ … m`). Prevents later replaces from
 *  matching digits inside the truecolor escapes emitted by earlier
 *  replaces — the classic ANSI-nesting bug. */
export function replaceOutsideAnsi(
  line: string,
  regex: RegExp,
  fn: (match: string, ...groups: string[]) => string,
): string {
  if (!line.includes('\x1b')) return line.replace(regex, fn as never);
  // Split on the escape delimiters, keeping them as separator tokens.
  // Odd indices are the escapes themselves and pass through untouched.
  const parts = line.split(/(\x1b\[[0-9;]*m)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(regex, fn as never);
  }
  return parts.join('');
}

/** Chain multiple regex/callback pairs through `replaceOutsideAnsi`.
 *  Each pair runs in order; each pair's output feeds the next pair.
 *  Keeps language branches readable despite the protected-replace
 *  indirection. */
function chainReplaceOutsideAnsi(
  line: string,
  pairs: Array<[RegExp, (match: string, ...groups: string[]) => string]>,
): string {
  let out = line;
  for (const [re, fn] of pairs) {
    out = replaceOutsideAnsi(out, re, fn);
  }
  return out;
}

export function colorLine(line: string, ext: string): string {
  if (ext === '.md') {
    if (line.match(/^#{1,6}\s/))  return SYN.heading(line);
    if (line.match(/^>\s/))       return chalk.dim('│ ') + SYN.text(line.slice(2));
    if (line.match(/^[-*]\s/))    return SYN.bullet('  ' + ICONS.dot + ' ') + SYN.text(line.slice(2));
    if (line.match(/^\d+\.\s/))   return SYN.number(line.match(/^(\d+\.)/)?.[1] || '') + SYN.text(line.replace(/^\d+\./, ''));
    if (line.startsWith('```'))   return SYN.comment(line);
    if (line.startsWith('---'))   return chalk.dim(line);
    return chainReplaceOutsideAnsi(line, [
      [/`([^`]+)`/g,                 (_m, c) => SYN.code(c)],
      [/\*\*([^*]+)\*\*/g,           (_m, c) => chalk.bold(c)],
      [/\[([^\]]+)\]\([^)]+\)/g,     (_m, txt) => SYN.link(txt)],
    ]);
  }

  if (ext === '.json') {
    return chainReplaceOutsideAnsi(line, [
      [/"([^"]+)"\s*:/g,              (_m, k) => SYN.attr(`"${k}"`) + SYN.punct(':')],
      [/:\s*"([^"]*)"/,               (_m, v) => SYN.punct(': ') + SYN.string(`"${v}"`)],
      [/:\s*(\d+)/g,                  (_m, n) => SYN.punct(': ') + SYN.number(n)],
      [/:\s*(true|false|null)/g,      (_m, v) => SYN.punct(': ') + SYN.keyword(v)],
    ]);
  }

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    if (line.match(/^\s*\/\//))   return SYN.comment(line);
    if (line.match(/^\s*\*/))     return SYN.comment(line);
    if (line.match(/^\s*\/\*/))   return SYN.comment(line);
    return chainReplaceOutsideAnsi(line, [
      // Numbers FIRST (before any keyword replace inserts escapes with
      // digits). Word-boundary `\b` still matches inside plain segments.
      [/\b(\d+\.?\d*)\b/g,                                                                             (_m, n) => SYN.number(n)],
      [/\b(true|false|null|undefined|NaN|Infinity)\b/g,                                               (_m, k) => SYN.number(k)],
      [/\b(import|export|from|require|default|as)\b/g,                                                (_m, k) => SYN.import(k)],
      [/\b(const|let|var|function|class|interface|type|enum|namespace|declare|abstract|readonly)\b/g, (_m, k) => SYN.keyword(k)],
      [/\b(async|await|return|yield|throw|new|delete|typeof|instanceof|void|in|of)\b/g,              (_m, k) => SYN.keyword(k)],
      [/\b(if|else|for|while|do|switch|case|break|continue|try|catch|finally)\b/g,                   (_m, k) => SYN.keyword(k)],
      [/'([^']*)'/g,                                                                                   (_m, s) => SYN.string(`'${s}'`)],
      [/"([^"]*)"/g,                                                                                   (_m, s) => SYN.string(`"${s}"`)],
      [/`([^`]*)`/g,                                                                                   (_m, s) => SYN.string('`' + s + '`')],
      [/\/\/(.*)$/g,                                                                                   (_m, c) => SYN.comment('//' + c)],
    ]);
  }

  if (ext === '.py') {
    if (line.match(/^\s*#/))      return SYN.comment(line);
    if (line.match(/^\s*"""/))    return SYN.string(line);
    return chainReplaceOutsideAnsi(line, [
      [/\b(\d+\.?\d*)\b/g,                                                                                              (_m, n) => SYN.number(n)],
      [/\b(True|False|None)\b/g,                                                                                        (_m, k) => SYN.number(k)],
      [/\b(def|class|import|from|as|if|elif|else|for|while|return|with|try|except|finally|raise|yield|lambda|global|nonlocal|assert|pass|break|continue|del|in|not|and|or|is)\b/g, (_m, k) => SYN.keyword(k)],
      [/'([^']*)'/g,                                                                                                    (_m, s) => SYN.string(`'${s}'`)],
      [/"([^"]*)"/g,                                                                                                    (_m, s) => SYN.string(`"${s}"`)],
      [/#(.*)$/g,                                                                                                       (_m, c) => SYN.comment('#' + c)],
      [/@(\w+)/g,                                                                                                       (_m, d) => SYN.import('@' + d)],
    ]);
  }

  if (['.sh', '.bash', '.zsh'].includes(ext)) {
    if (line.match(/^\s*#/))      return SYN.comment(line);
    return chainReplaceOutsideAnsi(line, [
      [/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|local|export|source|eval)\b/g, (_m, k) => SYN.keyword(k)],
      [/\$\{?[\w]+\}?/g,                                                                                   (v) => SYN.number(v)],
      [/"([^"]*)"/g,                                                                                       (_m, s) => SYN.string(`"${s}"`)],
      [/'([^']*)'/g,                                                                                       (_m, s) => SYN.string(`'${s}'`)],
    ]);
  }

  if (['.yaml', '.yml', '.toml'].includes(ext)) {
    if (line.match(/^\s*#/))      return SYN.comment(line);
    return chainReplaceOutsideAnsi(line, [
      [/\b(\d+\.?\d*)\b/g,                    (_m, n) => SYN.number(n)],
      [/^(\s*[\w.-]+)(:)/g,                    (_m, k, c) => SYN.attr(k) + SYN.punct(c)],
      [/:\s*"([^"]*)"/,                        (_m, v) => SYN.punct(': ') + SYN.string(`"${v}"`)],
      [/:\s*'([^']*)'/,                        (_m, v) => SYN.punct(': ') + SYN.string(`'${v}'`)],
      [/\b(true|false|null|yes|no)\b/gi,       (_m, k) => SYN.keyword(k)],
    ]);
  }

  if (ext === '.env' || line.match(/^[A-Z_]+=.+/)) {
    const eq = line.indexOf('=');
    if (eq > 0) return SYN.attr(line.slice(0, eq)) + SYN.punct('=') + SYN.value(line.slice(eq + 1));
  }

  if (ext === '.css') {
    if (line.match(/^\s*\/\*/))   return SYN.comment(line);
    return chainReplaceOutsideAnsi(line, [
      [/\b(\d+)(px|em|rem|%|vh|vw|s|ms)\b/g,   (_m, n, u) => SYN.number(n) + SYN.keyword(u)],
      [/([\w-]+)\s*:/g,                         (_m, p) => SYN.attr(p) + SYN.punct(':')],
      [/#[\da-fA-F]{3,8}/g,                     (c) => SYN.number(c)],
    ]);
  }

  if (ext === '.html' || ext === '.xml' || ext === '.svg') {
    return chainReplaceOutsideAnsi(line, [
      [/<\/?(\w+)/g,        (_m, t) => SYN.tag('<' + t)],
      [/(\w+)=/g,            (_m, a) => SYN.attr(a) + SYN.punct('=')],
      [/"([^"]*)"/g,         (_m, v) => SYN.string(`"${v}"`)],
    ]);
  }

  if (ext === '.sql') {
    return chainReplaceOutsideAnsi(line, [
      [/\b(\d+)\b/g,                                                                                     (_m, n) => SYN.number(n)],
      [/\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|AS|SET|VALUES|INTO|NULL|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|DEFAULT|CHECK|CASCADE|CONSTRAINT|IF|EXISTS|BEGIN|END|COMMIT|ROLLBACK)\b/gi, (_m, k) => SYN.keyword(k.toUpperCase())],
      [/'([^']*)'/g,                                                                                     (_m, s) => SYN.string(`'${s}'`)],
      [/--(.*)$/g,                                                                                       (_m, c) => SYN.comment('--' + c)],
    ]);
  }

  return SYN.text(line);
}
