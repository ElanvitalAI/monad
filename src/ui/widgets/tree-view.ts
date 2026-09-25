// LC8 — TreeView: recursive hierarchical list.
//
// Each node carries an opaque payload plus a `children` array (for
// synchronous trees) or a `loader` callback (for lazy trees). Nodes
// can be expanded/collapsed; the visible rows are the flattened
// pre-order traversal with collapsed subtrees skipped.
//
// Keys:
//   ↑↓ / j/k      — move cursor through visible nodes
//   Space / →     — expand (or collapse again)
//   ←             — collapse if open; else jump to parent
//   Enter         — onPick(node)
//   Esc           — onCancel
//
// IDX-6 round-2 (2026-04-19) — optional theme. Cursor glyph + bolded
// focused row resolve from `selectView.cursor`; loading-dot + empty
// state use `semantic.muted`.

import type { KeyEvent } from '../../plugins/core/types.js';
import {
  paintPair,
  resolveSemantic,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../../theme/tokens.js';
import { C } from '../../tui.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import { isClickIntentMouseEventType, type MouseEvent } from '../mouse-events.js';
import { moveCursorBy, moveCursorByPage, moveCursorToEdge } from './selection-cursor.js';
import { dispatchPointerListMouse } from './pointer-list-controller.js';

export interface TreeNode<T> {
  label: string;
  value: T;
  children?: TreeNode<T>[];
  loader?: () => Promise<TreeNode<T>[]>;
  isLeaf?: boolean;
}

export interface TreeViewSpec<T> {
  root: TreeNode<T>[];
  onPick?: (node: TreeNode<T>) => void;
  onCancel?: () => void;
  /** Legacy no-op flag kept for call-site compatibility while the
   *  collection contract is normalized to click=select,
   *  double-click=activate. Marker clicks still toggle
   *  expand/collapse. */
  browseMode?: boolean;
  /** MD4 — optional cursor-move hook fired independently of pick. */
  onCursor?: (node: TreeNode<T>, idx: number) => void;
  /** IDX-6 round-2 — optional theme. Absent = legacy C.* painters. */
  theme?: ThemeTokens;
}

interface FlatEntry<T> {
  node: TreeNode<T>;
  depth: number;
  parentIdx: number;
  path: number[];
  expanded: boolean;
  hasChildren: boolean;
}

export class TreeView<T> implements View {
  private expanded = new Set<string>();
  private cursor = 0;
  private scroll = 0;
  private focused = false;
  private size: Size = { width: 40, height: 8 };
  private loadingKeys = new Set<string>();

  constructor(private spec: TreeViewSpec<T>) {}

  // ── flattening ──────────────────────────────────────────────
  private flatten(): FlatEntry<T>[] {
    const out: FlatEntry<T>[] = [];
    const walk = (nodes: TreeNode<T>[], depth: number, parentIdx: number, parentPath: number[]) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        const path = [...parentPath, i];
        const key = path.join('/');
        const hasChildren = !node.isLeaf && (!!node.children?.length || !!node.loader);
        const isExpanded = this.expanded.has(key);
        const idx = out.length;
        out.push({ node, depth, parentIdx, path, expanded: isExpanded, hasChildren });
        if (isExpanded && node.children) walk(node.children, depth + 1, idx, path);
      }
    };
    walk(this.spec.root, 0, -1, []);
    return out;
  }

  private pathKey(path: number[]): string { return path.join('/'); }

  // ── draw ────────────────────────────────────────────────────
  draw(p: Printer): void {
    this.size = { width: p.width, height: p.height };
    const flat = this.flatten();
    const cursorPaint = this.cursorPainter();
    const mutedPaint = this.mutedPainter();
    if (flat.length === 0) { p.text(0, 0, mutedPaint('(empty)')); return; }

    this.cursor = Math.max(0, Math.min(this.cursor, flat.length - 1));
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + p.height) this.scroll = this.cursor - p.height + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, flat.length - p.height)));

    for (let row = 0; row < p.height; row++) {
      const idx = this.scroll + row;
      if (idx >= flat.length) break;
      const entry = flat[idx]!;
      const isCursor = idx === this.cursor;
      const indent = '  '.repeat(entry.depth);
      const marker = entry.hasChildren ? (entry.expanded ? '▾ ' : '▸ ') : '  ';
      const loadingTag = this.loadingKeys.has(this.pathKey(entry.path)) ? mutedPaint(' …') : '';
      const line = `${isCursor ? cursorPaint('❯') : ' '} ${indent}${marker}${entry.node.label}${loadingTag}`;
      p.text(0, row, isCursor && p.focused && this.focused ? cursorPaint(line) : line);

      // MX7 — register the full row first, then the marker region on
      // top. Our ClickRegistry resolves hits back-to-front, so the
      // marker (last registered) wins inside its 2-cell band while
      // clicks elsewhere fall through to the row region.
      p.clickable({ x: 0, y: row, width: p.width, height: 1 }, this, { kind: 'row', idx });
      if (entry.hasChildren) {
        const markerX = 2 + indent.length;
        p.clickable(
          { x: markerX, y: row, width: 2, height: 1 },
          this,
          { kind: 'marker', idx },
        );
      }
    }
  }

  // ── events ──────────────────────────────────────────────────
  onEvent(ev: KeyEvent): EventResult {
    if (!this.focused) return Ignored;
    const flat = this.flatten();
    if (flat.length === 0) {
      if (ev.name === 'escape') { this.spec.onCancel?.(); return Consumed(); }
      return Ignored;
    }
    const here = flat[this.cursor]!;

    if (ev.name === 'escape') { this.spec.onCancel?.(); return Consumed(); }
    if (ev.name === 'enter')  {
      if (this.spec.onPick) this.spec.onPick(here.node);
      return Consumed();
    }
    if (ev.name === 'up'   || ev.name === 'k' || (ev.ctrl && ev.name === 'p')) {
      this.cursor = moveCursorBy(this.cursor, flat.length, -1); return Consumed();
    }
    if (ev.name === 'down' || ev.name === 'j' || (ev.ctrl && ev.name === 'n')) {
      this.cursor = moveCursorBy(this.cursor, flat.length, 1); return Consumed();
    }
    if (ev.name === 'pageup')   { this.cursor = moveCursorByPage(this.cursor, flat.length, this.size.height, -1); return Consumed(); }
    if (ev.name === 'pagedown') { this.cursor = moveCursorByPage(this.cursor, flat.length, this.size.height, 1); return Consumed(); }
    if (ev.name === 'home')     { this.cursor = moveCursorToEdge(flat.length, 'start'); return Consumed(); }
    if (ev.name === 'end')      { this.cursor = moveCursorToEdge(flat.length, 'end'); return Consumed(); }
    if (ev.name === 'space' || ev.name === 'right') {
      if (!here.hasChildren) return Consumed();
      void this.toggleExpand(here);
      return Consumed();
    }
    if (ev.name === 'left') {
      const key = this.pathKey(here.path);
      if (here.expanded) {
        this.expanded.delete(key);
      } else if (here.parentIdx >= 0) {
        this.cursor = here.parentIdx;
      }
      return Consumed();
    }
    return Ignored;
  }

  // MX7 + MD4 — mouse.
  //   - marker click            → expand/collapse, no pick
  //   - row click               → select (+ onCursor)
  //   - row double-click        → pick
  //   - scroll-up/scroll-down   → move cursor by 3
  onMouse(ev: MouseEvent): EventResult {
    const flat = this.flatten();
    if (flat.length === 0) return Ignored;
    if (isClickIntentMouseEventType(ev.type)) {
      const p = ev.payload as { kind?: string; idx?: number } | undefined;
      if (typeof p?.idx !== 'number' || p.idx < 0 || p.idx >= flat.length) return Ignored;
      this.cursor = p.idx;
      const entry = flat[p.idx]!;
      if (p.kind === 'marker' && entry.hasChildren) {
        void this.toggleExpand(entry);
        return Consumed();
      }
      if (p.kind !== 'row') return Ignored;
    }
    return dispatchPointerListMouse({
      event: ev,
      count: flat.length,
      currentIndex: this.cursor,
      browseMode: this.spec.browseMode,
      getValueAt: (index) => flat[index]?.node ?? null,
      setCursor: (index) => {
        this.cursor = index;
      },
      onCursor: this.spec.onCursor,
      onActivate: this.spec.onPick ? (value) => this.spec.onPick?.(value) : undefined,
    });
  }

  private async toggleExpand(entry: FlatEntry<T>): Promise<void> {
    const key = this.pathKey(entry.path);
    if (this.expanded.has(key)) { this.expanded.delete(key); return; }
    if (entry.node.children?.length) {
      this.expanded.add(key);
      return;
    }
    if (entry.node.loader && !this.loadingKeys.has(key)) {
      this.loadingKeys.add(key);
      try {
        const children = await entry.node.loader();
        entry.node.children = children;
        this.expanded.add(key);
      } finally {
        this.loadingKeys.delete(key);
      }
    }
  }

  layout(s: Size): void { this.size = s; }

  requiredSize(c: Size): Size {
    return {
      width: c.width,
      height: Math.min(c.height, Math.max(1, this.flatten().length)),
    };
  }

  takeFocus(_s?: FocusSource): boolean { this.focused = true; return true; }
  blur(): void { this.focused = false; }

  private cursorPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return (s: string) => C.bold(C.accent(s));
    return paintPair(resolveWidgetTokens(theme, 'selectView').cursor);
  }

  private mutedPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.muted;
    return paintPair(resolveSemantic(theme, 'muted'));
  }

  /** @internal — test helpers. */
  _state() {
    const flat = this.flatten();
    return {
      cursor: this.cursor,
      scroll: this.scroll,
      visibleCount: flat.length,
      selected: flat[this.cursor]?.node ?? null,
      expanded: Array.from(this.expanded),
    };
  }
}
