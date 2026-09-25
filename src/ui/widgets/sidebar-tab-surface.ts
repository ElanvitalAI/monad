import type { KeyEvent } from '../../plugins/core/types.js';
import { C } from '../../tui.js';
import { debug } from '../../debug/log.js';
import { renderSidebarShellBadge, type SidebarShellBadgeTone } from '../chrome/sidebar-shell-badges.js';
import { renderSidebarShellRailRow } from '../chrome/sidebar-shell-rail.js';
import {
  isCaptureEndMouseEventType,
  isCaptureMouseEventType,
  isCaptureMoveMouseEventType,
  isClickIntentMouseEventType,
  isPrimaryClickMouseEventType,
  type MouseEvent,
} from '../mouse-events.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import {
  moveCursorBy,
  moveCursorByPage,
  moveCursorToEdge,
} from './selection-cursor.js';

export interface SidebarTabItem {
  id: string;
  label: string;
  badge?: string;
  badgeTone?: SidebarShellBadgeTone;
  description?: string;
  presentation?: () => Partial<Pick<SidebarTabItem, 'badge' | 'badgeTone' | 'description'>>;
  content: View | (() => View);
}

export interface SidebarTabSurfaceSpec {
  title?: string;
  compactTitle?: string;
  railTitle?: string;
  footerHint?: string;
  compactFooterHint?: string;
  emptyState?: string;
  debugCategory?: string;
  badgeMaxWidth?: number;
  items: SidebarTabItem[];
  initialActive?: number;
  initialActiveId?: string;
  railWidth?: number;
  minRailWidth?: number;
  maxRailWidth?: number;
  onChange?: (active: SidebarTabItem, index: number) => void;
  onActivateItem?: (active: SidebarTabItem, index: number, via: 'double-click') => void;
  onReorderItem?: (fromIndex: number, toIndex: number, active: SidebarTabItem) => void;
}

type FocusArea = 'rail' | 'detail';

export class SidebarTabSurface implements View {
  private active = 0;
  private focusArea: FocusArea = 'rail';
  private lastMouseArea: FocusArea | null = null;
  private scroll = 0;
  private size: Size = { width: 0, height: 0 };
  private readonly viewCache = new Map<string, View>();
  private dragSourceIdx: number | null = null;
  private dragHoverIdx: number | null = null;
  private dragDidMove = false;

  constructor(private readonly spec: SidebarTabSurfaceSpec) {
    if (spec.initialActiveId) {
      const match = spec.items.findIndex((item) => item.id === spec.initialActiveId);
      if (match >= 0) this.active = match;
    } else if (spec.initialActive !== undefined) {
      this.active = this.clampIndex(spec.initialActive);
    }
    this.ensureActiveVisible(this.bodyRows(this.size));
    this.log('mount', {
      title: this.spec.title ?? 'Sidebar tabs',
      items: this.spec.items.length,
      activeIndex: this.active,
      activeId: this.activeItem?.id ?? null,
    });
  }

  get activeIndex(): number {
    return this.active;
  }

  get activeItem(): SidebarTabItem | null {
    return this.spec.items[this.active] ?? null;
  }

  get lastMouseFocusArea(): FocusArea | null {
    return this.lastMouseArea;
  }

  draw(p: Printer): void {
    const titleH = this.titleHeight();
    const footerH = this.footerHeight();
    const bodyH = Math.max(0, p.height - titleH - footerH);
    if (titleH > 0) this.drawTitle(p.sub(0, 0, p.width, titleH, { focused: p.focused }));
    if (bodyH > 0) this.drawBody(p.sub(0, titleH, p.width, bodyH, { focused: p.focused }));
    if (footerH > 0) this.drawFooter(p.sub(0, p.height - footerH, p.width, footerH, { focused: p.focused }));
  }

  onEvent(ev: KeyEvent): EventResult {
    const items = this.spec.items;
    if (items.length === 0) return Ignored;

    if (ev.name === 'tab') {
      this.focusArea = this.focusArea === 'rail' ? 'detail' : 'rail';
      if (this.focusArea === 'detail') this.activeContent()?.takeFocus('front');
      this.log('focus-swap', { via: 'tab', focusArea: this.focusArea, activeId: this.activeItem?.id ?? null });
      return Consumed();
    }
    if (ev.ctrl && ev.name === 'left') {
      this.focusArea = 'rail';
      this.log('focus-swap', { via: 'ctrl-left', focusArea: this.focusArea, activeId: this.activeItem?.id ?? null });
      return Consumed();
    }
    if (ev.ctrl && ev.name === 'right') {
      this.focusArea = 'detail';
      this.activeContent()?.takeFocus('front');
      this.log('focus-swap', { via: 'ctrl-right', focusArea: this.focusArea, activeId: this.activeItem?.id ?? null });
      return Consumed();
    }

    if (this.focusArea === 'rail') return this.onRailEvent(ev);

    const content = this.activeContent();
    if (!content) return Ignored;
    const result = content.onEvent(ev);
    if (result.kind === 'consumed') return result;
    if (ev.name === 'esc') {
      this.focusArea = 'rail';
      return Consumed();
    }
    return Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    const layout = this.computeLayout(this.size);
    if (!layout.bodyHeight) {
      this.lastMouseArea = null;
      return Ignored;
    }
    if (ev.y < layout.bodyY || ev.y >= layout.bodyY + layout.bodyHeight) {
      this.lastMouseArea = null;
      return Ignored;
    }
    const bodyY = ev.y - layout.bodyY;
    if (isCaptureMouseEventType(ev.type) && this.dragSourceIdx !== null) {
      return this.onRailMouse(ev, Math.max(this.railTitleHeight(), bodyY), layout.bodyHeight);
    }
    if (ev.x < layout.railWidth) return this.onRailMouse(ev, bodyY, layout.bodyHeight);
    if (ev.x === layout.railWidth) {
      this.lastMouseArea = null;
      return Ignored;
    }
    return this.onDetailMouse(ev, layout);
  }

  layout(size: Size): void {
    this.size = size;
    this.ensureActiveVisible(this.bodyRows(size));
    const layout = this.computeLayout(size);
    const detail = this.activeContent();
    if (detail) detail.layout({ width: layout.detailWidth, height: layout.bodyHeight });
  }

  requiredSize(constraint: Size): Size {
    const rail = this.resolveRailWidth(constraint.width);
    const titleH = this.titleHeight();
    const footerH = this.footerHeight();
    const active = this.activeContent();
    const detail = active
      ? active.requiredSize({
          width: Math.max(0, constraint.width - rail - 1),
          height: Math.max(0, constraint.height - titleH - footerH),
        })
      : { width: Math.max(12, constraint.width - rail - 1), height: 3 };
    return {
      width: Math.min(constraint.width, rail + 1 + detail.width),
      height: Math.min(constraint.height, titleH + footerH + Math.max(3, detail.height)),
    };
  }

  takeFocus(_source?: FocusSource): boolean {
    this.focusArea = 'rail';
    this.activeContent()?.takeFocus('front');
    return true;
  }

  private onRailEvent(ev: KeyEvent): EventResult {
    const items = this.spec.items;
    const rowCount = this.bodyRows(this.size);
    let next = this.active;

    switch (ev.name) {
      case 'up':
        next = moveCursorBy(this.active, items.length, -1);
        break;
      case 'down':
        next = moveCursorBy(this.active, items.length, 1);
        break;
      case 'pageup':
        next = moveCursorByPage(this.active, items.length, rowCount, -1);
        break;
      case 'pagedown':
        next = moveCursorByPage(this.active, items.length, rowCount, 1);
        break;
      case 'home':
        next = moveCursorToEdge(items.length, 'start');
        break;
      case 'end':
        next = moveCursorToEdge(items.length, 'end');
        break;
      case 'enter':
      case 'space':
      case 'right':
        this.focusArea = 'detail';
        this.activeContent()?.takeFocus('front');
        this.log('detail-focus', { via: ev.name, activeId: this.activeItem?.id ?? null, activeIndex: this.active });
        return Consumed();
      default:
        return Ignored;
    }

    this.setActive(next);
    return Consumed();
  }

  private onRailMouse(ev: MouseEvent, bodyY: number, bodyHeight: number): EventResult {
    // Sidebar rail reorder is a capture primitive. It intentionally
    // resolves selection-vs-reorder at drag-end instead of treating
    // every pointer event as a chooser-style intent.
    this.lastMouseArea = 'rail';
    if (this.spec.items.length === 0) return Ignored;
    const railTitleH = this.railTitleHeight();
    if (bodyY < railTitleH) {
      this.focusArea = 'rail';
      return Consumed();
    }
    const index = this.scroll + (bodyY - railTitleH);
    if (index < 0 || index >= this.spec.items.length) return Ignored;
    this.focusArea = 'rail';
    if (isPrimaryClickMouseEventType(ev.type)) {
      this.dragSourceIdx = index;
      this.dragHoverIdx = index;
      this.dragDidMove = false;
    }
    if (this.dragSourceIdx !== null && isCaptureMoveMouseEventType(ev.type)) {
      this.dragDidMove = true;
      this.dragHoverIdx = this.clampIndex(index);
      this.ensureActiveVisible(bodyHeight);
      return Consumed();
    }
    if (this.dragSourceIdx !== null && isCaptureEndMouseEventType(ev.type)) {
      const from = this.dragSourceIdx;
      const to = this.dragHoverIdx ?? from;
      const moved = this.dragDidMove;
      const item = this.spec.items[from];
      this.dragSourceIdx = null;
      this.dragHoverIdx = null;
      this.dragDidMove = false;
      if (moved && from !== to && item) {
        this.spec.onReorderItem?.(from, to, item);
        this.setActive(to);
      }
      this.ensureActiveVisible(bodyHeight);
      return Consumed();
    }
    this.setActive(index);
    this.log('rail-mouse', { type: ev.type, index, id: this.activeItem?.id ?? null });
    if (isClickIntentMouseEventType(ev.type) && !isPrimaryClickMouseEventType(ev.type)) {
      this.focusArea = 'detail';
      this.activeContent()?.takeFocus('front');
      this.log('detail-focus', { via: 'double-click', activeId: this.activeItem?.id ?? null, activeIndex: this.active });
      const active = this.activeItem;
      if (active) this.spec.onActivateItem?.(active, this.active, 'double-click');
    }
    if (ev.type === 'scroll-up') {
      this.setActive(moveCursorBy(this.active, this.spec.items.length, -1));
    } else if (ev.type === 'scroll-down') {
      this.setActive(moveCursorBy(this.active, this.spec.items.length, 1));
    }
    this.ensureActiveVisible(bodyHeight);
    return Consumed();
  }

  private onDetailMouse(ev: MouseEvent, layout: ReturnType<typeof SidebarTabSurface.prototype.computeLayout>): EventResult {
    this.lastMouseArea = 'detail';
    const content = this.activeContent();
    if (!content) return Ignored;
    const wasFocusArea = this.focusArea;
    this.focusArea = 'detail';
    if (!content.onMouse) {
      return wasFocusArea === 'detail' ? Ignored : Consumed();
    }
    return content.onMouse({
      ...ev,
      x: ev.x - layout.detailX,
      y: ev.y - layout.bodyY,
    });
  }

  private drawTitle(p: Printer): void {
    const active = this.activeItem;
    const baseTitle = p.width < 40 ? (this.spec.compactTitle ?? this.spec.title ?? 'Sidebar tabs') : (this.spec.title ?? 'Sidebar tabs');
    const activeBadge = active ? this.resolveItemBadge(active) : null;
    const activeDescription = active ? this.resolveItemDescription(active) : '';
    const badgeLabel = activeBadge ? truncateLabel(activeBadge.label, this.spec.badgeMaxWidth ?? 6) : '';
    const prefix = active ? `${baseTitle} · ${active.label}` : baseTitle;
    p.text(0, 0, C.bold(prefix));
    let cursorX = cellWidth(prefix);
    if (active && activeDescription && p.width >= 56) {
      const descText = truncateLabel(activeDescription, Math.max(8, p.width - cursorX - cellWidth(badgeLabel) - 6));
      p.text(cursorX, 0, C.muted(' · '));
      cursorX += 3;
      p.text(cursorX, 0, C.muted(descText));
      cursorX += cellWidth(descText);
    }
    if (active && badgeLabel) {
      p.text(cursorX, 0, C.muted(' · '));
      p.text(cursorX + 3, 0, renderSidebarShellBadge({
        label: badgeLabel,
        tone: activeBadge?.tone,
      }, p.focused && this.focusArea === 'rail', true));
    }
  }

  private drawFooter(p: Printer): void {
    const hint = this.resolveFooterHint(p.width);
    if (!hint) return;
    p.text(0, 0, C.muted(hint));
  }

  private drawBody(p: Printer): void {
    const railWidth = this.resolveRailWidth(p.width);
    const detailX = Math.min(p.width, railWidth + 1);
    const detailWidth = Math.max(0, p.width - detailX);
    const rail = p.sub(0, 0, railWidth, p.height, { focused: p.focused && this.focusArea === 'rail' });
    const detail = p.sub(detailX, 0, detailWidth, p.height, { focused: p.focused && this.focusArea === 'detail' });
    this.drawRail(rail);
    if (railWidth < p.width) {
      for (let y = 0; y < p.height; y++) p.char(railWidth, y, '│', C.border('│'));
    }
    this.drawDetail(detail);
  }

  private drawRail(p: Printer): void {
    const items = this.spec.items;
    if (items.length === 0) {
      p.text(0, 0, C.muted(this.spec.emptyState ?? '(no sidebar items)'));
      return;
    }
    const railTitleH = this.railTitleHeight();
    if (railTitleH > 0) p.text(0, 0, C.bold(C.muted(this.spec.railTitle ?? 'Tabs')));
    const availableRows = Math.max(0, p.height - railTitleH);
    this.ensureActiveVisible(availableRows);
    const end = Math.min(items.length, this.scroll + availableRows);
    for (let row = this.scroll; row < end; row++) {
      const item = items[row]!;
      const y = railTitleH + (row - this.scroll);
      const isActive = row === this.active;
      const isDragSource = row === this.dragSourceIdx;
      const isDragHover = this.dragSourceIdx !== null && row === this.dragHoverIdx && row !== this.dragSourceIdx;
      p.text(
        0,
        y,
        this.formatRailRow(item, p.width, isActive, p.focused && this.focusArea === 'rail', isDragSource, isDragHover),
      );
    }
  }

  private drawDetail(p: Printer): void {
    const content = this.activeContent();
    if (!content) {
      p.text(0, 0, C.muted(this.spec.emptyState ?? '(no sidebar items)'));
      return;
    }
    content.layout({ width: p.width, height: p.height });
    content.draw(p);
  }

  private formatRailRow(
    item: SidebarTabItem,
    width: number,
    isActive: boolean,
    focused: boolean,
    isDragSource: boolean,
    isDragHover: boolean,
  ): string {
    const marker = isDragHover ? '▶' : (isActive ? '●' : '○');
    const resolvedBadge = this.resolveItemBadge(item);
    const renderedBadge = resolvedBadge ? truncateLabel(resolvedBadge.label, this.spec.badgeMaxWidth ?? 6) : '';
    const badgeText = renderedBadge ? ` ${renderedBadge}` : '';
    const maxLabel = Math.max(1, width - cellWidth(marker) - cellWidth(badgeText) - 2);
    const label = truncateLabel(item.label, maxLabel);
    const pad = Math.max(0, width - cellWidth(marker) - 1 - cellWidth(label) - cellWidth(badgeText));
    const baseLine = `${marker} ${label}${' '.repeat(pad)}`;
    const badgePart = renderedBadge
      ? ` ${renderSidebarShellBadge({ label: renderedBadge, tone: resolvedBadge?.tone }, focused, isActive)}`
      : '';
    let line = `${renderSidebarShellRailRow(baseLine, isActive, focused)}${badgePart}`;
    if (isDragHover) line = C.accent(line);
    if (isDragSource) line = C.dim(line);
    return line;
  }

  private resolveItemBadge(item: SidebarTabItem): { label: string; tone?: SidebarShellBadgeTone } | null {
    const presentation = item.presentation?.();
    const label = presentation?.badge ?? item.badge;
    if (!label) return null;
    return {
      label,
      tone: presentation?.badgeTone ?? item.badgeTone,
    };
  }

  private resolveItemDescription(item: SidebarTabItem): string {
    const presentation = item.presentation?.();
    return presentation?.description ?? item.description ?? '';
  }

  private activeContent(): View | null {
    const item = this.activeItem;
    if (!item) return null;
    const cached = this.viewCache.get(item.id);
    if (cached) return cached;
    const view = typeof item.content === 'function' ? item.content() : item.content;
    this.viewCache.set(item.id, view);
    return view;
  }

  private setActive(index: number): void {
    const next = this.clampIndex(index);
    if (next === this.active) {
      this.ensureActiveVisible(this.bodyRows(this.size));
      return;
    }
    const prev = this.activeItem;
    this.active = next;
    this.ensureActiveVisible(this.bodyRows(this.size));
    const active = this.activeItem;
    this.log('select', {
      prevIndex: prev ? this.spec.items.findIndex((item) => item.id === prev.id) : null,
      prevId: prev?.id ?? null,
      nextIndex: this.active,
      nextId: active?.id ?? null,
      focusArea: this.focusArea,
    });
    if (active) this.spec.onChange?.(active, this.active);
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!debug.enabled || !this.spec.debugCategory) return;
    debug.log(this.spec.debugCategory, event, data);
  }

  private clampIndex(index: number): number {
    if (this.spec.items.length === 0) return 0;
    return Math.max(0, Math.min(this.spec.items.length - 1, index));
  }

  private ensureActiveVisible(bodyRows: number): void {
    const availableRows = Math.max(1, bodyRows - this.railTitleHeight());
    if (this.active < this.scroll) this.scroll = this.active;
    if (this.active >= this.scroll + availableRows) this.scroll = this.active - availableRows + 1;
    const maxScroll = Math.max(0, this.spec.items.length - availableRows);
    this.scroll = Math.max(0, Math.min(maxScroll, this.scroll));
  }

  private computeLayout(size: Size) {
    const titleH = this.titleHeight();
    const footerH = this.footerHeight();
    const railWidth = this.resolveRailWidth(size.width);
    return {
      bodyY: titleH,
      bodyHeight: Math.max(0, size.height - titleH - footerH),
      railWidth,
      detailX: Math.min(size.width, railWidth + 1),
      detailWidth: Math.max(0, size.width - railWidth - 1),
    };
  }

  private resolveRailWidth(totalWidth: number): number {
    if (totalWidth <= 0) return 0;
    if (this.spec.railWidth !== undefined) return Math.max(8, Math.min(totalWidth - 1, this.spec.railWidth));
    const minRail = this.spec.minRailWidth ?? 18;
    const maxRail = this.spec.maxRailWidth ?? 26;
    const contentWidth = Math.max(
      this.spec.railTitle ? cellWidth(this.spec.railTitle) + 2 : 0,
      ...this.spec.items.map((item) => cellWidth(item.label) + (item.badge ? cellWidth(item.badge) + 4 : 2)),
    );
    const resolved = Math.max(minRail, Math.min(maxRail, contentWidth));
    return Math.max(8, Math.min(Math.max(8, totalWidth - 1), resolved));
  }

  private titleHeight(): number {
    return this.spec.title ? 1 : 0;
  }

  private footerHeight(): number {
    return this.spec.footerHint || this.spec.items.length > 0 ? 1 : 0;
  }

  private railTitleHeight(): number {
    return this.spec.railTitle ? 1 : 0;
  }

  private bodyRows(size: Size): number {
    return Math.max(0, size.height - this.titleHeight() - this.footerHeight());
  }

  private defaultFooterHint(): string {
    if (this.spec.items.length === 0) return '';
    return this.focusArea === 'rail'
      ? '↑↓ move · Enter detail · Tab switch focus'
      : 'Tab rail · Esc rail · active detail owns other keys';
  }

  private resolveFooterHint(width: number): string {
    if (width < 52) {
      if (this.spec.compactFooterHint) return this.spec.compactFooterHint;
      if (this.spec.items.length === 0) return '';
      if (this.dragSourceIdx !== null) return 'drag rail · drop reorder';
      return this.focusArea === 'rail'
        ? '↑↓ move · ↵ detail · Tab swap'
        : 'Tab rail · Esc rail · detail keys';
    }
    if (this.dragSourceIdx !== null) return 'drag rail row · drop to reorder · Tab focus swap';
    return this.spec.footerHint ?? this.defaultFooterHint();
  }
}

function truncateLabel(input: string, maxWidth: number): string {
  if (cellWidth(input) <= maxWidth) return input;
  if (maxWidth <= 1) return '…';
  let out = '';
  for (const ch of input) {
    if (cellWidth(out) + cellWidth(ch) >= maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}
