import type { AcpSessionStub } from '../session/card.js';
import type { MessageBlock } from '../conv-substrate/message-block.js';
import { TextArea } from '../ui/widgets/text-area.js';
import { buildSidebarShellDetailText } from '../ui/chrome/sidebar-shell-detail.js';
import type { SidebarTabItem } from '../ui/widgets/sidebar-tab-surface.js';
import type { View } from '../ui/view.js';
import type { BackgroundSessionRecord } from './background-manager.js';
import { ACP_CHANNEL_BROWSER_COPY } from './channel-browser-copy.js';
import type { PersistedAcpSession } from './session-persistence.js';

export interface AcpChannelBrowserCatalogDeps {
  status(id: string): BackgroundSessionRecord | null;
  getBlocks?(id: string): readonly MessageBlock[];
  loadPersisted?(id: string): PersistedAcpSession | null;
  actionStatus?(id: string): string | null;
}

export interface AcpChannelPrimaryAction {
  id:
    | 'open-live-client-room'
    | 'open-live-server-room'
    | 'promote-background-vw'
    | 'join-background-transcript'
    | 'resume-persisted-session'
    | 'inspect-acp-lane';
  label: string;
}

export interface AcpChannelBrowserSnapshot {
  laneType: string;
  summaryBody: string;
  notesBody: string;
  actionsBody: string;
  excerpt: string;
}

export function buildAcpChannelSidebarItems(
  stubs: readonly AcpSessionStub[],
  deps: AcpChannelBrowserCatalogDeps,
  opts: { preserveOrder?: boolean } = {},
): SidebarTabItem[] {
  const ordered = opts.preserveOrder ? [...stubs] : sortAcpChannelStubs(stubs);
  return ordered.map((stub) => ({
    id: stub.id,
    label: stub.title,
    badge: badgeForStub(stub),
    badgeTone: badgeToneForStub(stub),
    description: descriptionForStub(stub),
    presentation: () => buildStubPresentation(
      stub,
      deps.actionStatus?.(stub.id) ?? null,
      deps.getBlocks?.(stub.id) ?? [],
      deps.loadPersisted?.(stub.id) ?? null,
    ),
    content: buildStubDetailView(stub, deps),
  }));
}

export function sortAcpChannelStubs(
  stubs: readonly AcpSessionStub[],
): AcpSessionStub[] {
  return [...stubs].sort((a, b) => {
    const aRank = sortRankForStub(a);
    const bRank = sortRankForStub(b);
    if (aRank !== bRank) return aRank - bRank;
    const aTs = a.lastActivityAt ?? a.createdAt ?? 0;
    const bTs = b.lastActivityAt ?? b.createdAt ?? 0;
    if (aTs !== bTs) return bTs - aTs;
    return a.title.localeCompare(b.title);
  });
}

export function badgeForStub(stub: AcpSessionStub): string | undefined {
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-bg') {
    const state = String(stub.meta?.['state'] ?? '');
    switch (state) {
      case 'running': return 'live';
      case 'waiting_for_confirmation': return 'wait';
      case 'completed': return 'done';
      case 'failed': return 'err';
      case 'cancelled': return 'stop';
      default: return 'bg';
    }
  }
  if (ns === 'acp-cli') return 'live';
  if (ns === 'acp-srv') return 'srv';
  return undefined;
}

export function badgeToneForStub(stub: AcpSessionStub):
  | 'live'
  | 'wait'
  | 'done'
  | 'err'
  | 'stop'
  | 'srv'
  | 'muted'
  | undefined {
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-bg') {
    const state = String(stub.meta?.['state'] ?? '');
    switch (state) {
      case 'running': return 'live';
      case 'waiting_for_confirmation': return 'wait';
      case 'completed': return 'done';
      case 'failed': return 'err';
      case 'cancelled': return 'stop';
      default: return 'muted';
    }
  }
  if (ns === 'acp-cli') return 'live';
  if (ns === 'acp-srv') return 'srv';
  return 'muted';
}

export function descriptionForStub(stub: AcpSessionStub): string {
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-hist') {
    const backend = String(stub.meta?.['backendId'] ?? 'unknown');
    const rel = relativeHistoryAge(stub.lastActivityAt ?? stub.createdAt ?? 0);
    return rel ? `History · ${backend} · ${rel}` : `History · ${backend}`;
  }
  if (ns === 'acp-bg') {
    const backend = String(stub.meta?.['backendId'] ?? 'unknown');
    const state = String(stub.meta?.['state'] ?? 'unknown');
    switch (state) {
      case 'running': return `Running · ${backend}`;
      case 'waiting_for_confirmation': return `Waiting · ${backend}`;
      case 'completed': return `Done · ${backend}`;
      case 'failed': return `Error · ${backend}`;
      case 'cancelled': return `Stopped · ${backend}`;
      default: return `Background · ${backend}`;
    }
  }
  if (ns === 'acp-cli') {
    const backend = String(stub.meta?.['backendId'] ?? 'unknown');
    const hops = String(stub.meta?.['activeHops'] ?? 0);
    return `Client · ${backend} · hops ${hops}`;
  }
  if (ns === 'acp-srv') return 'Server · live';
  return 'ACP session';
}

export function buildStubDetailView(
  stub: AcpSessionStub,
  deps: AcpChannelBrowserCatalogDeps,
): View {
  const bgRecord = String(stub.meta?.['namespace'] ?? '') === 'acp-bg'
    ? deps.status(stub.id)
    : null;
  const persisted = deps.loadPersisted?.(stub.id) ?? null;
  return new TextArea({
    text: buildStubDetailText(stub, bgRecord, deps, persisted),
    readOnly: true,
    wrap: true,
  });
}

export function buildStubDetailText(
  stub: AcpSessionStub,
  bgRecord: BackgroundSessionRecord | null,
  deps?: AcpChannelBrowserCatalogDeps,
  persisted?: PersistedAcpSession | null,
): string {
  const snapshot = buildStubSnapshot(stub, bgRecord, deps, persisted);
  const primaryAction = resolvePrimaryActionForStub(stub, bgRecord, persisted);
  return buildSidebarShellDetailText({
    title: stub.title,
    subtitle: descriptionForStub(stub),
    fields: [
      { label: ACP_CHANNEL_BROWSER_COPY.fields.laneType, value: snapshot.laneType },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.primaryAction, value: primaryAction.label },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.actionStatus, value: deps?.actionStatus?.(stub.id) ?? null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.alive, value: stub.isAlive ? 'yes' : 'no' },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.created, value: stub.createdAt ? new Date(stub.createdAt).toISOString() : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.lastActivity, value: stub.lastActivityAt ? new Date(stub.lastActivityAt).toISOString() : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.historyRecency, value: persisted ? relativeHistoryAge(stub.lastActivityAt ?? stub.createdAt ?? 0) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.backend, value: stub.meta?.['backendId'] ? String(stub.meta['backendId']) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.backendSession, value: stub.meta?.['backendSessionId'] ? String(stub.meta['backendSessionId']) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.workspace, value: persisted?.cwd ? historyLeaf(persisted.cwd) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.activeHops, value: stub.meta?.['activeHops'] !== undefined ? String(stub.meta['activeHops']) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.state, value: stub.meta?.['state'] ? String(stub.meta['state']) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.origin, value: stub.meta?.['origin'] ? String(stub.meta['origin']) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.stopReason, value: bgRecord?.stopReason ? String(bgRecord.stopReason) : null },
      { label: ACP_CHANNEL_BROWSER_COPY.fields.error, value: bgRecord?.error ?? null },
    ],
    sections: [
      {
        title: ACP_CHANNEL_BROWSER_COPY.summarySectionTitle,
        body: snapshot.summaryBody,
      },
      {
        title: ACP_CHANNEL_BROWSER_COPY.actionsSectionTitle,
        body: snapshot.actionsBody,
      },
      {
        title: ACP_CHANNEL_BROWSER_COPY.outputSectionTitle,
        body: snapshot.excerpt,
      },
      {
        title: ACP_CHANNEL_BROWSER_COPY.notesSectionTitle,
        body: snapshot.notesBody,
      },
    ],
  });
}

export function buildStubSnapshot(
  stub: AcpSessionStub,
  bgRecord: BackgroundSessionRecord | null,
  deps?: AcpChannelBrowserCatalogDeps,
  persisted: PersistedAcpSession | null = null,
): AcpChannelBrowserSnapshot {
  const summary = buildStubSummary(stub, bgRecord, persisted);
  const excerpt = buildStubExcerpt(stub, bgRecord, deps, persisted);
  return {
    laneType: summary.laneType,
    summaryBody: summary.summaryBody,
    notesBody: summary.notesBody,
    actionsBody: summary.actionsBody,
    excerpt,
  };
}

function sortRankForStub(stub: AcpSessionStub): number {
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-cli') return 0;
  if (ns === 'acp-srv') return 1;
  if (ns === 'acp-bg') {
    const state = String(stub.meta?.['state'] ?? '');
    switch (state) {
      case 'running': return 2;
      case 'waiting_for_confirmation': return 3;
      case 'failed': return 4;
      case 'completed': return 5;
      case 'cancelled': return 6;
      default: return 7;
    }
  }
  if (ns === 'acp-hist') return 8;
  return 9;
}

function buildStubSummary(
  stub: AcpSessionStub,
  bgRecord: BackgroundSessionRecord | null,
  persisted: PersistedAcpSession | null = null,
): {
  laneType: string;
  summaryBody: string;
  notesBody: string;
  actionsBody: string;
} {
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-hist') {
    return {
      laneType: 'History',
      summaryBody: [
        `${ACP_CHANNEL_BROWSER_COPY.fields.title}: ${stub.title}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.backend}: ${String(stub.meta?.['backendId'] ?? 'unknown')}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.historyTurns}: ${String(persisted?.history.length ?? 0)}`,
      ].join('\n'),
      notesBody: ACP_CHANNEL_BROWSER_COPY.historyNotes,
      actionsBody: ACP_CHANNEL_BROWSER_COPY.actionHints.history,
    };
  }
  if (ns === 'acp-bg') {
    const backend = String(stub.meta?.['backendId'] ?? 'unknown');
    const state = String(stub.meta?.['state'] ?? 'unknown');
    return {
      laneType: 'Background',
      summaryBody: [
        `${ACP_CHANNEL_BROWSER_COPY.fields.title}: ${stub.title}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.backend}: ${backend}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.state}: ${state}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.preview}: ${bgRecord?.outputPreview ? 'available' : 'pending'}`,
      ].join('\n'),
      notesBody: ACP_CHANNEL_BROWSER_COPY.backgroundNotes,
      actionsBody:
        state === 'waiting_for_confirmation'
          ? ACP_CHANNEL_BROWSER_COPY.actionHints.backgroundWaiting
          : (state === 'running'
              ? ACP_CHANNEL_BROWSER_COPY.actionHints.backgroundRunning
              : ACP_CHANNEL_BROWSER_COPY.actionHints.backgroundTerminal),
    };
  }
  if (ns === 'acp-cli') {
    const backend = String(stub.meta?.['backendId'] ?? 'unknown');
    return {
      laneType: 'Live client',
      summaryBody: [
        `${ACP_CHANNEL_BROWSER_COPY.fields.title}: ${stub.title}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.backend}: ${backend}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.activeHops}: ${String(stub.meta?.['activeHops'] ?? 0)}`,
      ].join('\n'),
      notesBody: ACP_CHANNEL_BROWSER_COPY.liveClientNotes,
      actionsBody: ACP_CHANNEL_BROWSER_COPY.actionHints.liveClient,
    };
  }
  if (ns === 'acp-srv') {
    return {
      laneType: 'Live server',
      summaryBody: [
        `${ACP_CHANNEL_BROWSER_COPY.fields.title}: ${stub.title}`,
        `${ACP_CHANNEL_BROWSER_COPY.fields.backendSession}: ${String(stub.meta?.['backendSessionId'] ?? 'unknown')}`,
      ].join('\n'),
      notesBody: ACP_CHANNEL_BROWSER_COPY.liveServerNotes,
      actionsBody: ACP_CHANNEL_BROWSER_COPY.actionHints.liveServer,
    };
  }
  return {
    laneType: 'ACP session',
    summaryBody: `${ACP_CHANNEL_BROWSER_COPY.fields.title}: ${stub.title}`,
    notesBody: ACP_CHANNEL_BROWSER_COPY.noSessionNotes,
    actionsBody: ACP_CHANNEL_BROWSER_COPY.actionHints.generic,
  };
}

function actionPresentationForStatus(
  status: string | null,
): Partial<Pick<SidebarTabItem, 'badge' | 'badgeTone'>> {
  if (!status) return {};
  if (status.startsWith('Running')) {
    return { badge: 'act', badgeTone: 'wait' };
  }
  if (status.startsWith('Error')) {
    return { badge: 'err', badgeTone: 'err' };
  }
  return { badge: 'done', badgeTone: 'done' };
}

function buildStubPresentation(
  stub: AcpSessionStub,
  status: string | null,
  blocks: readonly MessageBlock[],
  persisted: PersistedAcpSession | null,
): Partial<Pick<SidebarTabItem, 'badge' | 'badgeTone' | 'description'>> {
  const action = actionPresentationForStatus(status);
  if (action.badge || action.badgeTone) return action;
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-hist') {
    const turnCount = persisted?.history.length ?? 0;
    if (turnCount > 0) {
      return {
        badge: String(Math.min(turnCount, 99)),
        badgeTone: 'count',
        description: [
          `History · ${String(stub.meta?.['backendId'] ?? 'unknown')}`,
          `${turnCount} turns`,
          relativeHistoryAge(stub.lastActivityAt ?? stub.createdAt ?? 0),
        ].filter(Boolean).join(' · '),
      };
    }
    return {};
  }
  if (ns === 'acp-cli' || ns === 'acp-srv') {
    const latestKind = latestAttentionKind(blocks);
    if (latestKind === 'error') {
      return { badge: 'err', badgeTone: 'err', description: `${descriptionForStub(stub)} · error` };
    }
    if (latestKind === 'tool-call') {
      return { badge: 'tool', badgeTone: 'new', description: `${descriptionForStub(stub)} · tool` };
    }
    if (latestKind === 'plan') {
      return { badge: 'plan', badgeTone: 'new', description: `${descriptionForStub(stub)} · plan` };
    }
    if (latestKind === 'status') {
      return { badge: 'note', badgeTone: 'wait', description: `${descriptionForStub(stub)} · status` };
    }
  }
  return {};
}

function latestAttentionKind(
  blocks: readonly MessageBlock[],
): MessageBlock['body']['kind'] | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const kind = blocks[i]?.body.kind;
    if (kind === 'error' || kind === 'tool-call' || kind === 'plan' || kind === 'status') {
      return kind;
    }
  }
  return null;
}

function historyLeaf(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : cwd || 'session';
}

export function relativeHistoryAge(ts: number, now = Date.now()): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const delta = Math.max(0, now - ts);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function resolvePrimaryActionForStub(
  stub: AcpSessionStub,
  bgRecord: BackgroundSessionRecord | null = null,
  persisted: PersistedAcpSession | null = null,
): AcpChannelPrimaryAction {
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-hist') {
    return {
      id: 'resume-persisted-session',
      label: ACP_CHANNEL_BROWSER_COPY.primaryActionLabels.history,
    };
  }
  if (ns === 'acp-bg') {
    const state = String(stub.meta?.['state'] ?? bgRecord?.state ?? 'unknown');
    if (state === 'running' || state === 'waiting_for_confirmation') {
      return {
        id: 'promote-background-vw',
        label: ACP_CHANNEL_BROWSER_COPY.primaryActionLabels.backgroundLive,
      };
    }
    return {
      id: 'join-background-transcript',
      label: ACP_CHANNEL_BROWSER_COPY.primaryActionLabels.backgroundTerminal,
    };
  }
  if (ns === 'acp-cli') {
    return {
      id: 'open-live-client-room',
      label: ACP_CHANNEL_BROWSER_COPY.primaryActionLabels.liveClient,
    };
  }
  if (ns === 'acp-srv') {
    return {
      id: 'open-live-server-room',
      label: ACP_CHANNEL_BROWSER_COPY.primaryActionLabels.liveServer,
    };
  }
  return {
    id: 'inspect-acp-lane',
    label: ACP_CHANNEL_BROWSER_COPY.primaryActionLabels.generic,
  };
}

function buildStubExcerpt(
  stub: AcpSessionStub,
  bgRecord: BackgroundSessionRecord | null,
  deps?: AcpChannelBrowserCatalogDeps,
  persisted: PersistedAcpSession | null = null,
): string {
  const ns = String(stub.meta?.['namespace'] ?? '');
  if (ns === 'acp-hist') {
    return buildPersistedExcerpt(persisted) || ACP_CHANNEL_BROWSER_COPY.noPersistedExcerpt;
  }
  if (ns === 'acp-bg') {
    return formatExcerptText(
      bgRecord?.outputPreview || ACP_CHANNEL_BROWSER_COPY.noBackgroundPreview,
      'bg',
    );
  }
  if (ns === 'acp-cli') {
    return buildLiveExcerpt(stub.id, deps?.getBlocks, ACP_CHANNEL_BROWSER_COPY.noLiveClientExcerpt);
  }
  if (ns === 'acp-srv') {
    return buildLiveExcerpt(stub.id, deps?.getBlocks, ACP_CHANNEL_BROWSER_COPY.noLiveServerExcerpt);
  }
  return ACP_CHANNEL_BROWSER_COPY.noSessionNotes;
}

function formatExcerptText(text: string, prefix?: string): string {
  const lines = text.split(/\r?\n/);
  const trimmed = lines
    .slice(0, 6)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => prefix ? `${prefix}> ${line}` : line);
  return trimmed.join('\n');
}

function buildLiveExcerpt(
  sessionId: string,
  getBlocks: ((id: string) => readonly MessageBlock[]) | undefined,
  fallback: string,
): string {
  if (!getBlocks) return fallback;
  const blocks = getBlocks(sessionId);
  if (!blocks.length) return fallback;
  const picked: string[] = [];
  for (let i = blocks.length - 1; i >= 0 && picked.length < 4; i--) {
    const body = blocks[i]?.body;
    if (!body) continue;
    switch (body.kind) {
      case 'assistant':
        if (body.text.trim().length > 0) picked.push(`assistant> ${body.text.trim()}`);
        break;
      case 'thought':
        if (body.text.trim().length > 0) picked.push(`thought> ${body.text.trim()}`);
        break;
      case 'user':
        if (body.text.trim().length > 0) picked.push(`user> ${body.text.trim()}`);
        break;
      case 'status':
        if (body.text.trim().length > 0) picked.push(`status> ${body.text.trim()}`);
        break;
      case 'error':
        if (body.text.trim().length > 0) picked.push(`error> ${body.text.trim()}`);
        break;
      case 'tool-call':
        picked.push(`[tool] ${body.title}${body.status ? ` · ${body.status}` : ''}`);
        break;
      case 'plan':
        picked.push(`[plan] ${body.ref}`);
        break;
    }
  }
  if (!picked.length) return fallback;
  return formatExcerptText(picked.reverse().join('\n\n'));
}

function buildPersistedExcerpt(
  persisted: PersistedAcpSession | null,
): string {
  if (!persisted) return '';
  const parts: string[] = [];
  for (const block of persisted.history) {
    if (typeof block !== 'object' || !block) continue;
    const raw = block as Record<string, unknown>;
    if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.trim().length > 0) {
      parts.push(`saved> ${raw.text.trim()}`);
    }
  }
  if (!parts.length) return '';
  return formatExcerptText(parts.slice(-4).join('\n\n'));
}
