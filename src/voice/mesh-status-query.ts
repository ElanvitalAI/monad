// ── V5 (Phase 3 Bundle 4) — Voice 로 mesh-of-elanouss 조회 ──
//
// HANDOFF Phase 3 / ROADMAP §6 V5: "Voice 로 mesh-of-elanouss 조회". 사용자가
// "동료 elanous 가 뭐 하고 있어?" 같은 음성 명령으로 mesh 의 다른 elanous
// instance 들의 상태를 한 번에 조회 + voice 보고.
//
// V2 voice-orchestrator (Bundle 2) 와 비슷한 4-step pattern 이지만
// subagent 대신 mesh 노드 들. host 가 mesh adapter 주입 (mesh sprint 26
// G7 미land — wire-light).

export interface MeshNodeStatus {
  readonly nodeId: string;
  readonly displayName?: string;
  /** 해당 elanous 가 현재 진행 중인 작업 — 없으면 'idle'. */
  readonly activeTaskSummary?: string;
  /** 진행 중인 shell 개수 / 종류 요약 (예: "3v 1h"). */
  readonly shellCounts?: string;
  /** Last health-check ISO. 너무 오래되면 stale 표시. */
  readonly lastSeenIso?: string;
  /** 추가 metadata (상위 host 가 정함). */
  readonly extra?: Record<string, unknown>;
}

export interface MeshStatusQueryDeps {
  /** Mesh adapter — 모든 known node 의 status 수집. budget 안에 끝나야. */
  fetchMeshStatus: () => Promise<readonly MeshNodeStatus[] | null>;
  speak: (sentence: string) => Promise<void>;
  /** Compose utterance from collected statuses. defaults to 한국어. */
  composeUtterance?: (statuses: readonly MeshNodeStatus[]) => string;
  /** Per-fetch budget. Default 5000ms. */
  fetchBudgetMs?: number;
  /** Stale threshold — node 의 lastSeenIso 가 이보다 오래면 "stale" 표시.
   *  Default 60000 (1 min). */
  staleThresholdMs?: number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
  now?: () => number;
}

export type MeshQueryOutcome =
  | 'spoken'
  | 'fetch-failed'
  | 'no-nodes'
  | 'tts-failed';

export interface MeshQueryResult {
  readonly outcome: MeshQueryOutcome;
  readonly utterance?: string;
  readonly nodeCount?: number;
  readonly staleCount?: number;
}

export interface MeshStatusQuery {
  ask(): Promise<MeshQueryResult>;
}

const DEFAULT_FETCH_BUDGET_MS = 5000;
const DEFAULT_STALE_THRESHOLD_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(null);
    });
  });
}

function defaultCompose(statuses: readonly MeshNodeStatus[]): string {
  if (statuses.length === 0) return 'mesh 에 연결된 elanous 가 없어요.';
  if (statuses.length === 1) {
    const s = statuses[0]!;
    const name = s.displayName ?? s.nodeId;
    const task = s.activeTaskSummary ?? 'idle';
    const shells = s.shellCounts ? ` · ${s.shellCounts}` : '';
    return `${name} 는 ${task}${shells}.`;
  }
  const lines = statuses.map((s) => {
    const name = s.displayName ?? s.nodeId;
    const task = s.activeTaskSummary ?? 'idle';
    return `${name}: ${task}`;
  });
  return `mesh 에 ${statuses.length}개 elanous: ${lines.join(', ')}.`;
}

function countStale(
  statuses: readonly MeshNodeStatus[],
  thresholdMs: number,
  now: number,
): number {
  let stale = 0;
  for (const s of statuses) {
    if (!s.lastSeenIso) continue;
    const age = now - new Date(s.lastSeenIso).getTime();
    if (age > thresholdMs) stale += 1;
  }
  return stale;
}

export function createMeshStatusQuery(deps: MeshStatusQueryDeps): MeshStatusQuery {
  const fetchBudget = deps.fetchBudgetMs ?? DEFAULT_FETCH_BUDGET_MS;
  const staleThreshold = deps.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  const compose = deps.composeUtterance ?? defaultCompose;
  const now = deps.now ?? Date.now;
  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  return {
    async ask() {
      log('mesh.query.start', '');
      const statuses = await withTimeout(deps.fetchMeshStatus(), fetchBudget);
      if (!statuses) {
        const utterance = 'mesh 상태를 가져오지 못했어요. 잠시 후 다시 시도해주세요.';
        try { await deps.speak(utterance); } catch { /* graceful */ }
        log('mesh.query.fetch-failed', '');
        return { outcome: 'fetch-failed', utterance };
      }
      if (statuses.length === 0) {
        const utterance = 'mesh 에 연결된 elanous 가 없어요.';
        try { await deps.speak(utterance); } catch { /* graceful */ }
        log('mesh.query.no-nodes', '');
        return { outcome: 'no-nodes', utterance, nodeCount: 0 };
      }

      const utterance = compose(statuses);
      const stale = countStale(statuses, staleThreshold, now());

      try {
        await deps.speak(utterance);
      } catch (err) {
        log('mesh.query.tts-throw', '', { error: String(err) });
        return { outcome: 'tts-failed', utterance, nodeCount: statuses.length, staleCount: stale };
      }

      log('mesh.query.spoken', '', { nodeCount: statuses.length, staleCount: stale });
      return {
        outcome: 'spoken',
        utterance,
        nodeCount: statuses.length,
        staleCount: stale,
      };
    },
  };
}
