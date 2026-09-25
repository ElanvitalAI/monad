// ── Pane I/O contract ──
//
// Phase E — lets an agent read current pane contents and write back
// into writable pane types. Implementation is intentionally a pure
// set of helpers that take WidgetInstance values; the dashboard / host
// tool layer plumbs them (Phase E2/E3/E4 follow-up) so the agent
// runtime never imports the UI tree directly.
//
// Widget-type dispatch:
//   - list:       read = items; write = { items, icons?, selected? }
//   - markdown:   read = text;  write = { text } | { appendText }
//   - log:        read = lines; write = { append }  (read-only by default)
//   - table:      read = rendered rows; write = { rows, columns? }
//   - chart-line: read = series summary; write = { series, unit? }
//   - unknown:    returns { ok: false } so the agent learns the widget
//                 type isn't writable, rather than crashing.

import type { WidgetInstance } from '../widgets/types.js';
import type { WidgetSpec } from '../ui/declarative/spec.js';

// ── Public shapes returned to LLM tools ──

/** Compact descriptor the agent sees in `pane.list`. */
export interface PaneDescriptor {
  id: string;
  character: string;
  type: string;
  role: 'source' | 'sink' | 'both' | 'unknown';
  /** Short, LLM-readable summary — "list (3 items, cursor 0)", etc. */
  summary: string;
  readable: boolean;
  writable: boolean;
}

/** Result of `pane.read`. */
export interface PaneReadResult {
  ok: boolean;
  id: string;
  type: string;
  /** Plain text extracted from the widget's current state. */
  text?: string;
  /** Structured alternative — lets LLMs reason about rows/series
   *  without string-parsing `text`. */
  data?: unknown;
  error?: string;
}

/** Payload union accepted by `pane.write`. Each variant maps to a
 *  specific widget type; type mismatches are rejected. */
export type PaneWritePayload =
  | { text: string }                                                                  // markdown
  | { appendText: string }                                                            // markdown (append)
  | { items: string[]; icons?: string[]; selected?: string[] }                        // list
  | { rows: Record<string, string | number>[]; columns?: unknown[] }                  // table
  | { series: number[]; unit?: string }                                               // chart-line
  | { append: string }                                                                // log
  | { lines: string[] };                                                              // log (replace)

/** Result of `pane.write`. */
export interface PaneWriteResult {
  ok: boolean;
  id: string;
  type: string;
  error?: string;
}

// ── Capability table ──
//
// Kept as a const so the test harness can enumerate every supported
// widget type without re-implementing the dispatch. When a new
// writable widget type ships, add one entry here.

const WIDGET_CAPS: Record<string, { readable: boolean; writable: boolean; role: PaneDescriptor['role'] }> = {
  list:         { readable: true, writable: true,  role: 'both' },
  markdown:     { readable: true, writable: true,  role: 'both' },
  table:        { readable: true, writable: true,  role: 'both' },
  'chart-line': { readable: true, writable: true,  role: 'both' },
  log:          { readable: true, writable: true,  role: 'sink' },    // append-mostly
};

export function widgetCaps(type: string) {
  return WIDGET_CAPS[type] ?? { readable: false, writable: false, role: 'unknown' as const };
}

// ── listPanes ──

/** Build descriptors for an array of widget instances. Non-widget
 *  host panes (chat input, etc.) aren't included — this operates
 *  strictly on widget instances the LLM can address by id. */
export function listPanes(instances: WidgetInstance[]): PaneDescriptor[] {
  return instances.map(inst => {
    const caps = widgetCaps(inst.type);
    return {
      id: inst.id,
      character: inst.character,
      type: inst.type,
      role: caps.role,
      summary: summarise(inst),
      readable: caps.readable,
      writable: caps.writable,
    };
  });
}

function summarise(inst: WidgetInstance): string {
  const s = inst.state as any;
  const chromeTitle = declarativeChromeTitle(inst);
  const suffix = chromeTitle && chromeTitle !== inst.character ? ` · title "${chromeTitle}"` : '';
  switch (inst.type) {
    case 'list':       return `list (${s?.items?.length ?? 0} items, cursor ${s?.cursor ?? -1})${suffix}`;
    case 'markdown':   return `markdown (${(s?.text ?? '').length} chars)${suffix}`;
    case 'table':      return `table (${s?.rows?.length ?? 0} rows × ${s?.columns?.length ?? 0} cols)${suffix}`;
    case 'chart-line': return `chart-line (${s?.series?.length ?? 0} points)${suffix}`;
    case 'log':        return `log (${s?.lines?.length ?? 0} lines)${suffix}`;
    default:           return `${inst.type}${suffix}`;
  }
}

function declarativeChromeTitle(inst: WidgetInstance): string | null {
  const spec = inst.meta?.declarativeSpec as WidgetSpec | undefined;
  return typeof spec?.chrome?.title === 'string' ? spec.chrome.title : null;
}

// ── readPane ──

export function readPane(inst: WidgetInstance): PaneReadResult {
  const caps = widgetCaps(inst.type);
  if (!caps.readable) {
    return { ok: false, id: inst.id, type: inst.type, error: `widget type "${inst.type}" is not readable` };
  }
  const s = inst.state as any;
  switch (inst.type) {
    case 'markdown':
      return { ok: true, id: inst.id, type: inst.type, text: String(s?.text ?? '') };
    case 'list': {
      const items: string[] = Array.isArray(s?.items) ? s.items : [];
      return {
        ok: true, id: inst.id, type: inst.type,
        text: items.join('\n'),
        data: { items, cursor: s?.cursor ?? -1, selected: s?.selected ? [...s.selected] : [] },
      };
    }
    case 'table': {
      const rows = Array.isArray(s?.rows) ? s.rows : [];
      const cols = Array.isArray(s?.columns) ? s.columns : [];
      // Simple tab-separated rendering — keeps the text compact for
      // quoting but doesn't try to re-pretty the table.
      const header = cols.map((c: any) => c.header ?? c.key ?? '').join('\t');
      const body = rows.map((r: any) =>
        cols.map((c: any) => String(r?.[c.key] ?? '')).join('\t'),
      ).join('\n');
      const text = header ? `${header}\n${body}` : body;
      return { ok: true, id: inst.id, type: inst.type, text, data: { rows, columns: cols } };
    }
    case 'chart-line': {
      const series: number[] = Array.isArray(s?.series) ? s.series : [];
      return {
        ok: true, id: inst.id, type: inst.type,
        text: series.join(', '),
        data: { series, unit: s?.unit, color: s?.color },
      };
    }
    case 'log': {
      const lines: string[] = Array.isArray(s?.lines) ? s.lines : [];
      return { ok: true, id: inst.id, type: inst.type, text: lines.join('\n'), data: { lines } };
    }
    default:
      return { ok: false, id: inst.id, type: inst.type, error: `unsupported widget type "${inst.type}"` };
  }
}

// ── writePane ──

export function writePane(inst: WidgetInstance, payload: PaneWritePayload): PaneWriteResult {
  const caps = widgetCaps(inst.type);
  if (!caps.writable) {
    return { ok: false, id: inst.id, type: inst.type, error: `widget type "${inst.type}" is not writable` };
  }
  const s = inst.state as any;
  const p = payload as any;

  switch (inst.type) {
    case 'markdown': {
      if (typeof p.text === 'string') {
        s.text = p.text;
        return { ok: true, id: inst.id, type: inst.type };
      }
      if (typeof p.appendText === 'string') {
        s.text = String(s.text ?? '') + p.appendText;
        return { ok: true, id: inst.id, type: inst.type };
      }
      return { ok: false, id: inst.id, type: inst.type, error: 'markdown write requires { text } or { appendText }' };
    }
    case 'list': {
      if (Array.isArray(p.items)) {
        s.items = p.items.slice();
        if (Array.isArray(p.icons)) s.icons = p.icons.slice();
        if (Array.isArray(p.selected)) s.selected = new Set(p.selected);
        if (typeof s.cursor === 'number' && s.cursor >= s.items.length) {
          s.cursor = Math.max(0, s.items.length - 1);
        }
        return { ok: true, id: inst.id, type: inst.type };
      }
      return { ok: false, id: inst.id, type: inst.type, error: 'list write requires { items }' };
    }
    case 'table': {
      if (Array.isArray(p.rows)) {
        s.rows = p.rows.slice();
        if (Array.isArray(p.columns)) s.columns = p.columns.slice();
        if (typeof s.cursor === 'number' && s.cursor >= s.rows.length) {
          s.cursor = s.rows.length > 0 ? s.rows.length - 1 : -1;
        }
        return { ok: true, id: inst.id, type: inst.type };
      }
      return { ok: false, id: inst.id, type: inst.type, error: 'table write requires { rows }' };
    }
    case 'chart-line': {
      if (Array.isArray(p.series)) {
        s.series = p.series.slice();
        if (typeof p.unit === 'string') s.unit = p.unit;
        return { ok: true, id: inst.id, type: inst.type };
      }
      return { ok: false, id: inst.id, type: inst.type, error: 'chart-line write requires { series }' };
    }
    case 'log': {
      if (typeof p.append === 'string') {
        if (!Array.isArray(s.lines)) s.lines = [];
        s.lines.push(p.append);
        return { ok: true, id: inst.id, type: inst.type };
      }
      if (Array.isArray(p.lines)) {
        s.lines = p.lines.slice();
        return { ok: true, id: inst.id, type: inst.type };
      }
      return { ok: false, id: inst.id, type: inst.type, error: 'log write requires { append } or { lines }' };
    }
    default:
      return { ok: false, id: inst.id, type: inst.type, error: `unsupported widget type "${inst.type}"` };
  }
}

// ── @pane token resolver ──
//
// Expand `@pane:<id>` tokens embedded in user text into an inline
// attachment block carrying the referenced pane's current contents.
// The dashboard input layer can invoke this before sending a user
// message to the LLM so the agent sees concrete pane state rather
// than an unresolved reference.

const PANE_TOKEN_RE = /@pane:([a-zA-Z0-9_:.-]+)/g;

export function resolvePaneTokens(
  text: string,
  lookup: (id: string) => WidgetInstance | null,
): { text: string; resolved: string[]; missing: string[] } {
  const resolved: string[] = [];
  const missing: string[] = [];
  const segments: string[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = PANE_TOKEN_RE.exec(text)) !== null) {
    const [whole, id] = match;
    segments.push(text.slice(lastIdx, match.index));
    const inst = lookup(id!);
    if (!inst) {
      missing.push(id!);
      segments.push(whole);   // leave token literal when unresolved
    } else {
      const read = readPane(inst);
      if (!read.ok) {
        missing.push(id!);
        segments.push(whole);
      } else {
        resolved.push(id!);
        const body = read.text ?? '';
        segments.push(`\n[pane:${id} (${inst.type})]\n\`\`\`\n${body}\n\`\`\`\n`);
      }
    }
    lastIdx = match.index + whole.length;
  }
  segments.push(text.slice(lastIdx));

  return { text: segments.join(''), resolved, missing };
}
