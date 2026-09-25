// ── Sync plugin — shared types + constants ──

import type { SyncMode } from '../../src/types.js';
import { C } from '../../src/tui.js';

export type SyncPane = 0 | 1 | 2;  // skills, servers, services

export interface SyncModeSpec {
  id: SyncMode | 'diff';
  label: string;
  symbol: string;
  color: (s: string) => string;
}

export const SYNC_MODES: SyncModeSpec[] = [
  { id: 'clean', label: 'Clean', symbol: '\u23F5\u23F5', color: C.error },     // ⏵⏵ destructive
  { id: 'merge', label: 'Merge', symbol: '\u23F5',       color: C.success },    // ⏵  safe
  { id: 'smart', label: 'Smart', symbol: '\u2699',       color: C.highlight },  // ⚙  auto
  { id: 'diff',  label: 'Diff',  symbol: '\u23F8',       color: C.info },       // ⏸  inspect
];
