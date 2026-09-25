// ── 미션 랜딩 빠른 스캔 (B7 · PLAN-mission-pre-arming-briefing 후속) ───────────────────────
//
// 대표 요구(2026-07-15): "미션을 끝내려 해도 미랜딩이 있다는 사실을 빠르게 브리핑 가능한 수단."
// grounded reconcile 은 per-phase git 고고학이라 느리다 — 이건 경량판. 기록된 PR 의 merge 상태만
// 1회 gh 배치로 확인해(수초) "완주/arming 전 미머지 N건"을 즉답한다. 순수 분류 + IO(gh) 분리.
//
//   open   = 확정 미머지(완주 차단·blocking)
//   closed = 닫힘 — 대체 랜딩(landed-elsewhere) 또는 미완일 수 있음 → grounded 로 재확인(needsRecheck)
//   merged = 랜딩 확인 · none = PR 없는 운영/조사 페이즈(정보)

import { TaskStore } from '../task-orchestrator/store.js';
import { missionResources } from './mission-resources.js';

export type LandingState = 'merged' | 'open' | 'closed' | 'none';

export interface PhaseLanding {
  phaseTitle: string;
  status: string;
  pr: number | null;
  state: LandingState;
  /** 완주 차단(open PR = 확정 미머지). closed 는 blocking 아님(grounded 재확인 대상). */
  blocking: boolean;
}

export interface MissionLandingScan {
  missionId: string;
  total: number;
  merged: number;
  open: number;
  closed: number;
  none: number;
  /** open PR 개수 = 확정 미머지(완주/arming 차단). */
  blocking: number;
  /** closed PR 개수 = 대체 랜딩 or 미완(grounded 로 확인 권장). */
  needsRecheck: number;
  phases: PhaseLanding[];
}

/** PR URL 에서 번호 추출. */
function prNumberOf(prUrl: string | undefined): number | null {
  const m = prUrl?.match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 순수 분류 — PR 번호 + 관측된 gh 상태 → 랜딩 판정. blocking=open(확정 미머지)만. */
export function classifyLanding(pr: number | null, ghState: 'MERGED' | 'OPEN' | 'CLOSED' | undefined): { state: LandingState; blocking: boolean } {
  if (pr === null) return { state: 'none', blocking: false };
  if (ghState === 'MERGED') return { state: 'merged', blocking: false };
  if (ghState === 'OPEN') return { state: 'open', blocking: true };
  if (ghState === 'CLOSED') return { state: 'closed', blocking: false };
  return { state: 'none', blocking: false }; // 조회 실패 — 미상(보수적으로 non-blocking·grounded 재확인)
}

export interface LandingScanDeps {
  store?: TaskStore;
  /** PR 번호 배열 → gh 상태 맵. 기본=1회 `gh pr list` 배치. 테스트 주입 seam. */
  prStates?: (prs: number[]) => Map<number, 'MERGED' | 'OPEN' | 'CLOSED'>;
}

/** 기본 IO — `gh pr list --state all` 1회 호출로 최근 PR 상태 맵. 미포함 PR 은 개별 view 폴백(소수). */
function defaultPrStates(prs: number[]): Map<number, 'MERGED' | 'OPEN' | 'CLOSED'> {
  const map = new Map<number, 'MERGED' | 'OPEN' | 'CLOSED'>();
  if (!prs.length) return map;
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const gh = (args: string): string => {
    try { return execSync(`gh ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { return ''; }
  };
  // 1회 배치 — 최근 PR 대량 조회(open+closed+merged). a6230f 처럼 최근 미션이면 여기서 다 잡힘.
  try {
    const out = gh(`pr list --state all --limit 400 --json number,state`);
    const rows = JSON.parse(out || '[]') as Array<{ number: number; state: 'MERGED' | 'OPEN' | 'CLOSED' }>;
    for (const r of rows) map.set(r.number, r.state);
  } catch { /* fall through to per-PR */ }
  // 배치에 없던 PR(오래됨)만 개별 view 폴백.
  for (const n of prs) {
    if (map.has(n)) continue;
    try {
      const j = JSON.parse(gh(`pr view ${n} --json number,state`) || '{}') as { number?: number; state?: 'MERGED' | 'OPEN' | 'CLOSED' };
      if (j.state) map.set(n, j.state);
    } catch { /* 미상 */ }
  }
  return map;
}

/**
 * 미션 랜딩 빠른 스캔 — 기록된 PR 의 merge 상태만 확인(git 고고학 없음·수초). blocking=open(확정 미머지).
 * 완주/arming 전 "미랜딩 있나?" 즉답용. 상세(landed-elsewhere vs incomplete)는 grounded briefing.
 */
export function scanMissionLanding(missionId: string, deps: LandingScanDeps = {}): MissionLandingScan {
  const store = deps.store ?? new TaskStore();
  const ownsStore = !deps.store;
  try {
    const led = missionResources(missionId, { store });
    const phaseRows = led.tasks.map((t) => ({ phaseTitle: t.title, status: t.status, pr: prNumberOf(t.prUrl) }));
    const prNums = [...new Set(phaseRows.map((p) => p.pr).filter((n): n is number => n !== null))];
    const states = (deps.prStates ?? defaultPrStates)(prNums);
    const phases: PhaseLanding[] = phaseRows.map((p) => {
      const { state, blocking } = classifyLanding(p.pr, p.pr !== null ? states.get(p.pr) : undefined);
      return { phaseTitle: p.phaseTitle, status: p.status, pr: p.pr, state, blocking };
    });
    return {
      missionId, total: phases.length,
      merged: phases.filter((p) => p.state === 'merged').length,
      open: phases.filter((p) => p.state === 'open').length,
      closed: phases.filter((p) => p.state === 'closed').length,
      none: phases.filter((p) => p.state === 'none').length,
      blocking: phases.filter((p) => p.blocking).length,
      needsRecheck: phases.filter((p) => p.state === 'closed').length,
      phases,
    };
  } finally {
    if (ownsStore) store.close();
  }
}

/** 사람이 읽을 한 줄 요약 — 완주/arming 게이트 힌트. */
export function formatLandingScanLine(s: MissionLandingScan): string {
  if (s.blocking > 0) return `⛔ 완주 차단: 미머지(open) PR ${s.blocking}건 — 실집행 전 처리 필요`;
  if (s.needsRecheck > 0) return `⚠️ 확인 권장: 닫힌 PR ${s.needsRecheck}건 — grounded briefing 으로 대체 랜딩 확인(landed-elsewhere?)`;
  if (s.merged > 0) return `✅ 랜딩 확인: 기록 PR ${s.merged}건 전부 merged`;
  return `ℹ️ 기록 PR 없음(운영/조사 미션) — merged ${s.merged}·open ${s.open}·none ${s.none}`;
}

/** 상세 리포트(각 페이즈 상태). */
export function formatLandingScanReport(s: MissionLandingScan): string {
  const icon = (st: LandingState): string => st === 'merged' ? '✅' : st === 'open' ? '⛔' : st === 'closed' ? '⚠️' : '·';
  const L = [`━━ 미션 랜딩 스캔 · ${s.missionId} ━━`, formatLandingScanLine(s), `총 ${s.total} · merged ${s.merged} · open ${s.open} · closed ${s.closed} · none ${s.none}`, ''];
  for (const p of s.phases) {
    if (p.state === 'none') continue; // PR 없는 운영/조사 페이즈는 생략(노이즈).
    L.push(`  ${icon(p.state)} [${p.state}]${p.pr ? ` #${p.pr}` : ''} ${p.phaseTitle.slice(0, 44)}`);
  }
  return L.join('\n');
}
