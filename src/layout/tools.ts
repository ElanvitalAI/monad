// ── LLM layout tools ──
// Exposes layout mutations (addWidget, resize, addRow, openModal, …)
// as LLMToolDef entries the chat LLM can invoke. Dashboard wires them
// up at setup time — they mutate whatever layout is currently in
// effect (plugin's if one is active, otherwise the dashboard's
// default browse layout).

import type { LLMToolDef } from '../plugins/core/types.js';
import type { Layout, LayoutRow, LayoutCell, Size, ModalPlacement } from './types.js';
import type { WidgetHost } from '../widgets/host.js';
import {
  addRow, removeRow, addCell, removeCell,
  placeWidget, removeWidget as removeWidgetFromLayout,
  resizeCell, resizeRow, openModal, closeModal,
  locate, instanceIds,
} from './host.js';

export interface LayoutToolDeps {
  /** Read the currently effective layout (plugin's or dashboard's). */
  getCurrentLayout(): Layout;
  /** Replace the currently effective layout with a new one. */
  setCurrentLayout(next: Layout): void;
  /** Widget registry for spawning / disposing instances. */
  widgetHost: WidgetHost;
  /** Append a plain-text notice into the log pane. */
  notify(msg: string): void;
  /** Fires AFTER a successful `layout_setWidgetState` patch. Lets the
   *  dashboard keep its own buffers (scratchLines, etc.) in sync when
   *  an LLM tool mutates widget state directly — without this, the
   *  dashboard's next redraw overwrites the patched state from its own
   *  source-of-truth buffer and the LLM's write silently disappears.
   *  Optional — omit and tool-driven patches stay unmirrored. */
  onWidgetStatePatched?(id: string, patch: Record<string, unknown>): void;
  /** Widget ids the dashboard re-renders from its own state on every
   *  draw (wd-browser mirrors filesystem, wd-log mirrors chatLines,
   *  wd-preview mirrors the active preview). LLM writes to these
   *  succeed at the state level but get overwritten on the next frame
   *  — a silent-failure footgun. We reject with a clear error pointing
   *  to the alternatives (wd-scratch for persistent content, or
   *  layout_addWidget to spawn a new widget the dashboard won't touch).
   *  Optional — omit to leave all widgets patchable. */
  reservedWidgetIds?: Set<string>;
}

/** Parse a size argument from the LLM. Accepts numbers, 'flex', or
 *  strings like '0.33' / '10'. Invalid inputs throw so the tool
 *  result surfaces a typed error to the model. */
function parseSize(v: unknown, what: string): Size {
  if (v === 'flex') return 'flex';
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v === 'flex') return 'flex';
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`${what}: expected number or 'flex', got ${JSON.stringify(v)}`);
}

function requireInt(v: unknown, what: string): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`${what}: expected integer, got ${JSON.stringify(v)}`);
}

export function createLayoutTools(deps: LayoutToolDeps): LLMToolDef[] {
  const {
    getCurrentLayout, setCurrentLayout, widgetHost, notify,
    onWidgetStatePatched, reservedWidgetIds,
  } = deps;

  return [
    {
      name: 'layout_getState',
      description: 'Return the current dashboard layout: rows × cells grid + active modals + which widget instances are placed where. Call first when the user asks to rearrange the layout.',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const layout = getCurrentLayout();
        const widgets = instanceIds(layout).map(id => {
          const inst = widgetHost.get(id);
          return inst ? { id, type: inst.type, character: inst.character } : { id, missing: true };
        });
        return {
          rows: layout.rows.map(r => ({
            height: r.height ?? 'flex',
            cells: r.cells.map(c => ({ widgetInstanceId: c.widgetInstanceId, width: c.width ?? 'flex' })),
          })),
          modals: layout.modals,
          widgets,
          availableWidgetTypes: widgetHost.available().map(e => ({ type: e.def.type, description: e.def.description })),
        };
      },
    },
    {
      name: 'layout_addWidget',
      description: 'Spawn a new widget instance and place it in the layout. Pass initial content via config. Examples: markdown → config:{text:"hello"}, list → config:{items:["a","b"]}, chart-line → config:{series:[1,2,3],unit:"$"}. Use layout_setWidgetState later to update content.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Widget type (use layout_getState to list availableWidgetTypes)' },
          row: { type: 'number', description: 'Row index to place the widget in' },
          col: { type: 'number', description: 'Column index within the row. If a cell is empty there, the widget is placed; otherwise a new cell is inserted.' },
          character: { type: 'string', description: 'User-visible title / role for this widget instance' },
          id: { type: 'string', description: 'Optional explicit instance id; default is auto-generated' },
          config: { type: 'object', description: 'Initial content. markdown:{text}, list:{items,icons?}, chart-line:{series,unit?,color?}' },
        },
        required: ['type', 'row', 'col'],
      },
      handler: async (args) => {
        const type = String(args.type);
        const row = requireInt(args.row, 'row');
        const col = requireInt(args.col, 'col');
        if (!widgetHost.hasType(type)) {
          throw new Error(`unknown widget type "${type}" — call layout_getState to see availableWidgetTypes`);
        }
        const inst = widgetHost.spawn({
          type,
          character: typeof args.character === 'string' ? args.character : undefined,
          id: typeof args.id === 'string' ? args.id : undefined,
          config: (args.config && typeof args.config === 'object') ? (args.config as Record<string, unknown>) : undefined,
        });
        const layout = getCurrentLayout();
        const target = layout.rows[row];
        let next: Layout;
        if (target && target.cells[col] && target.cells[col]!.widgetInstanceId === null) {
          next = placeWidget(layout, row, col, inst.id);
        } else {
          const cell: LayoutCell = { widgetInstanceId: inst.id, width: 'flex' };
          next = addCell(layout, row, cell, col);
        }
        setCurrentLayout(next);
        notify(`layout: added ${type} widget "${inst.id}" at (${row}, ${col})`);
        return { id: inst.id, type, row, col };
      },
    },
    {
      name: 'layout_setWidgetState',
      description: 'Merge a state patch into an existing widget. Use this to update widget content after layout_addWidget — e.g. set markdown text, update a list\'s items, refresh a chart\'s series. Patch keys depend on the widget type.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Widget instance id' },
          patch: { type: 'object', description: 'Partial state to merge. Examples: markdown → {text:"..."}, list → {items:[...]}, chart-line → {series:[1,2,3]}' },
        },
        required: ['id', 'patch'],
      },
      handler: async (args) => {
        const id = String(args.id);
        const patch = (args.patch && typeof args.patch === 'object') ? (args.patch as Record<string, unknown>) : null;
        if (!patch) throw new Error('patch must be an object');
        // Reject writes to dashboard-owned widgets — those get
        // overwritten on next draw from internal buffers, so a
        // "successful" patch here would silently disappear. Redirect
        // the LLM to writable surfaces it can actually use.
        if (reservedWidgetIds?.has(id)) {
          throw new Error(
            `widget "${id}" is dashboard-managed and will be overwritten on the next ` +
            `redraw — the dashboard re-renders it from its own internal buffer every ` +
            `frame. For persistent content, write to "wd-scratch" instead ` +
            `(layout_setWidgetState({id:"wd-scratch",patch:{text:"..."}})), or spawn ` +
            `a fresh widget the dashboard will NOT touch via layout_addWidget.`,
          );
        }
        const inst = widgetHost.get(id);
        if (!inst) throw new Error(`widget "${id}" not found`);
        inst.state = { ...(inst.state as object), ...patch };
        // Let the dashboard mirror the patch into any internal buffer
        // that would otherwise overwrite this state on the next draw.
        // See the wd-scratch / scratchLines bug: without this hook the
        // LLM's write to `layout_setWidgetState` got clobbered on the
        // very next redraw because dashboard's draw() unconditionally
        // rewrites scratch.state.text from its own buffer.
        try {
          onWidgetStatePatched?.(id, patch);
        } catch { /* swallow — mirror is best-effort */ }
        notify(`layout: updated state of "${id}" (${Object.keys(patch).join(', ')})`);
        return { id, patched: Object.keys(patch) };
      },
    },
    {
      name: 'layout_removeWidget',
      description: 'Remove a widget by instance id. The cell is cleared but the row structure stays.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Widget instance id to remove' },
        },
        required: ['id'],
      },
      handler: async (args) => {
        const id = String(args.id);
        const layout = getCurrentLayout();
        const pos = locate(layout, id);
        if (!pos) return { removed: false, reason: `widget "${id}" not found in layout` };
        setCurrentLayout(removeWidgetFromLayout(layout, id));
        widgetHost.dispose(id);
        notify(`layout: removed widget "${id}" from (${pos.row}, ${pos.col})`);
        return { removed: true, row: pos.row, col: pos.col };
      },
    },
    {
      name: 'layout_resizeCell',
      description: 'Change a cell\'s width. Size can be a fraction (0 < n < 1), an absolute column count (>= 1), or "flex".',
      parameters: {
        type: 'object',
        properties: {
          row: { type: 'number' },
          col: { type: 'number' },
          width: { description: "Number or 'flex'" },
        },
        required: ['row', 'col', 'width'],
      },
      handler: async (args) => {
        const row = requireInt(args.row, 'row');
        const col = requireInt(args.col, 'col');
        const width = parseSize(args.width, 'width');
        setCurrentLayout(resizeCell(getCurrentLayout(), row, col, width));
        notify(`layout: resized cell (${row}, ${col}) to ${JSON.stringify(width)}`);
        return { row, col, width };
      },
    },
    {
      name: 'layout_resizeRow',
      description: 'Change a row\'s height. Same size rules as resizeCell.',
      parameters: {
        type: 'object',
        properties: {
          row: { type: 'number' },
          height: { description: "Number or 'flex'" },
        },
        required: ['row', 'height'],
      },
      handler: async (args) => {
        const row = requireInt(args.row, 'row');
        const height = parseSize(args.height, 'height');
        setCurrentLayout(resizeRow(getCurrentLayout(), row, height));
        notify(`layout: resized row ${row} to ${JSON.stringify(height)}`);
        return { row, height };
      },
    },
    {
      name: 'layout_addRow',
      description: 'Insert a new row with an empty cell. The row gets flex height by default.',
      parameters: {
        type: 'object',
        properties: {
          at: { type: 'number', description: 'Position to insert (default: append at the bottom)' },
          height: { description: "Number or 'flex' (default 'flex')" },
        },
      },
      handler: async (args) => {
        const layout = getCurrentLayout();
        const at = args.at !== undefined ? requireInt(args.at, 'at') : layout.rows.length;
        const height: Size = args.height !== undefined ? parseSize(args.height, 'height') : 'flex';
        const row: LayoutRow = { height, cells: [{ widgetInstanceId: null, width: 'flex' }] };
        setCurrentLayout(addRow(layout, row, at));
        notify(`layout: added row at ${at}`);
        return { rowIndex: at };
      },
    },
    {
      name: 'layout_removeRow',
      description: 'Remove a row. Widgets in the row stay spawned — call layout_removeWidget first if you want them gone.',
      parameters: {
        type: 'object',
        properties: {
          row: { type: 'number' },
        },
        required: ['row'],
      },
      handler: async (args) => {
        const row = requireInt(args.row, 'row');
        setCurrentLayout(removeRow(getCurrentLayout(), row));
        notify(`layout: removed row ${row}`);
        return { row };
      },
    },
    {
      name: 'layout_removeCell',
      description: 'Remove one cell from a row. The row keeps its other cells.',
      parameters: {
        type: 'object',
        properties: {
          row: { type: 'number' },
          col: { type: 'number' },
        },
        required: ['row', 'col'],
      },
      handler: async (args) => {
        const row = requireInt(args.row, 'row');
        const col = requireInt(args.col, 'col');
        setCurrentLayout(removeCell(getCurrentLayout(), row, col));
        notify(`layout: removed cell (${row}, ${col})`);
        return { row, col };
      },
    },
    {
      name: 'layout_openModal',
      description: 'Spawn a widget as a modal overlay centered on screen. Pass initial content via config (same as layout_addWidget). Examples: markdown modal → config:{text:"Hello"}.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Modal id (must be unique)' },
          widgetType: { type: 'string', description: 'Widget type to spawn' },
          character: { type: 'string', description: 'Visible title of the modal' },
          config: { type: 'object', description: 'Initial content for the widget. markdown:{text}, list:{items,icons?}, chart-line:{series,unit?}' },
        },
        required: ['id', 'widgetType'],
      },
      handler: async (args) => {
        const id = String(args.id);
        const widgetType = String(args.widgetType);
        if (!widgetHost.hasType(widgetType)) {
          throw new Error(`unknown widget type "${widgetType}"`);
        }
        const inst = widgetHost.spawn({
          type: widgetType,
          character: typeof args.character === 'string' ? args.character : undefined,
          config: (args.config && typeof args.config === 'object') ? (args.config as Record<string, unknown>) : undefined,
        });
        const modal: ModalPlacement = { id, widgetInstanceId: inst.id, position: 'center' };
        setCurrentLayout(openModal(getCurrentLayout(), modal));
        notify(`layout: opened modal "${id}" (widget ${inst.id})`);
        return { modalId: id, widgetId: inst.id };
      },
    },
    {
      name: 'layout_closeModal',
      description: 'Close a modal and dispose its widget. If id is omitted, closes the currently-open modal (there is only one at a time).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Optional modal id. Omit to close the active modal.' },
        },
        required: [],
      },
      handler: async (args) => {
        const layout = getCurrentLayout();
        if (layout.modals.length === 0) return { closed: false, reason: 'no modal open' };
        const id = typeof args.id === 'string' ? args.id : layout.modals[0]!.id;
        const modal = layout.modals.find(m => m.id === id);
        if (!modal) return { closed: false, reason: `modal "${id}" not found` };
        setCurrentLayout(closeModal(layout, id));
        widgetHost.dispose(modal.widgetInstanceId);
        notify(`layout: closed modal "${id}"`);
        return { closed: true, id };
      },
    },
  ];
}
