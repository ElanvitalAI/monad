// ── Playground widget — live scenario YAML editor ──
//
// P5b (Presentation Track) · first user-facing consumer of P5a's
// scenario materialize pipeline. Provides a YAML textarea + live
// preview of the decoded WidgetSpec[] + error list. Re-materializes
// on every edit via `materializeScenario({lax: true})` so partial
// trees still surface in the preview while the user is typing.
//
// Layout (fills ctx.width x ctx.height):
//
//   ╭── Playground · <title> ──────────────────╮
//   │ 1  id: my-scenario                        │   editor pane (~60%)
//   │ 2  title: …                               │
//   │ 3  layout:                                │
//   │ 4    - widget: log                        │
//   │ ...                                       │
//   ├─── Preview · 2 widgets, 1 error ──────────┤
//   │ • log (log-1) · config: lines=[…]         │   preview pane (~25%)
//   │ • list (list-1) · config: items=[…]       │
//   ├─── Errors ────────────────────────────────┤
//   │ $.widgets[0].config.unexpected · …        │   errors footer (~15%)
//   ╰───────────────────────────────────────────╯
//
// Keys:
//   - printable char → insert at cursor
//   - Enter → newline
//   - Backspace → delete before cursor
//   - arrow keys / Home / End → move cursor
//   - Ctrl+P → toggle mode ('edit' ↔ 'preview')
//   - Esc → ctx.dismiss (modal-style)
//
// The widget intentionally keeps scope minimal (P5b). Future (P5b+):
//   - Syntax highlighting
//   - Multi-file mode

import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { Widget } from '../../src/widgets/types.js';
import { C, visibleWidth } from '../../src/tui.js';
import { materializeScenario } from '../../src/scenarios/index.js';
import {
  buildWidgetLabPresetYAML,
  buildWidgetLabPresetReferenceYAML,
  cycleWidgetLabPreset,
  getWidgetLabPreset,
  materializeWidgetSpecs,
  renderWidgetSpecPreviewCard,
  type DecodeResult,
} from '../../src/ui/declarative/index.js';
import { DEFAULT_THEME_TOKENS } from '../../src/theme/tokens.js';
import { THEME_REGISTRY, getTheme } from '../../src/themes/index.js';

export interface PlaygroundState {
  /** Raw YAML source · single authoritative store of user input. */
  source: string;
  /** Cursor position in `source` (character offset · 0 = before first char). */
  cursor: number;
  /** Last materialize result · may contain errors. lastValid stays at the
   *  most recent successful parse so preview doesn't flicker to empty
   *  while the user is mid-typing. */
  current: DecodeResult | null;
  lastValid: DecodeResult | null;
  /** UI focus split · 'edit' (keys edit source) · 'preview' (keys navigate
   *  widget list). Scoped to P5b — Ctrl+P toggles. */
  mode: 'edit' | 'preview';
  /** Title rendered in the header bar · from config or default. */
  readonly title: string;
  /** Editor viewport top row (0-based source line index). */
  editorScrollTop: number;
  /** Last preview motion signature started through ctx.animate. */
  previewMotionToken?: string;
  /** Theme preset used for preview cards inside the playground. */
  previewThemeName?: string;
  /** Active lab preset id when the source was loaded from the preset rack. */
  presetName?: string;
  /** Whether preset-backed source is stored expanded or as a compact preset reference. */
  presetSourceMode: 'expanded' | 'reference';
  /** Selected widget index inside the preview pane. */
  previewIndex: number;
  /** Optional file the lab is bound to for save/reload loops. */
  boundFilePath?: string;
  /** Short status note surfaced after save/reload actions. */
  statusNote?: string;
}

export interface PlaygroundConfig {
  /** Seed YAML content · new editor opens with this as `source`. */
  source?: string;
  /** Display title · defaults to "playground". */
  title?: string;
  /** Preview theme preset for the playground card. */
  previewTheme?: string;
  /** Optional authoring-lab preset id used to seed the editor. */
  initialPreset?: string;
  /** How preset-backed sources are seeded into the editor. */
  presetSourceMode?: 'expanded' | 'reference';
  /** Optional file path bound to Ctrl+S/Ctrl+L save-reload actions. */
  filePath?: string;
}

function loadBoundSource(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function deriveResult(source: string): DecodeResult | null {
  if (source.trim() === '') return null;
  try {
    // Lazy YAML parse — catalog path does this in loadScenarioCatalog;
    // the widget parses inline so each keystroke gets feedback.
    // We require sync parse so onKey doesn't have to await. The
    // project's `yaml` dep supports synchronous `parse()`.
    // Dynamic require avoids adding a top-level dep import to the
    // widget module (keeps bundling agnostic about side effects).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('yaml') as { parse(s: string): unknown };
    const parsed = mod.parse(source);
    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        widgets: [],
        errors: [{ path: '$', message: 'scenario root must be a YAML object' }],
      };
    }
    // Synthesize a ScenarioDef · id/title stub so materialize runs.
    const def = {
      id: 'playground',
      title: 'Playground',
      layout: (parsed as { layout?: unknown; widgets?: unknown }).layout
        ?? (parsed as { layout?: unknown; widgets?: unknown }).widgets
        ?? parsed,
    };
    return materializeScenario(def, { lax: true });
  } catch (err) {
    return {
      ok: false,
      widgets: [],
      errors: [{ path: '$', message: `YAML parse: ${(err as Error).message}` }],
    };
  }
}

function splitSource(source: string): { lines: string[]; cursorLine: number; cursorCol: number } {
  // Convert char-offset cursor into (line, col) for rendering.
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i]!.length;
    if (offset + len >= 0 && offset + len >= 0) {
      // cursor lives in this line if it's within the range including the
      // trailing newline (cursor can be at end of line).
    }
    offset += len + 1; // +1 for the newline
  }
  // Compute properly — scan from start of source
  let consumed = 0;
  for (let li = 0; li < lines.length; li++) {
    const ll = lines[li]!.length;
    // cursor is in line `li` when consumed <= cursor <= consumed + ll
    return { lines, cursorLine: li, cursorCol: 0 }; // filled below
  }
  return { lines: [''], cursorLine: 0, cursorCol: 0 };
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
  const clampedLine = Math.min(Math.max(0, line), lines.length - 1);
  let offset = 0;
  for (let i = 0; i < clampedLine; i++) offset += lines[i]!.length + 1;
  offset += Math.min(Math.max(0, col), lines[clampedLine]!.length);
  return offset;
}

function padRow(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w >= width) return line.slice(0, width);
  return line + ' '.repeat(width - w);
}

function renderEditor(state: PlaygroundState, width: number, height: number): string[] {
  const lines = state.source.split('\n');
  const { line: cLine, col: cCol } = cursorToLineCol(state.source, state.cursor);
  // Simple cursor-follow scroll — keep cursor row visible within editor
  // area. When source < height, show from line 0.
  const maxScrollTop = Math.max(0, lines.length - height);
  const scrollTop = Math.min(maxScrollTop, Math.max(0, state.editorScrollTop));
  const visible = lines.slice(scrollTop, scrollTop + height);
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const absLine = scrollTop + i;
    const text = visible[i] ?? '';
    const gutter = absLine < lines.length
      ? String(absLine + 1).padStart(3) + '  '
      : '     ';
    // Cursor rendering: insert block at cursor column if focused + edit mode.
    const isCursorLine = absLine === cLine && state.mode === 'edit';
    let content = text;
    if (isCursorLine) {
      // Insert a visible caret. Use an underscore before the cursor col so
      // the "insertion point" is between characters. Keep it simple — no
      // ANSI flicker · subtle marker.
      const col = Math.min(cCol, text.length);
      content = text.slice(0, col) + (text[col] ?? ' ') + text.slice(col + 1);
      // And decorate the caret char with C.accent (theme color)
      const before = text.slice(0, col);
      const at = text[col] ?? ' ';
      const after = text.slice(col + 1);
      content = before + C.accent(at) + after;
    }
    out.push(padRow(C.muted(gutter) + content, width));
  }
  return out;
}

function renderPreview(
  state: PlaygroundState,
  width: number,
  height: number,
  theme = DEFAULT_THEME_TOKENS,
  motionProgress = 1,
): string[] {
  const result = state.current ?? state.lastValid;
  if (!result) {
    return [padRow(C.muted('  (no widgets decoded yet)'), width)];
  }
  if (result.widgets.length === 0) {
    return [padRow(C.muted('  (empty layout)'), width), ...Array.from({ length: Math.max(0, height - 1) }, () => padRow('', width))];
  }
  const out: string[] = [];
  const selected = Math.min(Math.max(0, state.previewIndex), result.widgets.length - 1);
  const primary = result.widgets[selected] ?? result.widgets[0]!;
  let materializeSeq = 0;
  const materialized = materializeWidgetSpecs({
    spawn(opts) {
      materializeSeq += 1;
      return { id: opts.id ?? `${opts.type}-${materializeSeq}` };
    },
  }, result.widgets);
  const materializedSummary = materialized.length > 0
    ? `materialized:${materialized.map((record) => record.parentId ? `${record.widgetId}@${record.parentId}` : record.widgetId).join(', ')}`
    : 'materialized:(none)';
  const footerParts = [primary.chrome?.footer, materializedSummary].filter(Boolean);
  const previewPrimary = footerParts.length > 0
    ? {
        ...primary,
        chrome: {
          ...(primary.chrome ?? {}),
          footer: footerParts.join(' · '),
        },
      }
    : primary;
  const cardHeight = Math.min(height, Math.max(4, Math.min(7, height - Math.max(0, result.widgets.length - 1))));
  out.push(...renderWidgetSpecPreviewCard(previewPrimary, width, cardHeight, theme, { motionProgress }));
  result.widgets.forEach((spec, i) => {
    if (spec === primary) return;
    const marker = i === selected ? C.accent('›') : ' ';
    const id = spec.id ? `(${spec.id})` : '';
    const character = spec.character ? ` · character=${spec.character}` : '';
    const cfg = spec.config
      ? ' · config=' + JSON.stringify(spec.config).slice(0, Math.max(10, width - 40))
      : '';
    const decoNote = spec.decoration ? ' · deco' : '';
    const chromeNote = spec.chrome?.title ? ` · chrome=${spec.chrome.title}` : '';
    const motionNote = spec.motion?.preset ? ` · motion=${spec.motion.preset}` : '';
    if (out.length < height) {
      out.push(padRow(`  ${marker} ${spec.type} ${id}${character}${decoNote}${chromeNote}${motionNote}${cfg}`, width));
    }
  });
  while (out.length < height) out.push(padRow('', width));
  return out.slice(0, height);
}

function nextPreviewIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, current + delta), total - 1);
}

function previewCardHeight(height: number, widgetCount: number): number {
  return Math.min(height, Math.max(4, Math.min(7, height - Math.max(0, widgetCount - 1))));
}

const PREVIEW_HEIGHT = 6;

function resolvePreviewTheme(state: PlaygroundState) {
  if (!state.previewThemeName) return DEFAULT_THEME_TOKENS;
  return getTheme(state.previewThemeName) ?? DEFAULT_THEME_TOKENS;
}

function cyclePreviewTheme(current: string | undefined, dir: 1 | -1 = 1): string {
  const names = THEME_REGISTRY.map(theme => theme.name);
  if (names.length === 0) return DEFAULT_THEME_TOKENS.name;
  const idx = current ? names.indexOf(current) : 0;
  const currentIdx = idx >= 0 ? idx : 0;
  const next = (currentIdx + dir + names.length) % names.length;
  return names[next]!;
}

function previewMotionTokenForState(state: PlaygroundState): string | null {
  const result = state.current ?? state.lastValid;
  const primary = result?.widgets[0];
  if (!primary) return null;
  const preset = primary.motion?.enter?.preset ?? primary.motion?.preset;
  if (!preset || preset === 'none') return null;
  return `${primary.id ?? primary.type}:${preset}:${primary.character ?? ''}:${JSON.stringify(primary.config ?? {})}`;
}

function renderErrors(result: DecodeResult | null, width: number, height: number): string[] {
  const out: string[] = [];
  if (!result || result.errors.length === 0) {
    out.push(padRow(C.success('  no errors'), width));
  } else {
    for (const err of result.errors.slice(0, Math.max(1, height - 1))) {
      const line = `  ${err.path} · ${err.message}`;
      out.push(padRow(C.error(line), width));
    }
    if (result.errors.length > height - 1) {
      out.push(padRow(C.muted(`  (+${result.errors.length - (height - 1)} more)`), width));
    }
  }
  while (out.length < height) out.push(padRow('', width));
  return out.slice(0, height);
}

function headerLine(title: string, mode: 'edit' | 'preview', result: DecodeResult | null, width: number): string {
  const errs = result?.errors.length ?? 0;
  const wdg = result?.widgets.length ?? 0;
  const modeTag = mode === 'edit' ? '[edit]' : '[preview]';
  const summary = `${wdg} widget${wdg === 1 ? '' : 's'} · ${errs} error${errs === 1 ? '' : 's'}`;
  const left = ` Playground · ${title} `;
  const right = ` ${modeTag} · ${summary} `;
  // Tight widths · just truncate to fit when left+right > width. Dashes
  // pad between when there's room.
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);
  if (leftW + rightW >= width) {
    // Truncate right (keep title visible preferentially).
    const trimmed = ` ${modeTag} `;
    const trimmedW = visibleWidth(trimmed);
    if (leftW + trimmedW <= width) {
      const dashes = width - leftW - trimmedW;
      return C.accent(left) + '─'.repeat(Math.max(0, dashes)) + C.muted(trimmed);
    }
    // Still overflow · take just the left part truncated
    return padRow(C.accent(left), width);
  }
  const dashes = width - leftW - rightW;
  return C.accent(left) + '─'.repeat(dashes) + C.muted(right);
}

function replaceSourceFromPreset(
  presetId: string,
  previewThemeName: string | undefined,
  presetSourceMode: PlaygroundConfig['presetSourceMode'],
): Partial<PlaygroundState> {
  const source = presetSourceMode === 'reference'
    ? buildWidgetLabPresetReferenceYAML(presetId)
    : buildWidgetLabPresetYAML(presetId);
  const current = deriveResult(source);
  return {
    source,
    cursor: 0,
    current,
    lastValid: current,
    mode: 'edit',
    editorScrollTop: 0,
    previewMotionToken: undefined,
    previewThemeName,
    presetName: presetId,
    presetSourceMode: presetSourceMode ?? 'expanded',
    previewIndex: 0,
    statusNote: `preset:${presetId}`,
  };
}

function togglePresetSourceMode(state: PlaygroundState): Partial<PlaygroundState> {
  const nextMode = state.presetSourceMode === 'reference' ? 'expanded' : 'reference';
  if (!state.presetName) {
    return { presetSourceMode: nextMode };
  }
  return replaceSourceFromPreset(state.presetName, state.previewThemeName, nextMode);
}

const DEFAULT_SOURCE = [
  '# Edit YAML here. Ctrl+P toggles edit/preview focus.',
  '',
  'id: my-scratch',
  'title: My Scratch',
  'layout:',
  '  - widget: log',
  '    id: log-1',
  '    character: Telemetry',
  '    style:',
  '      className: card',
  '      variant: raised',
  '      decoration:',
  '        color: surface',
  '    chrome:',
  '      variant: window',
  '      title: Telemetry',
  '      footer: Ctrl+P preview',
  '    motion:',
  '      preset: fade',
  '      durationMs: 180',
  '    interactions:',
  '      click:',
  '        action: open-log',
  '    config:',
  '      lines:',
  '        - "> hello"',
].join('\n');

const playgroundWidget: Widget<PlaygroundState, PlaygroundConfig> = {
  type: 'playground',
  description: 'Live scenario YAML editor · P5b · typing re-decodes via materializeScenario',
  defaultCharacter: 'Playground',

  initialState(config): PlaygroundState {
    const presetName = config?.initialPreset;
    const boundSource = config?.filePath ? loadBoundSource(config.filePath) : null;
    const source = boundSource ?? (presetName
      ? (config?.presetSourceMode === 'reference'
        ? buildWidgetLabPresetReferenceYAML(presetName)
        : buildWidgetLabPresetYAML(presetName))
      : (config?.source ?? DEFAULT_SOURCE));
    const current = deriveResult(source);
    return {
      source,
      cursor: 0,
      current,
      lastValid: current?.ok ? current : null,
      mode: 'edit',
      title: config?.title ?? 'scratch',
      editorScrollTop: 0,
      previewMotionToken: undefined,
      previewThemeName: config?.previewTheme ?? DEFAULT_THEME_TOKENS.name,
      presetName: presetName ?? undefined,
      presetSourceMode: config?.presetSourceMode ?? 'expanded',
      previewIndex: 0,
      ...(config?.filePath ? { boundFilePath: config.filePath } : {}),
      ...(config?.filePath ? { statusNote: boundSource !== null ? `loaded:${config.filePath}` : `new:${config.filePath}` } : {}),
    };
  },

  render(state, ctx) {
    const w = ctx.width;
    const h = Math.max(8, ctx.height);
    const previewTheme = resolvePreviewTheme(state);
    const motionToken = previewMotionTokenForState(state);
    if (motionToken && state.previewMotionToken !== motionToken) {
      state.previewMotionToken = motionToken;
      ctx.animate?.tween({
        key: `playground.preview.${motionToken}`,
        durationMs: state.current?.widgets[0]?.motion?.enter?.durationMs
          ?? state.current?.widgets[0]?.motion?.durationMs
          ?? 180,
        curve: 'easeOut',
      });
    }
    if (!motionToken) state.previewMotionToken = undefined;
    const motionProgress = motionToken
      ? (ctx.animate?.progress(`playground.preview.${motionToken}`) ?? 1)
      : 1;
    // Split: header 1 · editor · divider 1 · preview 6 · divider 1 · errors.
    const previewHeight = PREVIEW_HEIGHT;
    const editorHeight = Math.max(3, h - previewHeight - 5);
    const errorsHeight = Math.max(1, h - editorHeight - previewHeight - 3);

    const rows: string[] = [];
    const presetLabel = state.presetName
      ? ` · preset=${getWidgetLabPreset(state.presetName)?.title ?? state.presetName}:${state.presetSourceMode}`
      : '';
    const fileLabel = state.boundFilePath ? ` · file=${state.boundFilePath.split('/').pop()}` : '';
    const statusLabel = state.statusNote ? ` · ${state.statusNote}` : '';
    rows.push(headerLine(`${state.title}${presetLabel}${fileLabel} · ${previewTheme.name}${statusLabel}`, state.mode, state.current, w));
    rows.push(...renderEditor(state, w, editorHeight));
    rows.push(padRow(C.muted('─── preview ' + '─'.repeat(Math.max(0, w - 13))), w));
    rows.push(...renderPreview(state, w, previewHeight, previewTheme, motionProgress));
    rows.push(padRow(C.muted('─── errors ' + '─'.repeat(Math.max(0, w - 12))), w));
    rows.push(...renderErrors(state.current, w, errorsHeight));
    while (rows.length < h) rows.push(padRow('', w));
    return rows.slice(0, h);
  },

  onKey(ev, state, ctx) {
    const name = ev.name ?? '';

    // Ctrl+P — toggle mode
    if (ev.ctrl && name === 'p') {
      ctx.setState({ mode: state.mode === 'edit' ? 'preview' : 'edit' } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (ev.ctrl && name === 't') {
      ctx.setState({
        previewThemeName: cyclePreviewTheme(state.previewThemeName, ev.shift ? -1 : 1),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (ev.ctrl && name === 'y') {
      ctx.setState(replaceSourceFromPreset(
        cycleWidgetLabPreset(state.presetName, ev.shift ? -1 : 1),
        state.previewThemeName,
        state.presetSourceMode,
      ) as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (ev.ctrl && name === 'r') {
      ctx.setState(togglePresetSourceMode(state) as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (ev.ctrl && name === 's' && state.boundFilePath) {
      writeFileSync(state.boundFilePath, state.source, 'utf8');
      ctx.setState({ statusNote: `saved:${state.boundFilePath}` } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (ev.ctrl && name === 'l' && state.boundFilePath) {
      const source = loadBoundSource(state.boundFilePath);
      if (source !== null) {
        const current = deriveResult(source);
        ctx.setState({
          source,
          cursor: 0,
          current,
          lastValid: current?.ok ? current : state.lastValid,
          editorScrollTop: 0,
          previewIndex: 0,
          statusNote: `loaded:${state.boundFilePath}`,
        } as Partial<PlaygroundState>);
        return { type: 'refresh' };
      }
    }

    // Escape — dismiss
    if (name === 'escape') {
      ctx.dismiss?.();
      return { type: 'none' };
    }

    // Preview mode — navigation only, no editor mutations
    if (state.mode === 'preview') {
      const total = (state.current ?? state.lastValid)?.widgets.length ?? 0;
      if (name === 'up' || name === 'k' || name === 'left') {
        ctx.setState({ previewIndex: nextPreviewIndex(state.previewIndex, total, -1) } as Partial<PlaygroundState>);
        return { type: 'refresh' };
      }
      if (name === 'down' || name === 'j' || name === 'right') {
        ctx.setState({ previewIndex: nextPreviewIndex(state.previewIndex, total, 1) } as Partial<PlaygroundState>);
        return { type: 'refresh' };
      }
      if (name === 'home') {
        ctx.setState({ previewIndex: 0 } as Partial<PlaygroundState>);
        return { type: 'refresh' };
      }
      if (name === 'end') {
        ctx.setState({ previewIndex: Math.max(0, total - 1) } as Partial<PlaygroundState>);
        return { type: 'refresh' };
      }
      return { type: 'none' };
    }

    // Cursor navigation
    if (name === 'left') {
      const nextCursor = Math.max(0, state.cursor - 1);
      ctx.setState({
        cursor: nextCursor,
        editorScrollTop: nextEditorScrollTopForCursor(state.source, nextCursor, state.editorScrollTop, editorHeightFor(ctx.height ?? 8)),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (name === 'right') {
      const nextCursor = Math.min(state.source.length, state.cursor + 1);
      ctx.setState({
        cursor: nextCursor,
        editorScrollTop: nextEditorScrollTopForCursor(state.source, nextCursor, state.editorScrollTop, editorHeightFor(ctx.height ?? 8)),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (name === 'up' || name === 'down') {
      const { line, col } = cursorToLineCol(state.source, state.cursor);
      const nextLine = name === 'up' ? line - 1 : line + 1;
      const next = lineColToCursor(state.source, nextLine, col);
      const lines = state.source.split('\n');
      const clampedLine = Math.min(Math.max(0, nextLine), lines.length - 1);
      const nextScrollTop = nextEditorScrollTop(state.editorScrollTop, clampedLine, editorHeightFor(ctx.height ?? 8), lines.length);
      ctx.setState({ cursor: next, editorScrollTop: nextScrollTop } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (name === 'home') {
      const { line } = cursorToLineCol(state.source, state.cursor);
      const nextCursor = lineColToCursor(state.source, line, 0);
      ctx.setState({
        cursor: nextCursor,
        editorScrollTop: nextEditorScrollTopForCursor(state.source, nextCursor, state.editorScrollTop, editorHeightFor(ctx.height ?? 8)),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (name === 'end') {
      const { line } = cursorToLineCol(state.source, state.cursor);
      const lines = state.source.split('\n');
      const lineLen = lines[line]?.length ?? 0;
      const nextCursor = lineColToCursor(state.source, line, lineLen);
      ctx.setState({
        cursor: nextCursor,
        editorScrollTop: nextEditorScrollTopForCursor(state.source, nextCursor, state.editorScrollTop, editorHeightFor(ctx.height ?? 8)),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }

    // Editing
    if (name === 'backspace') {
      if (state.cursor === 0) return { type: 'refresh' };
      const next = state.source.slice(0, state.cursor - 1) + state.source.slice(state.cursor);
      const result = deriveResult(next);
      ctx.setState({
        source: next,
        cursor: state.cursor - 1,
        editorScrollTop: nextEditorScrollTopForCursor(next, state.cursor - 1, state.editorScrollTop, editorHeightFor(ctx.height ?? 8)),
        current: result,
        presetName: undefined,
        previewIndex: 0,
        ...(result?.ok ? { lastValid: result } : {}),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }
    if (name === 'return' || name === 'enter') {
      const next = state.source.slice(0, state.cursor) + '\n' + state.source.slice(state.cursor);
      const result = deriveResult(next);
      ctx.setState({
        source: next,
        cursor: state.cursor + 1,
        editorScrollTop: nextEditorScrollTopForCursor(next, state.cursor + 1, state.editorScrollTop, editorHeightFor(ctx.height ?? 8)),
        current: result,
        presetName: undefined,
        previewIndex: 0,
        ...(result?.ok ? { lastValid: result } : {}),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }

    // Printable character insertion
    if (ev.sequence && ev.sequence.length === 1 && !ev.ctrl && !ev.alt) {
      const ch = ev.sequence;
      const code = ch.charCodeAt(0);
      if (code >= 0x20 && code !== 0x7f) {
        const next = state.source.slice(0, state.cursor) + ch + state.source.slice(state.cursor);
        const result = deriveResult(next);
        ctx.setState({
          source: next,
          cursor: state.cursor + 1,
          editorScrollTop: nextEditorScrollTopForCursor(next, state.cursor + 1, state.editorScrollTop, editorHeightFor(ctx.height ?? 8)),
          current: result,
          presetName: undefined,
          previewIndex: 0,
          ...(result?.ok ? { lastValid: result } : {}),
        } as Partial<PlaygroundState>);
        return { type: 'refresh' };
      }
    }

    return { type: 'none' };
  },

  onMouse(ev, state, ctx) {
    const h = Math.max(8, ctx.height ?? 8);
    const editorHeight = editorHeightFor(h);
    const previewStart = 1 + editorHeight;
    const previewHeaderRow = previewStart;
    const previewBodyStart = previewStart + 1;
    const previewBodyEnd = previewBodyStart + PREVIEW_HEIGHT;

    if (ev.type === 'scroll-up' || ev.type === 'scroll-down') {
      const lines = state.source.split('\n');
      const { line, col } = cursorToLineCol(state.source, state.cursor);
      const nextLine = ev.type === 'scroll-up' ? line - 1 : line + 1;
      const clampedLine = Math.min(Math.max(0, nextLine), lines.length - 1);
      const nextCursor = lineColToCursor(state.source, clampedLine, col);
      const nextScrollTop = nextEditorScrollTop(state.editorScrollTop, clampedLine, editorHeight, lines.length);
      ctx.setState({
        cursor: nextCursor,
        editorScrollTop: nextScrollTop,
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }

    if (ev.type !== 'click' && ev.type !== 'double-click') return { type: 'none' };
    if (ev.row === 0) return { type: 'none' };

    if (ev.row >= 1 && ev.row < previewHeaderRow) {
      const targetLine = state.editorScrollTop + (ev.row - 1);
      const lines = state.source.split('\n');
      if (targetLine >= lines.length) return { type: 'none' };
      const lineText = lines[targetLine] ?? '';
      const col = Math.max(0, ev.col - 5);
      ctx.setState({
        mode: 'edit',
        cursor: lineColToCursor(state.source, targetLine, Math.min(col, lineText.length)),
      } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }

    if (ev.row >= previewBodyStart && ev.row < previewBodyEnd) {
      const result = state.current ?? state.lastValid;
      const total = result?.widgets.length ?? 0;
      const cardHeight = previewCardHeight(PREVIEW_HEIGHT, total);
      const relativeRow = ev.row - previewBodyStart;
      let previewIndex = state.previewIndex;
      if (relativeRow >= cardHeight) {
        const secondaryIndex = relativeRow - cardHeight;
        const secondaryWidgets = (result?.widgets ?? []).filter((_, idx) => idx !== state.previewIndex);
        const selected = secondaryWidgets[Math.min(Math.max(0, secondaryIndex), Math.max(0, secondaryWidgets.length - 1))];
        const resolvedIndex = selected ? (result?.widgets ?? []).indexOf(selected) : -1;
        if (resolvedIndex >= 0) previewIndex = resolvedIndex;
      }
      ctx.setState({ mode: 'preview', previewIndex } as Partial<PlaygroundState>);
      return { type: 'refresh' };
    }

    return { type: 'none' };
  },

  describeSurface(state, _ctx) {
    const errs = state.current?.errors.length ?? 0;
    const wdg = state.current?.widgets.length ?? 0;
    const lines = state.source.split('\n').length;
    return `playground · ${state.title} · ${lines} lines · ${wdg} widgets · ${errs} errors`;
  },

  snapshotHash(state) {
    // Stable hash over editable surface — source + cursor + mode.
    // Preview/current aren't part of identity; they're derived.
    return `${state.source.length}:${state.cursor}:${state.mode}`;
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Seed YAML content for the editor.' },
        title: { type: 'string', description: 'Display title in the header bar.' },
        previewTheme: { type: 'string', description: 'Theme preset name for the preview card.' },
        initialPreset: { type: 'string', description: 'Widget lab preset id to seed the editor.' },
        presetSourceMode: {
          type: 'string',
          enum: ['expanded', 'reference'],
          description: 'Whether presets seed the editor as expanded YAML or a compact preset reference.',
        },
        filePath: { type: 'string', description: 'Optional file path for Ctrl+S save and Ctrl+L reload.' },
      },
      additionalProperties: false,
    };
  },
};

function editorHeightFor(height: number): number {
  return Math.max(3, Math.max(8, height) - PREVIEW_HEIGHT - 5);
}

function nextEditorScrollTop(current: number, cursorLine: number, editorHeight: number, totalLines: number): number {
  let next = current;
  if (cursorLine < next) next = cursorLine;
  if (cursorLine >= next + editorHeight) next = cursorLine - editorHeight + 1;
  const maxScrollTop = Math.max(0, totalLines - editorHeight);
  return Math.max(0, Math.min(maxScrollTop, next));
}

function nextEditorScrollTopForCursor(source: string, cursor: number, current: number, editorHeight: number): number {
  const lines = source.split('\n');
  const { line } = cursorToLineCol(source, cursor);
  return nextEditorScrollTop(current, line, editorHeight, lines.length);
}

export default playgroundWidget;
