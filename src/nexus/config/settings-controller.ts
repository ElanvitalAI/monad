// NEXUS · TUI settings tab (Phase N-3 cleanup PR α')
//
// SettingsTabController — data model for the settings tab. The class is
// pure (no rendering · no I/O timers): it pulls SwitchRegistry rows +
// UserConfig values on demand, tracks a selection / edit mode, and
// dispatches PUT-equivalent calls through `applySwitchChange`.
//
// The real TUI render loop lands in N-2 cleanup PR.+ — at that point
// `createSettingsTabView()` below is wired into the SidebarTabSurface
// detail panel. Until then the controller is exercised by tests +
// (future) the PWA mirror.

import { listSwitches } from '../config/switch-registry.js';
import { readUserConfig, readSwitchValue } from '../config/user-config.js';
import { isSecretRef, type SwitchSpec, type UserConfig } from '../config/types.js';
import { applySwitchChange, type ApplySwitchResult } from '../config/apply.js';
import type { NexusState } from '../state/state.js';
import type { TabRegistry } from '../state/tab-registry.js';
import type { Supervisor } from '../supervisor/index.js';

export interface SettingsRow {
  /** Literal switch id (tab-scope switches expanded to `tabs.<tabId>.<tail>`). */
  id: string;
  scope: SwitchSpec['scope'];
  kind: SwitchSpec['kind'];
  label: string;
  description: string;
  default: unknown;
  hotApplicable: boolean;
  redactInLogs: boolean;
  envName?: string;
  legacyEnvName?: string;
  /** Currently stored value · redacted for secret-ref / redactInLogs. */
  value: unknown;
  /** Tab kind grouping (`global` for non-tab-scope rows). */
  group: string;
}

export interface SettingsTabSnapshot {
  rows: SettingsRow[];
  selectedIndex: number;
  /** When non-null, the controller is in edit mode for this row. */
  editingId: string | null;
  /** User-typed input buffer while editing. */
  editingBuffer: string;
  /** Last apply result surfaced for the currently selected row. */
  lastResult: ApplySwitchResult | null;
}

export interface SettingsTabControllerOpts {
  state: NexusState;
  registry: TabRegistry;
  supervisor?: Supervisor;
  /** Default true. Pass false when tests want to control row order. */
  sortByGroup?: boolean;
  /** Optional hot-apply hook forwarded to applySwitchChange. */
  hotApplyHandler?: (switchId: string, value: unknown) => void;
}

export class SettingsTabController {
  private opts: SettingsTabControllerOpts;
  private rowsCache: SettingsRow[] = [];
  private selectedIndex = 0;
  private editingId: string | null = null;
  private editingBuffer = '';
  private lastResult: ApplySwitchResult | null = null;

  constructor(opts: SettingsTabControllerOpts) {
    this.opts = opts;
    this.refresh();
  }

  /** Re-pull rows from SwitchRegistry + UserConfig. Called automatically
   *  by the constructor + after each successful apply. Tests call
   *  explicitly when they mutate UserConfig outside the apply path.
   *
   *  The N-3 PR μ registry stores tab-scope switches with literal tab
   *  ids baked in (e.g., `tabs.pwa-host:1.port` instead of
   *  `tabs.<id>.port`). The controller honors that model — one row per
   *  switch, regardless of how many tabs of that kind exist — so future
   *  multi-instance per kind support stays a separate concern. */
  refresh(): void {
    const cfg = readUserConfig();
    const rows: SettingsRow[] = [];
    for (const sw of listSwitches()) {
      const group = sw.scope === 'global' ? 'global' : groupFor(sw);
      rows.push(toRow(sw, sw.id, cfg, group));
    }
    if (this.opts.sortByGroup ?? true) {
      rows.sort((a, b) => {
        if (a.group !== b.group) return groupOrder(a.group) - groupOrder(b.group);
        return a.id.localeCompare(b.id);
      });
    }
    this.rowsCache = rows;
    if (this.selectedIndex >= rows.length) {
      this.selectedIndex = Math.max(0, rows.length - 1);
    }
  }

  snapshot(): SettingsTabSnapshot {
    return {
      rows: this.rowsCache,
      selectedIndex: this.selectedIndex,
      editingId: this.editingId,
      editingBuffer: this.editingBuffer,
      lastResult: this.lastResult,
    };
  }

  /** Move selection. Wraps at boundaries (i.e., DOWN at last → first). */
  moveSelection(delta: number): void {
    if (this.editingId !== null) return;
    const n = this.rowsCache.length;
    if (n === 0) return;
    this.selectedIndex = ((this.selectedIndex + delta) % n + n) % n;
  }

  /** Enter edit mode on the current selection. Pre-fills the buffer with
   *  the current value (string-coerced · redacted values yield empty). */
  beginEdit(): void {
    const row = this.rowsCache[this.selectedIndex];
    if (!row) return;
    this.editingId = row.id;
    this.editingBuffer = isRedactedDisplay(row) ? '' : stringify(row.value);
    this.lastResult = null;
  }

  /** Cancel edit without saving. */
  cancelEdit(): void {
    this.editingId = null;
    this.editingBuffer = '';
  }

  /** Append / delete keys while editing. Returns the new buffer length. */
  appendChar(ch: string): number {
    if (this.editingId === null) return this.editingBuffer.length;
    this.editingBuffer += ch;
    return this.editingBuffer.length;
  }

  backspace(): number {
    if (this.editingId === null) return 0;
    this.editingBuffer = this.editingBuffer.slice(0, -1);
    return this.editingBuffer.length;
  }

  /** Commit the edit. Coerces buffer per switch kind, calls
   *  applySwitchChange, refreshes, surfaces result. */
  async commitEdit(): Promise<ApplySwitchResult> {
    const row = this.rowsCache[this.selectedIndex];
    if (!row || this.editingId !== row.id) {
      const result: ApplySwitchResult = { outcome: 'unknown-switch' };
      this.lastResult = result;
      return result;
    }
    const coerced = coerceValue(row, this.editingBuffer);
    const result = await applySwitchChange({
      state: this.opts.state,
      registry: this.opts.registry,
      ...(this.opts.supervisor ? { supervisor: this.opts.supervisor } : {}),
      ...(this.opts.hotApplyHandler ? { hotApplyHandler: this.opts.hotApplyHandler } : {}),
      switchId: row.id,
      value: coerced,
    });
    this.lastResult = result;
    if (result.outcome !== 'invalid' && result.outcome !== 'unknown-switch') {
      this.editingId = null;
      this.editingBuffer = '';
    }
    this.refresh();
    return result;
  }
}

function groupFor(sw: SwitchSpec): string {
  if (sw.appliesTo && sw.appliesTo.length === 1) return sw.appliesTo[0]!;
  return 'tab';
}

// Surface-unification v2.2 V2.2-8 (2026-05-11) — 'scheduler' group retired.
const GROUP_ORDER = ['global', 'daemon', 'pwa-host', 'channel-bot', 'tab'];

function groupOrder(g: string): number {
  const i = GROUP_ORDER.indexOf(g);
  return i === -1 ? GROUP_ORDER.length : i;
}

function toRow(sw: SwitchSpec, literalId: string, cfg: UserConfig, group: string): SettingsRow {
  const raw = readSwitchValue(cfg, literalId);
  const redact = sw.redactInLogs || sw.kind === 'secret-ref';
  const value = redact ? redactDisplay(raw) : raw;
  const row: SettingsRow = {
    id: literalId,
    scope: sw.scope,
    kind: sw.kind,
    label: sw.label,
    description: sw.description,
    default: sw.default,
    hotApplicable: sw.hotApplicable,
    redactInLogs: !!redact,
    value,
    group,
  };
  if (sw.envName) row.envName = sw.envName;
  if (sw.legacyEnvName) row.legacyEnvName = sw.legacyEnvName;
  return row;
}

function redactDisplay(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value === '') return '';
  if (isSecretRef(value)) return '[redacted-secret-ref]';
  return '[redacted]';
}

function isRedactedDisplay(row: SettingsRow): boolean {
  return row.redactInLogs && row.value !== undefined && row.value !== '';
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function coerceValue(row: SettingsRow, buffer: string): unknown {
  switch (row.kind) {
    case 'bool': {
      const t = buffer.trim().toLowerCase();
      if (t === 'true' || t === '1' || t === 'yes' || t === 'on') return true;
      if (t === 'false' || t === '0' || t === 'no' || t === 'off' || t === '') return false;
      return buffer; // let validate reject
    }
    case 'number': {
      const t = buffer.trim();
      if (t === '') return undefined;
      const n = Number.parseFloat(t);
      if (Number.isFinite(n)) return n;
      return buffer;
    }
    case 'string':
    case 'multiline':
    case 'path':
    case 'enum':
    case 'secret-ref':
    default: {
      // empty buffer = clear (undefined). For multi-line + path keep the
      // buffer verbatim; otherwise trim outer whitespace so users can
      // copy-paste comfortably.
      if (row.kind === 'multiline') {
        return buffer === '' ? undefined : buffer;
      }
      const t = buffer.trim();
      return t === '' ? undefined : t;
    }
  }
}
