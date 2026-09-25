// PLAN-ipad-notes-obsidian-typora §5 Phase O4·7 (2026-05-17) —
// Daemon-side Templates smart fill.
//
// Reads a template file from the vault, expands Obsidian-flavored
// `{{variable}}` tokens, and returns the resulting markdown. The
// iPad Toolbar Today menu chains this output into `notes-save` so a
// "Daily/2026-05-17.md" creation never needs the user to type the
// date manually.
//
// Supported variables (Obsidian's core set · Moment.js tokens
// subset):
//   {{date}}                    → 2026-05-17  (ISO YYYY-MM-DD)
//   {{date:FORMAT}}             → custom format (e.g. {{date:dddd, MMMM Do YYYY}})
//   {{time}}                    → 14:30  (24-hour HH:mm)
//   {{time:FORMAT}}             → custom format
//   {{title}}                   → caller-provided title (e.g. "Daily")
//   {{cursor}}                  → preserved as-is for the editor to
//                                  consume (future polish would map to
//                                  CodeMirror caret position)
//
// Format tokens (matched longest-first so YYYY beats YY etc):
//   YYYY · YY · MMMM · MMM · MM · M · DD · D · dddd · ddd · Do ·
//   HH · H · hh · h · mm · m · ss · s · A · a
//
// Anything we don't recognize stays literal — Obsidian's full set is
// larger, but this covers the 99% case. A follow-up can land Do
// suffixes (1st/2nd/3rd) + escape sequences if users ask.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ExpandTemplateOpts {
  vaultRoot: string;
  /** Vault-relative path to the template file (e.g. "Templates/Daily.md"). */
  templatePath: string;
  /** Replacement for `{{title}}` tokens. Defaults to the template's
   *  basename (e.g. "Daily") when omitted. */
  title?: string;
  /** Override the clock — test seam so unit tests don't drift. */
  now?: Date;
  /** Override readFile — test seam for unreadable / fixture content. */
  readFileFn?: (path: string) => Promise<string>;
}

export interface ExpandTemplateResult {
  /** Expanded template body. Empty string when error is set. */
  content: string;
  /** Tokens encountered during expansion (deduped). Useful for
   *  preview UIs that want to show "this template uses {{date}},
   *  {{title}}". */
  tokensExpanded: string[];
  error?: string;
}

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS_FULL.map(m => m.slice(0, 3));
const WEEKDAYS_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
const WEEKDAYS_SHORT = WEEKDAYS_FULL.map(d => d.slice(0, 3));

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Format `d` using Moment.js-style tokens. Tokens matched longest-first
 *  via a single regex so nested matches don't double-substitute. */
export function formatDate(d: Date, fmt: string): string {
  const year = d.getFullYear();
  const month = d.getMonth();      // 0..11
  const day = d.getDate();         // 1..31
  const weekday = d.getDay();      // 0..6
  const hour24 = d.getHours();
  const hour12raw = hour24 % 12;
  const hour12 = hour12raw === 0 ? 12 : hour12raw;
  const minute = d.getMinutes();
  const second = d.getSeconds();

  // Longest tokens first so `YYYY` doesn't get matched as `YY` + `YY`.
  // Each token + its replacement is a (regex, value) pair scanned in order.
  const map: Array<[string, string]> = [
    ['YYYY', `${year}`],
    ['YY', `${year % 100}`.padStart(2, '0')],
    ['MMMM', MONTHS_FULL[month]!],
    ['MMM', MONTHS_SHORT[month]!],
    ['MM', pad2(month + 1)],
    ['M', `${month + 1}`],
    ['DD', pad2(day)],
    ['Do', ordinal(day)],
    ['D', `${day}`],
    ['dddd', WEEKDAYS_FULL[weekday]!],
    ['ddd', WEEKDAYS_SHORT[weekday]!],
    ['HH', pad2(hour24)],
    ['H', `${hour24}`],
    ['hh', pad2(hour12)],
    ['h', `${hour12}`],
    ['mm', pad2(minute)],
    ['m', `${minute}`],
    ['ss', pad2(second)],
    ['s', `${second}`],
    ['A', hour24 < 12 ? 'AM' : 'PM'],
    ['a', hour24 < 12 ? 'am' : 'pm'],
  ];

  // Walk the format string and replace longest-prefix tokens at each
  // position. Moment-style `[literal text]` escapes the contents so
  // characters that happen to coincide with token names (`D` in "Date")
  // don't get substituted. This is more correct than chained
  // .replaceAll() (which would re-substitute literal text from earlier
  // replacements).
  let out = '';
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] === '[') {
      const end = fmt.indexOf(']', i + 1);
      if (end >= 0) {
        out += fmt.slice(i + 1, end);
        i = end + 1;
        continue;
      }
      // Unmatched `[` — emit literally and continue.
      out += fmt[i]!;
      i++;
      continue;
    }
    let matched = false;
    for (const [tok, val] of map) {
      if (fmt.startsWith(tok, i)) {
        out += val;
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += fmt[i]!;
      i++;
    }
  }
  return out;
}

const TOKEN_RE = /\{\{([^{}]+?)\}\}/g;

/** Expand variables in `content` using the date/title context.
 *  Pure — `readFile` not used; exposed for unit testing the regex
 *  + format pass without seeding a vault. */
export function expandTemplateBody(
  content: string,
  ctx: { now: Date; title: string },
): { content: string; tokensExpanded: string[] } {
  const tokensSeen = new Set<string>();
  const expanded = content.replace(TOKEN_RE, (match, raw: string) => {
    const trimmed = raw.trim();
    tokensSeen.add(trimmed);
    // {{date}} / {{date:FORMAT}}
    if (trimmed === 'date') return formatDate(ctx.now, 'YYYY-MM-DD');
    if (trimmed.startsWith('date:')) {
      return formatDate(ctx.now, trimmed.slice(5));
    }
    // {{time}} / {{time:FORMAT}}
    if (trimmed === 'time') return formatDate(ctx.now, 'HH:mm');
    if (trimmed.startsWith('time:')) {
      return formatDate(ctx.now, trimmed.slice(5));
    }
    if (trimmed === 'title') return ctx.title;
    // {{cursor}} stays literal — editors substitute caret position.
    if (trimmed === 'cursor') return '{{cursor}}';
    // Unrecognized token — leave the raw `{{…}}` alone so the user
    // can spot it instead of silently dropping content.
    return match;
  });
  return { content: expanded, tokensExpanded: [...tokensSeen] };
}

export async function expandTemplate(opts: ExpandTemplateOpts): Promise<ExpandTemplateResult> {
  const now = opts.now ?? new Date();
  const read = opts.readFileFn ?? ((p: string) => readFile(p, 'utf8'));
  const title = opts.title ?? opts.templatePath
    .replace(/^.*\//, '')
    .replace(/\.md$/i, '');
  let raw: string;
  try {
    raw = await read(join(opts.vaultRoot, opts.templatePath));
  } catch (e) {
    return {
      content: '',
      tokensExpanded: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const { content, tokensExpanded } = expandTemplateBody(raw, { now, title });
  return { content, tokensExpanded };
}
