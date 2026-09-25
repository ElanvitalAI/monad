// ── 로컬 모델 벤치 미션 — 주기 벤치 → preset 역제안(비파괴·HITL) (2026-07-15) ──────
//
// 지속 LLM 관리 루프의 로컬 판(제1원칙): 로컬 fleet 를 주기적으로 벤치(관측) → 최고 모델을 스스로 인지 →
// fleet preset 이 최고가 아니면 **비파괴 역제안**(셀프힐·자동적용 없음·핀 변경은 HITL). 커뮤니티 hype 로
// 발굴된 후보(HF repo)는 다운로드+벤치 제안으로 편입. model-watch-mission 패턴(promote:false·onProposal sink).
//
// 전부 주입(inventory·benchmark·record·onProposal) — 단위테스트 가능·클라우드 0(로컬 벤치만).

import { debug } from '../../../debug/log.js';
import type { Scorecard } from './runner.js';

export interface BenchProposalRankEntry { model: string; total: number; node: string; saturated: boolean }

export interface BenchMissionProposal {
  readonly kind: 'preset-recommendation';
  /** 최고 점수 모델. */
  readonly top: BenchProposalRankEntry;
  /** 현재 preset 과 그 벤치 점수(벤치 목록에 없으면 null). */
  readonly current: { model: string; total: number | null } | null;
  /** 사람이 읽는 근거. */
  readonly rationale: string;
  /** ★ 항상 false — 자동 적용 금지(핀 변경은 대표 HITL). */
  readonly promote: false;
  readonly ranking: readonly BenchProposalRankEntry[];
  /** 전 모델 포화(변별 불가)면 harder tier 필요 신호. */
  readonly allSaturated: boolean;
}

export interface BenchMissionDeps {
  /** 벤치할 로컬 모델 목록(기본: 러너 호출측이 pickable/loaded 20-40B 로 주입). */
  listModels: () => Promise<string[]>;
  /** 모델들 벤치(기본: benchmarkFleet over 엔드포인트). */
  benchmark: (models: string[]) => Promise<Scorecard[]>;
  /** 현재 fleet preset 모델 id(없으면 null). */
  currentPreset?: () => string | null;
  /** 스코어카드 영속(logs/store). */
  record?: (scorecards: readonly Scorecard[]) => Promise<void> | void;
  /** 역제안 sink(telegram/discovery-mission HITL). 기본: 로그만. */
  onProposal?: (p: BenchMissionProposal) => Promise<void> | void;
  /** 역제안 최소 우위 마진(현재 preset 대비 top 이 이 이상 높아야 제안 — 노이즈 억제). 기본 3점. */
  proposeMargin?: number;
  now?: () => number;
}

export interface BenchMissionResult {
  readonly scorecards: readonly Scorecard[];
  readonly proposal?: BenchMissionProposal;
}

/**
 * 로컬 벤치 미션 1회 실행. 벤치 → 기록 → 랭킹 → (top 이 현재 preset 을 마진 이상 앞서면) 비파괴 preset
 * 역제안. 후보 없음/전부 실패면 제안 없이 종료(fail-soft).
 */
export async function runLocalBenchMission(deps: BenchMissionDeps): Promise<BenchMissionResult> {
  const now = deps.now ?? Date.now;
  const margin = deps.proposeMargin ?? 3;
  const models = await deps.listModels();
  if (!models.length) {
    debug.log('llm.bench', 'mission-skip', { reason: 'no-models' });
    return { scorecards: [] };
  }
  const scorecards = await deps.benchmark(models);
  if (deps.record) await deps.record(scorecards);
  if (!scorecards.length) {
    debug.log('llm.bench', 'mission-skip', { reason: 'no-scorecards' });
    return { scorecards: [] };
  }

  const ranking: BenchProposalRankEntry[] = [...scorecards]
    .sort((a, b) => b.total - a.total)
    .map((s) => ({ model: s.target.model, total: s.total, node: s.target.node, saturated: s.saturated }));
  const top = ranking[0]!;
  const allSaturated = ranking.every((r) => r.saturated);

  const currentModel = deps.currentPreset?.() ?? null;
  const currentEntry = currentModel ? ranking.find((r) => r.model === currentModel) : undefined;
  const current = currentModel ? { model: currentModel, total: currentEntry?.total ?? null } : null;

  // 역제안 조건: preset 미설정이거나, top 이 현재 preset 모델과 다르고 마진 이상 우위.
  const beatsCurrent = current === null
    || (current.model !== top.model && (current.total === null || top.total - current.total >= margin));

  if (!beatsCurrent) {
    debug.log('llm.bench', 'mission-noop', { top: top.model, topTotal: top.total, current: current?.model, currentTotal: current?.total });
    return { scorecards };
  }

  const rationale = current === null
    ? `fleet preset 미설정 — 벤치 1위 ${top.model}(${top.total}/100·@${top.node})를 preset 후보로 제안.`
    : `벤치 1위 ${top.model}(${top.total}/100)이 현재 preset ${current.model}(${current.total ?? '미벤치'})을 마진 ${margin}↑ 앞섬.`
      + (allSaturated ? ' ⚠️ 전 모델 포화 — harder tier 필요(변별 신뢰↓).' : '');

  const proposal: BenchMissionProposal = {
    kind: 'preset-recommendation',
    top, current, rationale, promote: false, ranking, allSaturated,
  };
  debug.log('llm.bench', 'mission-proposal', { top: top.model, topTotal: top.total, current: current?.model, promote: false, at: now() });
  if (deps.onProposal) await deps.onProposal(proposal);
  return { scorecards, proposal };
}
