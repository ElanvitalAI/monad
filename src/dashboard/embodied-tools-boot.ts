import type { HandoffLookup } from '../agent/handoff.js';
import type { SessionLookup } from '../skills/tools/tty-snapshot.js';
import type { EmbodiedAgentSession } from '../agent/embodiment.js';
import type { AdapterHook, ChannelRouter } from '../agent/channel-router.js';

interface LiveSessionEntryLike {
  session: EmbodiedAgentSession;
}

export interface DashboardEmbodiedToolsBootDeps {
  // registerDefaultPatterns 는 full ChannelRouter 를 요구하므로 최소 구조
  // 타입으로는 배선측 실 ChannelRouter 를 수용 못한다 — 소유 타입을 그대로 쓴다.
  registerDefaultPatterns: (router: ChannelRouter) => unknown;
  router: ChannelRouter;
  codexChannelHook: () => AdapterHook;
  claudeChannelHook: () => AdapterHook;
  geminiChannelHook: () => AdapterHook;
  initTtySnapshotTools: (lookup: SessionLookup) => void;
  initAgentHandoffTool: (lookup: HandoffLookup) => void;
  findSessionById: (id: string) => LiveSessionEntryLike | null | undefined;
  findSessionByPaneId: (paneId: string) => LiveSessionEntryLike | null | undefined;
}

export function bootDashboardEmbodiedTools(
  deps: DashboardEmbodiedToolsBootDeps,
): void {
  deps.registerDefaultPatterns(deps.router);
  deps.router.registerAdapterHook('codex-pty', deps.codexChannelHook());
  deps.router.registerAdapterHook('claude-pty', deps.claudeChannelHook());
  deps.router.registerAdapterHook('gemini-pty', deps.geminiChannelHook());
  deps.initTtySnapshotTools({
    findSession: (id) => {
      const entry = deps.findSessionById(id);
      return entry ? { id: entry.session.id, snapshot: () => entry.session.snapshot() } : undefined;
    },
    findSessionByPaneId: (paneId) => {
      const entry = deps.findSessionByPaneId(paneId);
      return entry ? { id: entry.session.id, snapshot: () => entry.session.snapshot() } : undefined;
    },
  });
  deps.initAgentHandoffTool({
    findSession: (id) => deps.findSessionById(id)?.session,
  });
}
