import { SYNC_MODES } from '../../../plugins/sync/types.js';
import { computePromptFrameGridHeight } from '../../display/prompt-frame-layout.js';
import type { PromptFrame } from '../../display/prompt-frame.js';
import { C } from '../../tui.js';
import type { DashboardViewDef } from '../../views/config.js';
import type { WorkingDirView } from '../../workspace-types.js';

export interface DashboardRenderSnapshot {
  renderChatOnly: boolean;
  logEmbedded: boolean;
  paneHeight: number;
  gridLayoutHeight: number;
}

export interface BuildDashboardRenderSnapshotOptions {
  termRows: number;
  hasPluginLayout: boolean;
  workingDirView: WorkingDirView;
  chatOnlyMode: boolean;
  paneHeight: number;
  promptFrame: PromptFrame;
}

export interface BuildDashboardFooterHintOptions {
  renderChatOnly: boolean;
  browseMode: boolean;
  baseView: WorkingDirView;
  viewHint: string;
  syncSelectionCounts?: {
    skills: number;
    servers: number;
    services: number;
  };
  syncModeId?: string;
}

export interface BuildDashboardViewHintOptions {
  views: readonly Pick<DashboardViewDef, 'id' | 'shortcut'>[];
  activeViewId: string;
}

export interface ResolveDashboardFocusedInstanceIdOptions {
  renderChatOnly: boolean;
  hasPluginLayout: boolean;
  pluginFocusedInstanceId: string | null;
  workingFocusedInstanceId: string | null;
}

export interface DashboardLogSearchCursorState {
  current: number;
  total: number;
}

export interface DashboardLogProjection {
  effectiveFreeze: number | null;
  searchCursorState: DashboardLogSearchCursorState | null;
}

export function shouldEmbedDashboardLog(
  hasPluginLayout: boolean,
  workingDirView: WorkingDirView,
): boolean {
  return !hasPluginLayout && (
    workingDirView === 1
    || workingDirView === 2
    || workingDirView === 3
    || workingDirView === 4
  );
}

export function buildDashboardRenderSnapshot(
  opts: BuildDashboardRenderSnapshotOptions,
): DashboardRenderSnapshot {
  const renderChatOnly = opts.chatOnlyMode;
  const logEmbedded = shouldEmbedDashboardLog(opts.hasPluginLayout, opts.workingDirView);
  const gridLayoutHeight = renderChatOnly
    ? 0
    : logEmbedded
      ? computePromptFrameGridHeight(opts.termRows, opts.promptFrame)
      : opts.paneHeight;

  return {
    renderChatOnly,
    logEmbedded,
    paneHeight: opts.paneHeight,
    gridLayoutHeight,
  };
}

export function buildDashboardFooterHint(
  opts: BuildDashboardFooterHintOptions,
): string {
  if (opts.renderChatOnly) {
    return `  ${C.muted('LLM chat mode')}   `
      + `${C.key('/chat')} or ${C.key('/dashboard')} to exit  `
      + `${C.key('^Y')} copy  ${C.key('^V')} paste image`;
  }

  if (opts.browseMode) {
    return opts.baseView === 4
      ? `  views ${opts.viewHint}  ${C.key('j/k')} move  ${C.key('r')} run  ${C.key('p')} pause  ${C.key('/')} chat`
      : `  views ${opts.viewHint}  `
        + `${C.key('^digit')} switch  ${C.key('/view')} config  ${C.key('^B')} chord  ${C.key('/')} chat`;
  }

  const counts = opts.syncSelectionCounts ?? { skills: 0, servers: 0, services: 0 };
  const syncMode = SYNC_MODES.find((mode) => mode.id === opts.syncModeId) ?? SYNC_MODES[0]!;
  const ops = counts.skills * counts.servers * counts.services;
  const ready = counts.skills > 0 && counts.servers > 0 && counts.services > 0;
  const isDiff = syncMode.id === 'diff';
  const enterAction = isDiff ? 'diff' : 'sync';
  const enterColor = ready ? (isDiff ? C.info : C.success) : C.muted;
  const statusLeft = `${C.text(`${counts.skills}`)} skill${counts.skills !== 1 ? 's' : ''} ${C.muted('\u2192')} `
    + `${C.text(`${counts.servers}`)} server${counts.servers !== 1 ? 's' : ''} ${C.muted('\u00D7')} `
    + `${C.text(`${counts.services}`)} service${counts.services !== 1 ? 's' : ''}`;
  const statusRight = ready ? `${C.bold(`= ${ops} ops`)}` : '';
  return `  ${statusLeft}  ${statusRight}  `
    + `${C.muted('space')} select  ${C.muted('a')} all  ${C.muted('Tab')} pane  `
    + `${C.muted('S-Tab')} mode  `
    + `${enterColor('Enter')} ${enterColor(enterAction)}`
    + `  ${C.muted('Esc')} cancel`;
}

export function buildDashboardViewHint(
  opts: BuildDashboardViewHintOptions,
): string {
  return opts.views
    .map((view) => opts.activeViewId === view.id ? C.bold(`[${view.shortcut ?? view.id}]`) : C.muted(view.shortcut ?? view.id))
    .join(' ');
}

export function resolveDashboardFocusedInstanceId(
  opts: ResolveDashboardFocusedInstanceIdOptions,
): string | null {
  if (opts.renderChatOnly) return null;
  return opts.hasPluginLayout
    ? opts.pluginFocusedInstanceId
    : opts.workingFocusedInstanceId;
}

export function buildDashboardLogProjection(opts: {
  chatScrollOffset: number;
  logFrozenTailIndex: number | null;
  logSearchCursor: number;
  logSearchResultsLength: number;
}): DashboardLogProjection {
  return {
    effectiveFreeze: opts.chatScrollOffset === -1 ? null : opts.logFrozenTailIndex,
    searchCursorState: opts.logSearchResultsLength > 0
      ? { current: opts.logSearchCursor + 1, total: opts.logSearchResultsLength }
      : null,
  };
}
