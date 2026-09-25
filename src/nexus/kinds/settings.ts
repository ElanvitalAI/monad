// NEXUS · settings kind (Phase N-3 cleanup PR α')
//
// View-only kind that surfaces the SwitchRegistry editor inside the
// nexus shell. The data + dispatch lives in `config/settings-controller.ts`
// (SettingsTabController). The kind file ships:
//
//   - createSettingsTabSpec()  — registry spec (no spawn / no health)
//   - createSettingsTabView(controller) — TextView placeholder that
//       paints a snapshot of the controller. PR.+ replaces this with
//       a fully interactive view once the TUI render loop lands.

import { TextView } from '../../ui/view.js';
import type { View } from '../../ui/view.js';
import type { TabKind, TabSpec } from './types.js';
import type { SettingsTabController, SettingsRow } from '../config/settings-controller.js';
import {
  buildQuickSetupSnapshot,
  renderQuickSetupLines,
  type QuickSetupRenderOpts,
} from '../chat/quick-setup.js';

export const SETTINGS_KIND: TabKind = 'settings';
export const SETTINGS_DEFAULT_TAB_ID = 'settings:1';

export interface SettingsTabOpts {
  id?: string;
  label?: string;
}

export function createSettingsTabSpec(opts: SettingsTabOpts = {}): TabSpec {
  return {
    id: opts.id ?? SETTINGS_DEFAULT_TAB_ID,
    kind: SETTINGS_KIND,
    label: opts.label ?? 'settings',
  };
}

/** Static snapshot view. The N-2 cleanup PR.+ TUI render loop
 *  re-mounts this with key dispatch + live refresh wired in.
 *
 *  PR g.2 — prepends the Quick Setup card so a clean-machine new
 *  user has a one-screen path to wire one of the 3 chat-compatible
 *  providers. Pass `quickSetupOpts` to inject env / token probes for
 *  tests; production omits + reads live state. */
export function createSettingsTabView(
  controller?: SettingsTabController,
  opts: { quickSetupOpts?: QuickSetupRenderOpts; suppressQuickSetup?: boolean } = {},
): View {
  return new TextView(renderSettingsLines(controller, opts));
}

export function renderSettingsLines(
  controller?: SettingsTabController,
  opts: { quickSetupOpts?: QuickSetupRenderOpts; suppressQuickSetup?: boolean } = {},
): string[] {
  if (!controller) {
    return [
      '',
      '  settings tab',
      '  ──────────────────────────────────────────────',
      '  controller not bound — wiring lands when',
      '  runNexus() injects the SettingsTabController',
      '  into createSettingsTabView() (cleanup PR.+).',
      '',
    ];
  }
  const snap = controller.snapshot();
  const lines: string[] = [];
  // PR g.2 — Quick Setup card at the top. Suppressed in test paths
  // that want to assert just the SwitchRegistry editor (set
  // `suppressQuickSetup: true`); production always renders it.
  if (!opts.suppressQuickSetup) {
    const qs = buildQuickSetupSnapshot(opts.quickSetupOpts ?? {});
    lines.push('');
    for (const l of renderQuickSetupLines(qs)) lines.push(l);
  }
  lines.push(
    '',
    '  settings · SwitchRegistry editor',
    '  ──────────────────────────────────────────────',
    '',
  );
  if (snap.rows.length === 0) {
    lines.push('  (no switches registered)');
    lines.push('');
    return lines;
  }
  let lastGroup = '';
  for (let i = 0; i < snap.rows.length; i += 1) {
    const row = snap.rows[i]!;
    if (row.group !== lastGroup) {
      if (lastGroup) lines.push('');
      lines.push(`  [${row.group}]`);
      lastGroup = row.group;
    }
    const cursor = i === snap.selectedIndex ? '▶' : ' ';
    const editing = i === snap.selectedIndex && snap.editingId === row.id;
    const valueText = editing
      ? `> ${snap.editingBuffer}_`
      : formatValue(row);
    lines.push(`  ${cursor} ${row.label.padEnd(36)} ${valueText}`);
  }
  if (snap.lastResult) {
    lines.push('');
    lines.push(`  last apply: ${snap.lastResult.outcome}${
      snap.lastResult.validationError ? ` — ${snap.lastResult.validationError}` : ''
    }`);
  }
  lines.push('');
  return lines;
}

function formatValue(row: SettingsRow): string {
  if (row.value === undefined) {
    return `(default: ${formatScalar(row.default)})`;
  }
  return formatScalar(row.value);
}

function formatScalar(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '...' : v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
