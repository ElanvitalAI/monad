// VP6 — Widget Playground instance (3-column sandbox).
//
// Left   : component/widget/modal browser (catalog from playground-catalog.ts)
// Right  : live preview of the selected entry
// Bottom : 1-line inspect row — id + title + props-json
//         (the view-config puts a log pane below playground for logs)
//
// Rewritten from the VP2-VP5 3×3 grid into a browser + preview layout
// so component verification has a bigger canvas. The catalog lives in
// `playground-catalog.ts`; this module owns navigation + drawing +
// key/mouse dispatch only.
//
// Interaction (browse mode):
//   ↑↓ / j/k         — move cursor up/down (skips group headers)
//   ← / h            — previous entry (wrap)
//   → / l / tab      — next entry (wrap)
//   shift+tab        — collapse / expand the current group
//   pageup / pagedn  — jump to the previous / next group's first entry
//   1 / 2 / 3        — preview size: small / medium / large
//   r                — request widget-host reload (VP5 kept)
//   enter            — refresh preview (logs a no-op tick)
//   e                — switch to F-B5b YAML edit mode
//
// Interaction (edit mode — F-B5b):
//   Esc              — return to browse mode
//   (future phases)  — TextArea typing, playback, error jump
//
// Render contract (WidgetDef): returns exactly ctx.height rows,
// padded/clipped to ctx.width.

import type { WidgetDef } from '../widgets/types.js';
import { C } from '../tui.js';
import { Printer } from '../ui/printer.js';
import { BoxView, TextView, type View } from '../ui/view.js';
import { paneTitle } from '../panes/pane-title.js';
import type {
  PlaygroundChromeMotionMode,
  PlaygroundChromeTarget,
  PlaygroundChromeVariant,
  PlaygroundPresetOptionEntry,
  PlaygroundLabFeedback,
  PlaygroundScenarioPaletteEntry,
  PlaygroundShowcaseEntry,
  PlaygroundThemeOptionEntry,
} from './lab.js';
import {
  nextAffectiveChromeState,
  nextPlaygroundChromeMotionMode,
  nextPlaygroundChromeTarget,
  nextPlaygroundChromeVariant,
} from './lab.js';
import {
  parseScenarioYaml,
  type ScenarioParseResult,
} from '../playground-scenario/index.js';
import sparklineWidget from '../../widgets/sparkline/widget.js';
import faderWidget from '../../widgets/fader/widget.js';
import heatmapWidget from '../../widgets/heatmap/widget.js';
import { canvasFactory } from '../canvas/index.js';
import { getTheme } from '../themes/index.js';
import { resolveModalChromeBoxOptions } from '../ui/chrome/modal-chrome-box.js';
import type { AffectiveChromeState } from '../ui/chrome/affective-chrome-state.js';
import {
  catalogGroups,
  countsByGroup,
  getCatalog,
  type CatalogEntry,
  type CatalogGroup,
  type CatalogGroupMeta,
} from './catalog.js';

export type PlaygroundSize = 'small' | 'medium' | 'large';

/** F-B5b — two modes. 'browse' keeps the original VP6 sandbox.
 *  'edit' opens the reactive YAML workspace (3-panel: editor /
 *  preview / errors). */
export type PlaygroundMode = 'browse' | 'edit';

export type PlaygroundGroupOpen = Record<CatalogGroup, boolean>;

export interface PlaygroundSlotSnapshot {
  id: string;
  title: string;
  group: CatalogGroup;
  props: Record<string, unknown>;
}

export interface PlaygroundWidgetState {
  cursor: number;
  previewSize: PlaygroundSize;
  groupOpen: PlaygroundGroupOpen;
  browserScroll: number;
  slots: PlaygroundSlotSnapshot[];
  focused: boolean;
  lastOriginRow?: number;
  lastOriginCol?: number;
  lastWidth?: number;
  lastHeight?: number;
  /** VP5 — widget-host reload request. Dashboard polls this per-redraw. */
  reloadRequestedAt?: number;
  /** Legacy field name kept for callers that haven't migrated. Maps to
   *  previewSize so existing tests / snapshot consumers still work. */
  size: PlaygroundSize;
  /** F-B5b — current mode. Defaults to 'browse'. `e` toggles into
   *  'edit' when the widget is focused; Esc returns to 'browse'. */
  mode: PlaygroundMode;
  /** I1 Bundle A — currently loaded scenario YAML source for the
   *  in-playground editor surface. */
  editSource: string;
  /** Cursor position within `editSource` (character offset). */
  editCursor: number;
  /** Top-of-editor visible line. */
  editScrollTop: number;
  /** Last parse result for the current source. */
  editResult: ScenarioParseResult | null;
  /** Optional scenario id loaded through `/playground edit <id>`. */
  editScenarioId?: string;
  /** I1 Bundle B — registered scenario palette shown inside the lab. */
  scenarioPalette: PlaygroundScenarioPaletteEntry[];
  /** Selected row inside the in-lab scenario palette. */
  scenarioPaletteCursor: number;
  /** Last in-lab run/save/load feedback card. */
  labFeedback: PlaygroundLabFeedback | null;
  /** I1 Bundle C — registered theme options. */
  themeOptions: PlaygroundThemeOptionEntry[];
  themeCursor: number;
  /** I1 Bundle C — available IUL preset options. */
  presetOptions: PlaygroundPresetOptionEntry[];
  presetCursor: number;
  /** I1 Bundle C — chrome motion preview state. */
  chromeAffectiveState: AffectiveChromeState;
  chromeMotionDisabled: boolean;
  chromeMotionMode: PlaygroundChromeMotionMode;
  chromeVariantOverride: PlaygroundChromeVariant | null;
  chromeTargetOverride: PlaygroundChromeTarget | null;
  /** I3 Bundle A — canvas/animation showcase lane entries. */
  showcaseOptions: PlaygroundShowcaseEntry[];
  showcaseCursor: number;
  activeShowcasePluginId?: string;
  /** I3 Bundle C — in-lab rail capture/compare loop. */
  lastRailCapture: PlaygroundEmbeddedRailCapture | null;
  previousRailCapture: PlaygroundEmbeddedRailCapture | null;
  /** Dashboard polls these timestamps and performs the side effect. */
  runRequestedAt?: number;
  saveRequestedAt?: number;
  loadRequestedAt?: number;
  launchShowcaseRequestedAt?: number;
}

export interface PlaygroundWidgetConfig {
  initialSize?: PlaygroundSize;
}

interface PlaygroundEmbeddedRailCapture {
  at: number;
  showcaseId: string;
  showcaseLabel: string;
  presetId?: string;
  presetLabel?: string;
  themeName?: string;
  motionDisabled: boolean;
  affectiveState: AffectiveChromeState;
  lines: string[];
}

// ─── Flat render structure ──────────────────────────────────────────

interface BrowserRow {
  kind: 'header' | 'entry';
  group: CatalogGroup;
  /** For kind='header': group meta. For kind='entry': catalog index. */
  meta?: CatalogGroupMeta;
  entryIndex?: number;
  /** For kind='entry': position among all entries (state.cursor points here). */
  flatIndex?: number;
  /** For kind='entry': ref to the entry — only populated if the group is open. */
  entry?: CatalogEntry;
}

function snapshotsFrom(catalog: CatalogEntry[]): PlaygroundSlotSnapshot[] {
  return catalog.map(e => ({ id: e.id, title: e.title, group: e.group, props: e.props }));
}

export function playgroundSlotSnapshot(): PlaygroundSlotSnapshot[] {
  return snapshotsFrom(getCatalog());
}

function buildBrowserRows(catalog: CatalogEntry[], groupOpen: PlaygroundGroupOpen): BrowserRow[] {
  const rows: BrowserRow[] = [];
  const counts = countsByGroup();
  let flat = 0;
  for (const meta of catalogGroups()) {
    rows.push({ kind: 'header', group: meta.id, meta });
    if (!groupOpen[meta.id]) {
      // Still allocate flat indices so cursor can point to the first
      // item of each group even when collapsed. But we emit no visible
      // rows for the entries themselves.
      const toSkip = counts[meta.id];
      for (let i = 0; i < toSkip; i++) flat++;
      continue;
    }
    for (let i = 0; i < catalog.length; i++) {
      const e = catalog[i]!;
      if (e.group !== meta.id) continue;
      rows.push({ kind: 'entry', group: meta.id, entryIndex: i, flatIndex: flat, entry: e });
      flat++;
    }
  }
  return rows;
}

/** Find the flat index of the first visible entry (i.e. in an open group). */
function firstVisibleFlatIndex(catalog: CatalogEntry[], groupOpen: PlaygroundGroupOpen): number {
  let flat = 0;
  for (const meta of catalogGroups()) {
    if (groupOpen[meta.id]) {
      return flat; // first entry of the first open group
    }
    flat += catalog.filter(e => e.group === meta.id).length;
  }
  return 0;
}

/** Clamp cursor into a visible entry. If the selected group is collapsed,
 *  snap to the first visible group. */
function clampCursorToVisible(
  cursor: number,
  catalog: CatalogEntry[],
  groupOpen: PlaygroundGroupOpen,
): number {
  if (catalog.length === 0) return 0;
  const idx = Math.max(0, Math.min(catalog.length - 1, cursor));
  const group = catalog[idx]!.group;
  if (groupOpen[group]) return idx;
  return firstVisibleFlatIndex(catalog, groupOpen);
}

function groupOfCursor(catalog: CatalogEntry[], cursor: number): CatalogGroup {
  return (catalog[cursor] ?? catalog[0])!.group;
}

function moveCursor(
  state: PlaygroundWidgetState,
  catalog: CatalogEntry[],
  delta: number,
): void {
  const n = catalog.length;
  if (n === 0) return;
  let next = state.cursor;
  for (let step = 0; step < n; step++) {
    next = ((next + delta) % n + n) % n;
    const entry = catalog[next]!;
    if (state.groupOpen[entry.group]) {
      state.cursor = next;
      return;
    }
  }
  // No open group — pin cursor; caller will fall back to clamp.
  state.cursor = clampCursorToVisible(state.cursor, catalog, state.groupOpen);
}

function jumpGroup(
  state: PlaygroundWidgetState,
  catalog: CatalogEntry[],
  dir: 1 | -1,
): void {
  if (catalog.length === 0) return;
  const groups = catalogGroups();
  // Skip groups that are collapsed OR have zero catalog entries — the
  // latter keeps the jump useful when e.g. the widget-host hasn't
  // populated the 'widget' group yet.
  const navigable = groups.filter(g =>
    state.groupOpen[g.id] && catalog.some(e => e.group === g.id),
  );
  if (navigable.length === 0) return;
  const curGroup = groupOfCursor(catalog, state.cursor);
  const idx = navigable.findIndex(g => g.id === curGroup);
  const pick = idx === -1
    ? navigable[0]!
    : navigable[(idx + dir + navigable.length) % navigable.length]!;
  const firstEntry = catalog.findIndex(e => e.group === pick.id);
  if (firstEntry >= 0) state.cursor = firstEntry;
}

function toggleGroup(state: PlaygroundWidgetState, catalog: CatalogEntry[]): void {
  const group = groupOfCursor(catalog, state.cursor);
  state.groupOpen = { ...state.groupOpen, [group]: !state.groupOpen[group] };
  state.cursor = clampCursorToVisible(state.cursor, catalog, state.groupOpen);
}

// ─── Rendering ──────────────────────────────────────────────────────

function browserColumnWidth(bodyW: number): number {
  // Default 28 cols; shrink proportionally on narrow terminals.
  return Math.max(18, Math.min(32, Math.floor(bodyW * 0.32)));
}

function previewFrame(size: PlaygroundSize, inner: { w: number; h: number }): { w: number; h: number } {
  const frac = size === 'small' ? 0.55 : size === 'medium' ? 0.80 : 1.0;
  return {
    w: Math.max(10, Math.floor(inner.w * frac)),
    h: Math.max(3,  Math.floor(inner.h * frac)),
  };
}

function sizeTag(s: PlaygroundSize): string {
  if (s === 'small')  return C.warning('small');
  if (s === 'large')  return C.success('large');
  return C.accent('medium');
}

function padRight(s: string, w: number): string {
  const visible = stripAnsiForWidth(s).length;
  if (visible >= w) return s;
  return s + ' '.repeat(w - visible);
}

function stripAnsiForWidth(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function clipAnsiToWidth(s: string, width: number): string {
  const visible = stripAnsiForWidth(s);
  if (visible.length <= width) return s + ' '.repeat(Math.max(0, width - visible.length));
  const plain = visible.slice(0, Math.max(0, width - 1));
  return `${plain}…`;
}

function drawBrowser(
  p: Printer,
  state: PlaygroundWidgetState,
  catalog: CatalogEntry[],
  focused: boolean,
): void {
  const rows = buildBrowserRows(catalog, state.groupOpen);
  // Clamp scroll so the cursor row is visible.
  const cursorRowIdx = rows.findIndex(r => r.kind === 'entry' && r.flatIndex === state.cursor);
  if (cursorRowIdx >= 0) {
    if (cursorRowIdx < state.browserScroll) state.browserScroll = cursorRowIdx;
    if (cursorRowIdx >= state.browserScroll + p.height) state.browserScroll = cursorRowIdx - p.height + 1;
  }
  if (state.browserScroll < 0) state.browserScroll = 0;
  if (state.browserScroll > Math.max(0, rows.length - p.height)) {
    state.browserScroll = Math.max(0, rows.length - p.height);
  }

  for (let y = 0; y < p.height; y++) {
    const i = state.browserScroll + y;
    if (i >= rows.length) break;
    const row = rows[i]!;
    if (row.kind === 'header') {
      const meta = row.meta!;
      const caret = state.groupOpen[meta.id] ? '▼' : '▶';
      const total = catalog.filter(e => e.group === meta.id).length;
      const line = ` ${caret} ${meta.label}  ${C.muted(`(${total})`)}`;
      p.text(0, y, clipAnsiToWidth(C.bold(C.subtext(line)), p.width));
    } else {
      const entry = row.entry!;
      const isCursor = row.flatIndex === state.cursor;
      const bullet = isCursor ? (focused ? C.accent('▌') : C.subtext('▌')) : ' ';
      const label = isCursor && focused ? C.accent(entry.title) : C.text(entry.title);
      const line = `  ${bullet} ${label}`;
      p.text(0, y, clipAnsiToWidth(line, p.width));
    }
  }
}

function drawPreview(
  p: Printer,
  entry: CatalogEntry | undefined,
  state: PlaygroundWidgetState,
  focused: boolean,
): void {
  if (!entry) {
    p.text(0, 0, C.muted('  (catalog empty — widget-host not wired)'));
    return;
  }

  // Header bar — title + group + summary
  const header = `${C.accent(entry.title)}  ${C.muted('·')}  ${C.subtext(entry.group)}`;
  p.text(0, 0, clipAnsiToWidth(header, p.width));
  if (p.height > 1 && entry.summary) {
    p.text(0, 1, clipAnsiToWidth(C.muted(entry.summary), p.width));
  }

  const frameTop = 3;
  const available = { w: p.width, h: Math.max(0, p.height - frameTop) };
  if (available.w < 4 || available.h < 2) return;

  // Size-framed inner region — shrinks toward the top-left so the
  // "small" variant shows how the component behaves with less room.
  const inner = previewFrame(state.previewSize, available);
  const frame = p.sub(0, frameTop, inner.w, inner.h, { focused });

  // Light dashed border to mark the preview bounds visually.
  frame.border(C.muted(''));

  const padded = frame.sub(1, 1, Math.max(0, frame.width - 2), Math.max(0, frame.height - 2), { focused });
  if (padded.width < 2 || padded.height < 1) return;

  try {
    if (entry.view.kind === 'view') {
      const view = entry.view.view;
      if (typeof (view as unknown as { layout?: (s: unknown) => void }).layout === 'function') {
        (view as unknown as { layout: (s: { width: number; height: number }) => void }).layout({
          width: padded.width,
          height: padded.height,
        });
      }
      if (focused && typeof (view as unknown as { takeFocus?: (src?: string) => boolean }).takeFocus === 'function') {
        (view as unknown as { takeFocus: (src?: string) => boolean }).takeFocus('front');
      }
      view.draw(padded);
    } else {
      const { def, state: widgetState, character } = entry.view;
      const lines = def.render(widgetState, {
        width: padded.width,
        height: padded.height,
        focused,
        originRow: 1,
        originCol: 1,
      } as never, character);
      for (let y = 0; y < Math.min(lines.length, padded.height); y++) {
        padded.text(0, y, lines[y] ?? '');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    padded.text(0, 0, C.error(`preview error: ${msg.slice(0, Math.max(0, padded.width - 16))}`));
  }
}

// ─── Edit mode (F-B5b Phase 1 placeholder) ─────────────────────────

/** Phase 1 minimum: "you're in edit mode, nothing loaded yet". The
 *  actual 3-panel (editor / preview / errors) layout comes in
 *  subsequent phases. Goal here is to verify the toggle flows
 *  cleanly with no flash before wiring any state. */
function drawEditModePlaceholder(p: Printer, focused: boolean): void {
  const banner = ` ${C.accent('EDIT MODE')}  ${C.muted('·')}  ${C.subtext('Esc to exit')}  ${C.muted('·')}  ${C.subtext('F-B5b (scaffolding)')}`;
  p.text(0, 0, clipAnsiToWidth(banner, p.width));
  if (p.height <= 2) return;
  const divider = C.muted('─'.repeat(Math.max(0, p.width)));
  p.text(0, 1, divider);

  const bodyTop = 2;
  const msgLines = [
    '',
    C.muted('  No scenario loaded.'),
    '',
    C.muted('  To begin:'),
    `    ${C.accent('/playground edit dialog:confirm-flow')}`,
    '',
    C.muted('  The reactive editor (TextArea · live preview · errors)'),
    C.muted('  lands in F-B5b Phase 2+. This placeholder verifies the'),
    C.muted('  mode toggle is non-flashy and reversible.'),
    '',
    focused
      ? C.subtext('  Focus: edit mode (press Esc to return to browser)')
      : C.muted('  (widget unfocused)'),
  ];
  for (let i = 0; i < msgLines.length; i++) {
    const y = bodyTop + i;
    if (y >= p.height) break;
    p.text(0, y, clipAnsiToWidth(msgLines[i]!, p.width));
  }
}

function buildInspectLine(entry: CatalogEntry | undefined, width: number): string {
  if (!entry) return padRight(C.muted('  inspect: —'), width);
  const propsStr = Object.entries(entry.props)
    .map(([k, v]) => `${k}=${compactValue(v)}`)
    .join(' ') || '{}';
  const line = `  ${C.muted('inspect:')} ${C.accent(entry.id)} ${C.muted(entry.title)} ${C.subtext(propsStr)}`;
  return clipAnsiToWidth(line, width);
}

function compactValue(v: unknown): string {
  if (typeof v === 'string') return `"${v.slice(0, 24)}${v.length > 24 ? '…' : ''}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.slice(0, 3).map(compactValue).join(',')}${v.length > 3 ? ',…' : ''}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    return `{${entries.slice(0, 2).map(([k, vv]) => `${k}:${compactValue(vv)}`).join(',')}${entries.length > 2 ? ',…' : ''}}`;
  }
  return String(v);
}

function deriveScenarioEditResult(source: string): ScenarioParseResult | null {
  if (!source.trim()) return null;
  return parseScenarioYaml(source);
}

function cursorToLineCol(source: string, cursor: number): { line: number; col: number } {
  const target = Math.min(Math.max(0, cursor), source.length);
  let line = 0;
  let col = 0;
  for (let i = 0; i < target; i++) {
    if (source[i] === '\n') { line++; col = 0; }
    else col++;
  }
  return { line, col };
}

function lineColToCursor(source: string, line: number, col: number): number {
  const lines = source.split('\n');
  const clampedLine = Math.min(Math.max(0, line), Math.max(0, lines.length - 1));
  let offset = 0;
  for (let i = 0; i < clampedLine; i++) offset += lines[i]!.length + 1;
  offset += Math.min(Math.max(0, col), lines[clampedLine]?.length ?? 0);
  return offset;
}

function nextEditScrollTopForCursor(
  source: string,
  cursor: number,
  scrollTop: number,
  editorHeight: number,
): number {
  const lines = source.split('\n');
  const { line } = cursorToLineCol(source, cursor);
  const maxScroll = Math.max(0, lines.length - editorHeight);
  if (line < scrollTop) return Math.max(0, line);
  if (line >= scrollTop + editorHeight) return Math.min(maxScroll, line - editorHeight + 1);
  return Math.min(maxScroll, Math.max(0, scrollTop));
}

function renderEditHeader(width: number, label: string, summary: string): string {
  const left = ` ${C.accent(label)} `;
  const right = ` ${C.muted(summary)} `;
  const leftW = stripAnsiForWidth(left).length;
  const rightW = stripAnsiForWidth(right).length;
  if (leftW + rightW >= width) return clipAnsiToWidth(left, width);
  return left + '─'.repeat(width - leftW - rightW) + right;
}

function renderEditEditor(
  source: string,
  cursor: number,
  scrollTop: number,
  width: number,
  height: number,
): string[] {
  const lines = source.split('\n');
  const { line: cLine, col: cCol } = cursorToLineCol(source, cursor);
  const maxScroll = Math.max(0, lines.length - height);
  const top = Math.min(maxScroll, Math.max(0, scrollTop));
  const visible = lines.slice(top, top + height);
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const absLine = top + i;
    const text = visible[i] ?? '';
    const gutter = absLine < lines.length
      ? `${String(absLine + 1).padStart(3)}  `
      : '     ';
    if (absLine === cLine) {
      const col = Math.min(cCol, text.length);
      const before = text.slice(0, col);
      const at = text[col] ?? ' ';
      const after = text.slice(col + 1);
      out.push(padRight(C.muted(gutter) + before + C.accent(at) + after, width));
    } else {
      out.push(padRight(C.muted(gutter) + text, width));
    }
  }
  return out;
}

function renderScenarioPreview(
  result: ScenarioParseResult | null,
  width: number,
  height: number,
): string[] {
  const out: string[] = [];
  if (!result || !result.scenario) {
    out.push(padRight(C.muted('  (no scenario loaded)'), width));
  } else {
    const scenario = result.scenario;
    const mounts = scenario.setup?.mount ?? [];
    const validSteps = result.validSteps.length;
    out.push(padRight(C.text(`  id: ${scenario.id ?? '(draft)'}`), width));
    out.push(padRight(C.text(`  title: ${scenario.title ?? '(untitled)'}`), width));
    out.push(padRight(C.muted(`  valid steps: ${validSteps} · mounts: ${mounts.length}`), width));
    if ((scenario.tags?.length ?? 0) > 0) {
      out.push(padRight(C.muted(`  tags: ${(scenario.tags ?? []).join(', ')}`), width));
    }
    for (const mount of mounts.slice(0, Math.max(0, height - out.length))) {
      out.push(padRight(`  • ${mount.id} · ${mount.kind}`, width));
    }
    if (mounts.length === 0 && out.length < height) {
      out.push(padRight(C.muted('  (no setup.mount entries)'), width));
    }
  }
  while (out.length < height) out.push(padRight('', width));
  return out.slice(0, height);
}

function renderScenarioErrors(
  result: ScenarioParseResult | null,
  width: number,
  height: number,
): string[] {
  const out: string[] = [];
  const errors = result?.errors ?? [];
  const warnings = result?.warnings ?? [];
  if (errors.length === 0 && warnings.length === 0) {
    out.push(padRight(C.success('  no errors or warnings'), width));
  } else {
    for (const err of errors.slice(0, height)) {
      out.push(padRight(C.error(`  ✗ ${err.line}:${err.col} [${err.severity}] ${err.message}`), width));
    }
    const remaining = height - out.length;
    for (const warning of warnings.slice(0, Math.max(0, remaining))) {
      out.push(padRight(C.warning(`  ⚠ ${warning.line}:${warning.col} ${warning.message}`), width));
    }
  }
  while (out.length < height) out.push(padRight('', width));
  return out.slice(0, height);
}

function renderScenarioPalette(
  entries: PlaygroundScenarioPaletteEntry[],
  cursor: number,
  loadedScenarioId: string | undefined,
  width: number,
  height: number,
): string[] {
  if (entries.length === 0) {
    return Array.from({ length: height }, (_, idx) =>
      idx === 0 ? padRight(C.muted('  (no scenarios registered)'), width) : padRight('', width));
  }
  const out: string[] = [];
  const clampedCursor = Math.max(0, Math.min(entries.length - 1, cursor));
  const top = Math.max(0, Math.min(clampedCursor, Math.max(0, entries.length - height)));
  for (let i = 0; i < height; i++) {
    const entry = entries[top + i];
    if (!entry) {
      out.push(padRight('', width));
      continue;
    }
    const isCursor = top + i === clampedCursor;
    const isLoaded = entry.id === loadedScenarioId;
    const glyph = isLoaded ? '●' : isCursor ? '▸' : ' ';
    const label = isCursor ? C.accent(entry.id) : C.text(entry.id);
    const suffix = entry.tags.length > 0 ? C.muted(` [${entry.tags.join(',')}]`) : C.muted(` · ${entry.stepCount} step(s)`);
    out.push(padRight(` ${glyph} ${label}${suffix}`, width));
  }
  return out;
}

function renderLabFeedback(
  feedback: PlaygroundLabFeedback | null,
  width: number,
  height: number,
): string[] {
  const out: string[] = [];
  if (!feedback) {
    out.push(padRight(C.muted('  Ctrl+R run · Ctrl+S save · Ctrl+O load selected scenario'), width));
    out.push(padRight(C.muted('  Ctrl+J / Ctrl+K moves the in-lab scenario palette'), width));
  } else {
    const title =
      feedback.level === 'success' ? C.success(`  ${feedback.title}`)
        : feedback.level === 'error' ? C.error(`  ${feedback.title}`)
          : C.accent(`  ${feedback.title}`);
    out.push(padRight(title, width));
    for (const line of feedback.lines.slice(0, Math.max(0, height - 1))) {
      out.push(padRight(`  ${line}`, width));
    }
  }
  while (out.length < height) out.push(padRight('', width));
  return out.slice(0, height);
}

const EMBEDDED_ANIMATION_HANDLE = {
  tween() {},
  progress(key: string) {
    if (key === 'fader.opacity') return 1;
    if (key === 'reveal') return 0.72;
    return 1;
  },
  isDone() { return false; },
  hasActive() { return false; },
  cancel() {},
} as const;

function renderEmbeddedShowcaseRail(
  state: PlaygroundWidgetState,
  width: number,
  height: number,
): string[] {
  if (height <= 0 || width <= 0) return [];
  const showcase = state.showcaseOptions[state.showcaseCursor];
  if (!showcase) {
    return Array.from({ length: height }, (_, idx) =>
      idx === 0 ? padRight(C.muted('  (no showcase selected)'), width) : padRight('', width));
  }
  return Array.from({ length: height }, (_, idx) =>
    idx === 0 ? padRight(C.muted(`  no embedded rail for ${showcase.label}`), width) : padRight('', width));
}

function renderRuntimeSignalsRail(width: number, height: number): string[] {
  return renderRuntimeSignalsRailForPreset(undefined, width, height);
}

function renderRuntimeSignalsRailForPreset(
  preset: PlaygroundPresetOptionEntry | undefined,
  width: number,
  height: number,
): string[] {
  const topH = Math.max(3, Math.ceil(height * 0.42));
  const middleH = Math.max(2, Math.ceil(height * 0.24));
  const bottomH = Math.max(2, height - topH - middleH);
  const out: string[] = [];
  const variant = preset?.id ?? 'default';
  const samples =
    variant === 'newsroom'
      ? [0.18, 0.22, 0.25, 0.29, 0.41, 0.47, 0.52, 0.48, 0.44, 0.58, 0.64, 0.67]
      : variant === 'stock-watch'
        ? [0.16, 0.34, 0.22, 0.51, 0.42, 0.71, 0.58, 0.79, 0.64, 0.83, 0.55, 0.74]
        : [0.12, 0.18, 0.24, 0.36, 0.31, 0.44, 0.62, 0.58, 0.76, 0.68, 0.82, 0.74];
  const banner =
    variant === 'newsroom'
      ? 'Lab rail · newsroom signal burst'
      : variant === 'stock-watch'
        ? 'Lab rail · market pulse drift'
        : 'Lab rail · animation-ready status sample';
  const heatRows =
    variant === 'newsroom'
      ? [
          [0.08, 0.12, 0.21, 0.34, 0.48, 0.59],
          [0.12, 0.18, 0.27, 0.39, 0.51, 0.66],
          [0.16, 0.22, 0.31, 0.44, 0.58, 0.72],
        ]
      : variant === 'stock-watch'
        ? [
            [0.22, 0.41, 0.37, 0.66, 0.78, 0.91],
            [0.18, 0.36, 0.52, 0.71, 0.84, 0.93],
            [0.14, 0.29, 0.47, 0.62, 0.77, 0.88],
          ]
        : [
            [0.14, 0.22, 0.31, 0.52, 0.66, 0.78],
            [0.18, 0.27, 0.41, 0.58, 0.71, 0.86],
            [0.11, 0.19, 0.24, 0.47, 0.63, 0.74],
          ];

  const sparkState = sparklineWidget.initialState({
    capacity: 24,
    color: 'accent',
    samples,
  });
  const sparkLines = sparklineWidget.render(
    sparkState,
    {
      width,
      height: topH,
      focused: false,
      originRow: 1,
      originCol: 1,
      canvas: canvasFactory,
      animate: EMBEDDED_ANIMATION_HANDLE,
    } as never,
    'Sparkline · heap',
  );
  out.push(...sparkLines.slice(0, topH));

  const faderState = faderWidget.initialState({
    message: banner,
    tone: 'info',
  });
  faderState.phase = 'shown';
  const faderLines = faderWidget.render(
    faderState,
    {
      width,
      height: middleH,
      focused: false,
      originRow: 1,
      originCol: 1,
      animate: EMBEDDED_ANIMATION_HANDLE,
    } as never,
    'Fader · banner',
  );
  out.push(...faderLines.slice(0, middleH));

  const heatmapState = heatmapWidget.initialState({
    min: 0,
    max: 1,
    rows: heatRows,
  });
  const heatmapLines = heatmapWidget.render(
    heatmapState,
    {
      width,
      height: bottomH,
      focused: false,
      originRow: 1,
      originCol: 1,
      canvas: canvasFactory,
    } as never,
    'Heatmap · lag',
  );
  out.push(...heatmapLines.slice(0, bottomH));

  while (out.length < height) out.push(padRight('', width));
  return out.slice(0, height);
}

function buildEmbeddedRailCapture(
  state: PlaygroundWidgetState,
  width: number,
  height: number,
): PlaygroundEmbeddedRailCapture | null {
  const showcase = state.showcaseOptions[state.showcaseCursor];
  if (!showcase) return null;
  const preset = state.presetOptions[state.presetCursor];
  const theme = state.themeOptions[state.themeCursor];
  return {
    at: Date.now(),
    showcaseId: showcase.id,
    showcaseLabel: showcase.label,
    presetId: preset?.id,
    presetLabel: preset?.label,
    themeName: theme?.name,
    motionDisabled: state.chromeMotionMode !== 'auto',
    affectiveState: state.chromeAffectiveState,
    lines: renderEmbeddedShowcaseRail(state, width, height),
  };
}

function buildMaterializeIntentFeedback(state: PlaygroundWidgetState): PlaygroundLabFeedback {
  const showcase = state.showcaseOptions[state.showcaseCursor];
  const preset = state.presetOptions[state.presetCursor];
  const theme = state.themeOptions[state.themeCursor];
  const route = 'Use runtime rail as baseline → launch showcase when the signal mix looks right';
  return {
    level: 'info',
    title: 'Materialize intent staged',
    at: Date.now(),
    lines: [
      `target: ${showcase?.label ?? '(none)'}`,
      `preset: ${preset?.label ?? '(none)'}`,
      `theme: ${theme?.name ?? '(none)'} · ${state.chromeMotionMode} · ${state.chromeAffectiveState}`,
      route,
    ],
  };
}

function buildEmbeddedRailCaptureFeedback(capture: PlaygroundEmbeddedRailCapture): PlaygroundLabFeedback {
  return {
    level: 'success',
    title: 'Rail captured',
    at: Date.now(),
    lines: [
      `${capture.showcaseLabel} · ${capture.lines.length} line(s) captured`,
      `${capture.presetLabel ?? capture.presetId ?? 'no preset'} · ${capture.themeName ?? 'no theme'}`,
      `${capture.motionDisabled ? 'static' : 'motion'} · ${capture.affectiveState}`,
    ],
  };
}

function buildEmbeddedRailCompareFeedback(
  current: PlaygroundEmbeddedRailCapture | null,
  previous: PlaygroundEmbeddedRailCapture | null,
): PlaygroundLabFeedback {
  if (!current || !previous) {
    return {
      level: 'error',
      title: 'Compare blocked',
      at: Date.now(),
      lines: ['capture the showcase rail at least twice before compare'],
    };
  }
  const maxLines = Math.max(current.lines.length, previous.lines.length);
  let changed = 0;
  for (let i = 0; i < maxLines; i++) {
    if ((current.lines[i] ?? '') !== (previous.lines[i] ?? '')) changed++;
  }
  return {
    level: changed > 0 ? 'success' : 'info',
    title: 'Rail compare',
    at: Date.now(),
    lines: [
      `${previous.showcaseLabel} → ${current.showcaseLabel}`,
      `${previous.presetLabel ?? previous.presetId ?? 'no preset'} → ${current.presetLabel ?? current.presetId ?? 'no preset'}`,
      `changed rows: ${changed}/${maxLines}`,
      `${previous.motionDisabled ? 'static' : 'motion'}:${previous.affectiveState} → ${current.motionDisabled ? 'static' : 'motion'}:${current.affectiveState}`,
    ],
  };
}

function renderVisualConsole(
  state: PlaygroundWidgetState,
  width: number,
  height: number,
): string[] {
  const theme = state.themeOptions[state.themeCursor];
  const preset = state.presetOptions[state.presetCursor];
  const showcase = state.showcaseOptions[state.showcaseCursor];
  const lines = [
    theme
      ? `  theme: ${theme.name}${theme.isDark ? ' · dark' : ' · light'}${theme.isPastel ? ' · pastel' : ''}`
      : '  theme: (none)',
    preset
      ? `  preset: ${preset.id} · ${preset.rowCount} row(s)`
      : '  preset: (none)',
    `  motion: ${state.chromeMotionMode}`,
    `  affective: ${state.chromeAffectiveState}`,
    `  variant: ${state.chromeVariantOverride ?? 'theme-default'}`,
    `  target: ${state.chromeTargetOverride ?? 'theme-default'}`,
    showcase
      ? `  showcase: ${showcase.label}${state.activeShowcasePluginId === showcase.pluginId ? ' · active' : ''}`
      : '  showcase: (none)',
    '',
    C.muted('  Ctrl+T theme · Ctrl+Y theme back'),
    C.muted('  Ctrl+P preset · Ctrl+M motion mode'),
    C.muted('  Ctrl+V variant · Ctrl+X target'),
    C.muted('  Ctrl+A affective cycle'),
    C.muted('  Ctrl+G / Ctrl+H showcase · Ctrl+L launch'),
    C.muted('  Ctrl+I intent · Ctrl+U capture · Ctrl+N compare'),
  ];
  const out = lines.slice(0, height).map((line) => padRight(line, width));
  while (out.length < height) out.push(padRight('', width));
  return out;
}

function renderPresetMiniLayout(
  preset: PlaygroundPresetOptionEntry | undefined,
  width: number,
): string {
  if (!preset) return padRight('Preset layout unavailable', width);
  const label = preset.label.slice(0, Math.max(0, width - 6));
  return padRight(`Preset · ${label}`, width);
}

function drawChromePreview(
  p: Printer,
  state: PlaygroundWidgetState,
): void {
  const themeName = state.themeOptions[state.themeCursor]?.name;
  const theme = themeName ? getTheme(themeName) : null;
  const chrome = theme?.widgetTokens?.modalChrome;
  const preset = state.presetOptions[state.presetCursor];
  if (!chrome || p.width < 8 || p.height < 4) {
    p.text(0, 0, clipAnsiToWidth(C.muted('  (chrome preview unavailable)'), p.width));
    return;
  }
  const body = [
    renderPresetMiniLayout(preset, Math.max(0, p.width - 2)),
    padRight(`Affective · ${state.chromeAffectiveState}`, Math.max(0, p.width - 2)),
    padRight(`Motion · ${state.chromeMotionMode}`, Math.max(0, p.width - 2)),
    padRight(`Variant · ${state.chromeVariantOverride ?? 'theme-default'}`, Math.max(0, p.width - 2)),
    padRight(`Target · ${state.chromeTargetOverride ?? 'theme-default'}`, Math.max(0, p.width - 2)),
  ].join('\n');
  const chromeSpec = {
    ...chrome,
    ...(state.chromeVariantOverride ? { chromeVariant: state.chromeVariantOverride } : {}),
    ...(state.chromeTargetOverride ? { chromeTarget: state.chromeTargetOverride } : {}),
  };
  const sample = new BoxView(
    new TextView(body),
    resolveModalChromeBoxOptions(chromeSpec, {
      title: preset?.label ?? 'Lab Chrome',
      titleRight: state.chromeMotionMode === 'auto' ? '×' : state.chromeMotionMode === 'reduced' ? '·' : '○',
      motionDisabled: state.chromeMotionMode !== 'auto',
      affectiveState: state.chromeAffectiveState,
    }),
  );
  sample.layout({ width: p.width, height: p.height });
  sample.draw(p);
}

// ─── Widget def ─────────────────────────────────────────────────────

const playgroundWidget: WidgetDef<PlaygroundWidgetState, PlaygroundWidgetConfig> = {
  type: 'playground',
  description: 'Widget Playground — sandbox for UX components + widgets + modals',
  defaultCharacter: 'Widget Playground',

  initialState(config) {
    const initial: PlaygroundSize = config?.initialSize ?? 'medium';
    const catalog = getCatalog();
    return {
      cursor: 0,
      previewSize: initial,
      size: initial,  // legacy alias
      groupOpen: { ux: true, widget: true, modal: true },
      browserScroll: 0,
      slots: snapshotsFrom(catalog),
      focused: false,
      mode: 'browse',
      editSource: '',
      editCursor: 0,
      editScrollTop: 0,
      editResult: null,
      scenarioPalette: [],
      scenarioPaletteCursor: 0,
      labFeedback: null,
      themeOptions: [],
      themeCursor: 0,
      presetOptions: [],
      presetCursor: 0,
      chromeAffectiveState: 'neutral',
      chromeMotionDisabled: true,
      chromeMotionMode: 'off',
      chromeVariantOverride: null,
      chromeTargetOverride: null,
      showcaseOptions: [],
      showcaseCursor: 0,
      lastRailCapture: null,
      previousRailCapture: null,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    state.lastOriginRow = ctx.originRow;
    state.lastOriginCol = ctx.originCol;
    state.lastWidth = ctx.width;
    state.lastHeight = ctx.height;
    if (ctx.height < 2 || ctx.width < 10) return [];

    const catalog = getCatalog();
    // Refresh slot snapshot in case the host finished registering
    // widgets after initialState ran (catalog builds lazily).
    state.slots = snapshotsFrom(catalog);

    // Re-clamp cursor — group toggles or host reload may have moved
    // the visible window.
    if (catalog.length > 0) {
      state.cursor = clampCursorToVisible(state.cursor, catalog, state.groupOpen);
    }

    const hasTitle = ctx.height >= 4;
    const title = hasTitle ? paneTitle(character, ctx.focused, ctx.width) : '';
    const bodyH = Math.max(0, ctx.height - (title ? 1 : 0));
    const bodyW = ctx.width;
    if (title) lines.push(title);

    // ─── Edit mode branch (I1 Bundle A) ──────────────────────
    if (state.mode === 'edit') {
      if (bodyH <= 0 || bodyW <= 0) return lines;
      const topH = Math.max(6, bodyH - 5);
      const bottomH = Math.max(3, bodyH - topH);
      const editorW = Math.max(24, Math.floor(bodyW * 0.6));
      const dividerW = 1;
      const sideW = Math.max(16, bodyW - editorW - dividerW);
      const previewH = Math.max(3, Math.floor(topH * 0.38));
      const statusH = Math.max(3, Math.floor(topH * 0.24));
      const chromeH = Math.max(4, topH - previewH - statusH);
      const previewBodyH = Math.max(1, previewH - 1);
      const editorBodyH = Math.max(1, topH - 1);

      const topPrinter = Printer.create({ width: bodyW, height: topH, focused: ctx.focused });
      const editor = topPrinter.sub(0, 0, editorW, topH, { focused: ctx.focused });
      editor.text(0, 0, renderEditHeader(editorW, 'Scenario YAML', state.editScenarioId ?? 'draft'));
      const editorBody = editor.sub(0, 1, editorW, editorBodyH, { focused: ctx.focused });
      const editorLines = renderEditEditor(
        state.editSource,
        state.editCursor,
        state.editScrollTop,
        editorBody.width,
        editorBody.height,
      );
      for (let y = 0; y < editorLines.length; y++) editorBody.text(0, y, editorLines[y] ?? '');

      const divider = topPrinter.sub(editorW, 0, dividerW, topH);
      divider.vline(0, '│', '\x1b[90m');

      const side = topPrinter.sub(editorW + dividerW, 0, sideW, topH, { focused: ctx.focused });
      side.text(0, 0, renderEditHeader(sideW, 'Preview', state.editResult?.scenario?.title ?? '(partial)'));
      const previewBody = side.sub(0, 1, sideW, previewBodyH, { focused: ctx.focused });
      const previewLines = renderScenarioPreview(state.editResult, previewBody.width, previewBody.height);
      for (let y = 0; y < previewLines.length; y++) previewBody.text(0, y, previewLines[y] ?? '');
      if (side.height > previewH) {
        side.text(0, previewH, renderEditHeader(sideW, 'Status', `errors=${state.editResult?.errors.length ?? 0} warnings=${state.editResult?.warnings.length ?? 0}`));
        const statusBody = side.sub(0, previewH + 1, sideW, Math.max(0, statusH - 1), { focused: ctx.focused });
        const statusLines = renderScenarioErrors(state.editResult, statusBody.width, statusBody.height);
        for (let y = 0; y < statusLines.length; y++) statusBody.text(0, y, statusLines[y] ?? '');
        const chromeTop = previewH + statusH;
        if (chromeTop < topH) {
          side.text(0, chromeTop, renderEditHeader(sideW, 'Chrome Preview', `${state.chromeAffectiveState} · ${state.chromeMotionMode}`));
          const chromeBody = side.sub(0, chromeTop + 1, sideW, Math.max(0, chromeH - 1), { focused: ctx.focused });
          drawChromePreview(chromeBody, state);
        }
      }

      for (const line of topPrinter.lines()) lines.push(line);

      if (bottomH > 0) {
        const bottomPrinter = Printer.create({ width: bodyW, height: bottomH, focused: ctx.focused });
        const paletteW = Math.max(24, Math.floor(bodyW * 0.34));
        const controlsW = Math.max(24, Math.floor(bodyW * 0.24));
        const bodyHInner = Math.max(0, bottomH - 1);
        const feedbackW = Math.max(20, bodyW - paletteW - controlsW - 2);
        const palette = bottomPrinter.sub(0, 0, paletteW, bottomH, { focused: ctx.focused });
        palette.text(0, 0, renderEditHeader(paletteW, 'Scenario Palette', `${state.scenarioPalette.length} registered`));
        const paletteBody = palette.sub(0, 1, paletteW, bodyHInner, { focused: ctx.focused });
        const paletteLines = renderScenarioPalette(
          state.scenarioPalette,
          state.scenarioPaletteCursor,
          state.editScenarioId,
          paletteBody.width,
          paletteBody.height,
        );
        for (let y = 0; y < paletteLines.length; y++) paletteBody.text(0, y, paletteLines[y] ?? '');

        const divider = bottomPrinter.sub(paletteW, 0, 1, bottomH);
        divider.vline(0, '│', '\x1b[90m');

        const controls = bottomPrinter.sub(paletteW + 1, 0, controlsW, bottomH, { focused: ctx.focused });
        controls.text(0, 0, renderEditHeader(controlsW, 'Visual Console', 'theme · preset · chrome'));
        const controlsBody = controls.sub(0, 1, controlsW, bodyHInner, { focused: ctx.focused });
        const controlLines = renderVisualConsole(state, controlsBody.width, controlsBody.height);
        for (let y = 0; y < controlLines.length; y++) controlsBody.text(0, y, controlLines[y] ?? '');

        const divider2 = bottomPrinter.sub(paletteW + controlsW + 1, 0, 1, bottomH);
        divider2.vline(0, '│', '\x1b[90m');

        const feedback = bottomPrinter.sub(paletteW + controlsW + 2, 0, feedbackW, bottomH, { focused: ctx.focused });
        const railBodyH = Math.max(3, Math.floor(bodyHInner * 0.56));
        const feedbackTop = railBodyH + 1;
        const feedbackBodyH = Math.max(1, bodyHInner - feedbackTop);
        feedback.text(0, 0, renderEditHeader(feedbackW, 'Showcase Rail', state.showcaseOptions[state.showcaseCursor]?.label ?? 'embedded preview'));
        const railBody = feedback.sub(0, 1, feedbackW, railBodyH, { focused: ctx.focused });
        const railLines = renderEmbeddedShowcaseRail(state, railBody.width, railBody.height);
        for (let y = 0; y < railLines.length; y++) railBody.text(0, y, railLines[y] ?? '');
        if (feedbackTop < bottomH) {
          feedback.text(0, feedbackTop, renderEditHeader(feedbackW, 'Lab Feedback', 'Ctrl+R run · Ctrl+S save · Ctrl+O load'));
        }
        const feedbackBody = feedback.sub(0, Math.min(bottomH, feedbackTop + 1), feedbackW, feedbackBodyH, { focused: ctx.focused });
        const feedbackLines = renderLabFeedback(state.labFeedback, feedbackBody.width, feedbackBody.height);
        for (let y = 0; y < feedbackLines.length; y++) feedbackBody.text(0, y, feedbackLines[y] ?? '');
        for (const line of bottomPrinter.lines()) lines.push(line);
      }
      return lines;
    }

    // Legend: size + slot position + hotkeys.
    const entry = catalog[state.cursor];
    const counts = countsByGroup();
    const total = counts.ux + counts.widget + counts.modal;
    const pos = entry ? `${state.cursor + 1}/${total}` : '0/0';
    const legendRow = `  ${C.muted('size:')} ${sizeTag(state.previewSize)}  ${C.muted('slot:')} ${C.accent(pos)}  ${C.muted('keys: ↑↓ tab pg 1/2/3 r=reload e=edit ⇧tab fold')}`;
    if (bodyH >= 1) lines.push(padRight(legendRow, bodyW));

    const inspectH = bodyH >= 10 ? 1 : 0;
    const splitH = Math.max(0, bodyH - 1 /* legend */ - inspectH);
    if (splitH <= 0 || bodyW <= 0) return lines;

    const p = Printer.create({ width: bodyW, height: splitH, focused: ctx.focused });
    const browserW = browserColumnWidth(bodyW);
    const dividerW = 1;
    const previewW = Math.max(10, bodyW - browserW - dividerW);

    const browser = p.sub(0, 0, browserW, splitH, { focused: ctx.focused });
    drawBrowser(browser, state, catalog, ctx.focused);

    const divider = p.sub(browserW, 0, dividerW, splitH);
    divider.vline(0, '│', '\x1b[90m');  // muted grey

    const preview = p.sub(browserW + dividerW, 0, previewW, splitH, { focused: ctx.focused });
    drawPreview(preview, entry, state, ctx.focused);

    for (const line of p.lines()) lines.push(line);

    if (inspectH > 0) {
      lines.push(buildInspectLine(entry, bodyW));
    }
    return lines;
  },

  onKey(ev, state, ctx) {
    const catalog = getCatalog();

    // ─── Edit mode routing (I1 Bundle A) ──────────────────────
    if (state.mode === 'edit') {
      if (ev.ctrl && (ev.name === 'j' || ev.name === 'k')) {
        if (state.scenarioPalette.length === 0) return { type: 'refresh' };
        const delta = ev.name === 'j' ? 1 : -1;
        state.scenarioPaletteCursor = ((state.scenarioPaletteCursor + delta) % state.scenarioPalette.length + state.scenarioPalette.length) % state.scenarioPalette.length;
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 't') {
        if (state.themeOptions.length === 0) return { type: 'refresh' };
        state.themeCursor = (state.themeCursor + 1) % state.themeOptions.length;
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'y') {
        if (state.themeOptions.length === 0) return { type: 'refresh' };
        state.themeCursor = ((state.themeCursor - 1) % state.themeOptions.length + state.themeOptions.length) % state.themeOptions.length;
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'p') {
        if (state.presetOptions.length === 0) return { type: 'refresh' };
        state.presetCursor = (state.presetCursor + 1) % state.presetOptions.length;
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'm') {
        state.chromeMotionMode = nextPlaygroundChromeMotionMode(state.chromeMotionMode);
        state.chromeMotionDisabled = state.chromeMotionMode !== 'auto';
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'v') {
        state.chromeVariantOverride = nextPlaygroundChromeVariant(state.chromeVariantOverride);
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'x') {
        state.chromeTargetOverride = nextPlaygroundChromeTarget(state.chromeTargetOverride);
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'a') {
        state.chromeAffectiveState = nextAffectiveChromeState(state.chromeAffectiveState);
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'i') {
        state.labFeedback = buildMaterializeIntentFeedback(state);
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'u') {
        const width = Math.max(18, Math.floor((state.lastWidth ?? 96) * 0.38));
        const height = Math.max(4, Math.floor(Math.max(6, (state.lastHeight ?? 24) - 6) * 0.28));
        const capture = buildEmbeddedRailCapture(state, width, height);
        if (!capture) {
          state.labFeedback = {
            level: 'error',
            title: 'Capture blocked',
            at: Date.now(),
            lines: ['no showcase rail is available to capture'],
          };
        } else {
          state.previousRailCapture = state.lastRailCapture;
          state.lastRailCapture = capture;
          state.labFeedback = buildEmbeddedRailCaptureFeedback(capture);
        }
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'n') {
        state.labFeedback = buildEmbeddedRailCompareFeedback(
          state.lastRailCapture,
          state.previousRailCapture,
        );
        return { type: 'refresh' };
      }
      if (ev.ctrl && (ev.name === 'g' || ev.name === 'h')) {
        if (state.showcaseOptions.length === 0) return { type: 'refresh' };
        const delta = ev.name === 'g' ? 1 : -1;
        state.showcaseCursor = ((state.showcaseCursor + delta) % state.showcaseOptions.length + state.showcaseOptions.length) % state.showcaseOptions.length;
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'l') {
        state.launchShowcaseRequestedAt = Date.now();
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'r') {
        state.runRequestedAt = Date.now();
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 's') {
        state.saveRequestedAt = Date.now();
        return { type: 'refresh' };
      }
      if (ev.ctrl && ev.name === 'o') {
        state.loadRequestedAt = Date.now();
        return { type: 'refresh' };
      }
      if (ev.name === 'escape' || ev.name === 'esc') {
        state.mode = 'browse';
        if (ctx) ctx.log('[playground] edit mode → browse');
        return { type: 'refresh' };
      }
      if (ev.name === 'left') {
        state.editCursor = Math.max(0, state.editCursor - 1);
        state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
        return { type: 'refresh' };
      }
      if (ev.name === 'right') {
        state.editCursor = Math.min(state.editSource.length, state.editCursor + 1);
        state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
        return { type: 'refresh' };
      }
      if (ev.name === 'up' || ev.name === 'down') {
        const { line, col } = cursorToLineCol(state.editSource, state.editCursor);
        const nextLine = ev.name === 'up' ? line - 1 : line + 1;
        state.editCursor = lineColToCursor(state.editSource, nextLine, col);
        state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
        return { type: 'refresh' };
      }
      if (ev.name === 'home') {
        const { line } = cursorToLineCol(state.editSource, state.editCursor);
        state.editCursor = lineColToCursor(state.editSource, line, 0);
        state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
        return { type: 'refresh' };
      }
      if (ev.name === 'end') {
        const { line } = cursorToLineCol(state.editSource, state.editCursor);
        const lineLen = state.editSource.split('\n')[line]?.length ?? 0;
        state.editCursor = lineColToCursor(state.editSource, line, lineLen);
        state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
        return { type: 'refresh' };
      }
      if (ev.name === 'backspace') {
        if (state.editCursor === 0) return { type: 'refresh' };
        state.editSource = state.editSource.slice(0, state.editCursor - 1) + state.editSource.slice(state.editCursor);
        state.editCursor -= 1;
        state.editResult = deriveScenarioEditResult(state.editSource);
        state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
        return { type: 'refresh' };
      }
      if (ev.name === 'return' || ev.name === 'enter') {
        state.editSource = state.editSource.slice(0, state.editCursor) + '\n' + state.editSource.slice(state.editCursor);
        state.editCursor += 1;
        state.editResult = deriveScenarioEditResult(state.editSource);
        state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
        return { type: 'refresh' };
      }
      if (ev.sequence && ev.sequence.length === 1 && !ev.ctrl && !ev.alt) {
        const ch = ev.sequence;
        const code = ch.charCodeAt(0);
        if (code >= 0x20 && code !== 0x7f) {
          state.editSource = state.editSource.slice(0, state.editCursor) + ch + state.editSource.slice(state.editCursor);
          state.editCursor += 1;
          state.editResult = deriveScenarioEditResult(state.editSource);
          state.editScrollTop = nextEditScrollTopForCursor(state.editSource, state.editCursor, state.editScrollTop, Math.max(1, (state.lastHeight ?? 10) - 6));
          return { type: 'refresh' };
        }
      }
      return { type: 'none' };
    }

    if (catalog.length === 0) return { type: 'none' };

    const prevId = catalog[state.cursor]?.id;
    const emitMove = () => {
      const newEntry = catalog[state.cursor];
      if (newEntry && ctx && newEntry.id !== prevId) {
        ctx.log(`[playground] → ${newEntry.id}`);
      }
    };

    switch (ev.name) {
      case 'left': case 'h': {
        moveCursor(state, catalog, -1);
        emitMove();
        return { type: 'refresh' };
      }
      case 'right': case 'l': {
        moveCursor(state, catalog, +1);
        emitMove();
        return { type: 'refresh' };
      }
      case 'tab': {
        if ((ev as { shift?: boolean }).shift) {
          toggleGroup(state, catalog);
          return { type: 'refresh' };
        }
        moveCursor(state, catalog, +1);
        emitMove();
        return { type: 'refresh' };
      }
      case 'up': case 'k': {
        moveCursor(state, catalog, -1);
        emitMove();
        return { type: 'refresh' };
      }
      case 'down': case 'j': {
        moveCursor(state, catalog, +1);
        emitMove();
        return { type: 'refresh' };
      }
      case 'pageup': { jumpGroup(state, catalog, -1); emitMove(); return { type: 'refresh' }; }
      case 'pagedown': { jumpGroup(state, catalog, +1); emitMove(); return { type: 'refresh' }; }
      case '1': { state.previewSize = 'small';  state.size = 'small';  return { type: 'refresh' }; }
      case '2': { state.previewSize = 'medium'; state.size = 'medium'; return { type: 'refresh' }; }
      case '3': { state.previewSize = 'large';  state.size = 'large';  return { type: 'refresh' }; }
      case 'r': {
        state.reloadRequestedAt = Date.now();
        return { type: 'refresh' };
      }
      case 'e': {
        // I1 Bundle A — enter the scenario editor surface.
        state.mode = 'edit';
        if (ctx) ctx.log('[playground] browse → edit mode');
        return { type: 'refresh' };
      }
      case 'enter': {
        const e = catalog[state.cursor];
        if (e && ctx) ctx.log(`[playground] refresh ${e.id}`);
        return { type: 'refresh' };
      }
      case 'space': {
        // Toggle current group.
        toggleGroup(state, catalog);
        return { type: 'refresh' };
      }
      default:
        return { type: 'none' };
    }
  },

  onMouse(ev, state, ctx) {
    // F-B5b — edit mode absorbs clicks (TextArea cursor + panel
    // clicks wired in Phase 3+). Phase 1 just prevents browse-mode
    // side effects while the user is verifying the toggle.
    if (state.mode === 'edit') return { type: 'refresh' };

    const catalog = getCatalog();
    if (catalog.length === 0) return { type: 'none' };

    if (ev.type === 'scroll-up') {
      state.browserScroll = Math.max(0, state.browserScroll - 3);
      return { type: 'refresh' };
    }
    if (ev.type === 'scroll-down') {
      state.browserScroll = state.browserScroll + 3;
      return { type: 'refresh' };
    }
    if (ev.type !== 'click') return { type: 'none' };

    // Only left-column clicks change cursor. Right column is the
    // preview — we leave interaction to a future phase.
    const browserW = browserColumnWidth(state.lastWidth ?? 80);
    if (ev.col >= browserW) return { type: 'none' };

    // Row 0 = title, 1 = legend, 2+ = browser body (when title present).
    const hasTitle = (state.lastHeight ?? 0) >= 4;
    const bodyTop = hasTitle ? 2 : 1;
    const localRow = ev.row - bodyTop;
    if (localRow < 0) return { type: 'none' };

    const rows = buildBrowserRows(catalog, state.groupOpen);
    const target = rows[state.browserScroll + localRow];
    if (!target) return { type: 'none' };

    if (target.kind === 'header') {
      // Toggle the group on header click.
      state.groupOpen = { ...state.groupOpen, [target.group]: !state.groupOpen[target.group] };
      state.cursor = clampCursorToVisible(state.cursor, catalog, state.groupOpen);
      return { type: 'refresh' };
    }
    if (target.kind === 'entry' && typeof target.flatIndex === 'number') {
      const prevId = catalog[state.cursor]?.id;
      state.cursor = target.flatIndex;
      const newEntry = catalog[state.cursor];
      if (ctx && newEntry && newEntry.id !== prevId) {
        ctx.log(`[playground] → ${newEntry.id}`);
      }
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  onMount(_state, _ctx) {
    // I1 Bundle A owns all editor state inside the widget state object,
    // so no external setup is required here.
  },

  onUnmount(_state, _ctx) {
    // No-op — editor state is state-only in Bundle A.
  },

  // WR-1 (Bundle 7W · 2026-04-20) — playground has rich user-driven
  // state (cursor navigation + mode toggle + group folding + preview
  // size + reload requests). Each axis gets its own telemetry kind so
  // a timeline recorder can reconstruct the browse session without
  // walking the full state blob on every frame.
  onStateChange(prev, next, ctx) {
    if (prev.mode !== next.mode) {
      ctx.telemetry?.emit({
        kind: 'playground.mode.change',
        data: { from: prev.mode, to: next.mode },
      });
    }
    if (prev.cursor !== next.cursor) {
      const nextEntry = next.slots[next.cursor];
      ctx.telemetry?.emit({
        kind: 'playground.cursor.change',
        data: {
          from: prev.cursor,
          to: next.cursor,
          id: nextEntry?.id ?? null,
          group: nextEntry?.group ?? null,
        },
      });
    }
    if (prev.previewSize !== next.previewSize) {
      ctx.telemetry?.emit({
        kind: 'playground.size.change',
        data: { from: prev.previewSize, to: next.previewSize },
      });
    }
    if (prev.groupOpen !== next.groupOpen) {
      ctx.telemetry?.emit({
        kind: 'playground.groups.change',
        data: { ...next.groupOpen },
      });
    }
    if (prev.reloadRequestedAt !== next.reloadRequestedAt && next.reloadRequestedAt) {
      ctx.telemetry?.emit({
        kind: 'playground.reload.requested',
        data: { at: next.reloadRequestedAt },
      });
    }
  },

  // WR-2 — mode + cursor + previewSize + open-group count. Slots length
  // in the hash so "catalog grew" after late widget registration also
  // bumps.
  snapshotHash(state): string {
    const openCount =
      (state.groupOpen.ux ? 1 : 0) +
      (state.groupOpen.widget ? 2 : 0) +
      (state.groupOpen.modal ? 4 : 0);
    return `${state.mode}:${state.cursor}:${state.previewSize}:${openCount}:${state.slots.length}:${state.scenarioPalette.length}:${state.scenarioPaletteCursor}:${state.editScenarioId ?? '-'}:${state.themeCursor}:${state.presetCursor}:${state.chromeAffectiveState}:${state.chromeMotionMode}:${state.chromeVariantOverride ?? '-'}:${state.chromeTargetOverride ?? '-'}:${state.showcaseCursor}:${state.activeShowcasePluginId ?? '-'}:${state.lastRailCapture?.at ?? 0}:${state.previousRailCapture?.at ?? 0}`;
  },

  describeSurface(state, ctx): string {
    const entry = state.slots[state.cursor];
    const parts = [ctx.character, state.mode];
    parts.push(`size ${state.previewSize}`);
    if (entry) {
      parts.push(`slot ${state.cursor + 1}/${state.slots.length}`);
      parts.push(`"${entry.title}"`);
    } else {
      parts.push('empty catalog');
    }
    if (state.mode === 'edit') {
      parts.push(`${state.scenarioPalette.length} scenarios`);
      if (state.editScenarioId) parts.push(`editing ${state.editScenarioId}`);
      const theme = state.themeOptions[state.themeCursor];
      const preset = state.presetOptions[state.presetCursor];
      const showcase = state.showcaseOptions[state.showcaseCursor];
      if (theme) parts.push(`theme ${theme.name}`);
      if (preset) parts.push(`preset ${preset.id}`);
      parts.push(`motion ${state.chromeMotionMode}`);
      if (state.chromeVariantOverride) parts.push(`variant ${state.chromeVariantOverride}`);
      if (state.chromeTargetOverride) parts.push(`target ${state.chromeTargetOverride}`);
      if (showcase) parts.push(`showcase ${showcase.pluginId}`);
    }
    return parts.join(' · ');
  },

  // WR-3 (Bundle 7W · 2026-04-20) — scenario replay hook. Playground's
  // cursor can point at a slot in a group that's currently collapsed
  // in the recorded state; after state transplant we re-clamp via the
  // same visible-entry snap that live nav uses, so the replayed pointer
  // lands on a selectable row. The catalog itself is module-global and
  // rebuilt on demand by getCatalog(), so no external teardown needed.
  replayState(state, ctx): void {
    const catalog = getCatalog();
    const snapped = catalog.length > 0
      ? clampCursorToVisible(state.cursor, catalog, state.groupOpen)
      : state.cursor;
    const paletteCursor = state.scenarioPalette.length > 0
      ? Math.min(Math.max(0, state.scenarioPaletteCursor), state.scenarioPalette.length - 1)
      : 0;
    const themeCursor = state.themeOptions.length > 0
      ? Math.min(Math.max(0, state.themeCursor), state.themeOptions.length - 1)
      : 0;
    const presetCursor = state.presetOptions.length > 0
      ? Math.min(Math.max(0, state.presetCursor), state.presetOptions.length - 1)
      : 0;
    const showcaseCursor = state.showcaseOptions.length > 0
      ? Math.min(Math.max(0, state.showcaseCursor), state.showcaseOptions.length - 1)
      : 0;
    const patched: PlaygroundWidgetState = {
      ...state,
      cursor: snapped,
      scenarioPaletteCursor: paletteCursor,
      themeCursor,
      presetCursor,
      showcaseCursor,
      chromeMotionDisabled: state.chromeMotionMode !== 'auto',
      lastRailCapture: state.lastRailCapture,
      previousRailCapture: state.previousRailCapture,
    };
    ctx.setState(patched as Partial<typeof state>);
    ctx.telemetry?.emit({
      kind: 'playground.replay',
      data: {
        mode: state.mode,
        cursor: snapped,
        previewSize: state.previewSize,
      },
    });
  },
};

export default playgroundWidget;
