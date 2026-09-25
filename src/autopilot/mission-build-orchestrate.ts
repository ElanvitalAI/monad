// ── 미션빌드 실행 orchestrator (재설계 2단계·BC5 전면 cutover) ────────────────────
// RFC-mission-build-coordinator §5 BC5. BC2 드라이버(runBuildCoordinator)를 실배선해 빌드 단계를
// 실제로 coordinator 스케줄(의존 병렬 그룹)로 실행한다. 선형 순차 실행과 **동일 결과**를 내되(같은
// impl 호출·같은 blackboard fan-in), 그룹 내 병렬 이득을 취한다. config flip(missionBuildCoordinator)
// 로 coordinator↔순차 선택 — 순차 폴백을 항상 보존(비파괴·롤백 즉시). clarify(process.exit 제어흐름)
// 는 이 orchestrator 밖(se-mission-prepare 선행/후행 사이 선형 게이트)에 둔다.
// [[feedback_mission_fabric_llm_logic_balance_2026_07_16]] — 스케줄/의존은 결정론 로직, 판단은 impl(LLM).

import {
  emptyBlackboard, foldResult, scheduleStages, BUILD_STAGES,
  type BuildStage, type BuildAgentResult, type Blackboard,
} from './mission-build-coordinator.js';
import { runBuildCoordinator } from './mission-build-coordinator-driver.js';
import { debug } from '../debug/log.js';
import { appendFrame, makeFrameId, nextSeq } from './pipeline/frame-journal.js';
import type { WorkingMemoryEntry } from './mission-working-memory.js';

/** 단계 산출(느슨한 계약 — 선형/coordinator 공유·후처리가 소비). */
export interface EnrichLike { researched: boolean; enrichments: string[]; corrections: string[]; needReason: string; error?: string }
export interface GroundLike { grounded: boolean; context: string; files: string[]; skillFacts?: string[]; codeFacts?: string[]; memoryFacts?: string[]; refFacts?: string[] }
export interface DedupLike { ok: boolean; overlaps: { label: string; consolidation: string }[]; comparedCount: number; error?: string; note?: string }
export interface PhaseLite { id: string; title: string; prompt: string; acceptance: string[] }
export interface DecomposeOut {
  ok: boolean; phaseCount: number; error: string; transientFailed: boolean;
  decompPhases: PhaseLite[]; phaseLines: string;
}
export interface CritiqueOut { critiqueResult: unknown | null; critiqueLine: string }
export interface GranularityOut { granularityLine: string; granularityOversizedCount?: number; arcConforms?: boolean }

/** 단계 구현 주입(기본=실 함수·테스트=mock). enrich/grounding/decompPhases 는 blackboard 에서 주입됨. */
export interface StageImpls {
  research: () => Promise<EnrichLike>;
  ground: () => Promise<GroundLike>;
  dedup: () => Promise<DedupLike>;
  shape: (enrich: EnrichLike) => Promise<{ redesignLine: string }>;
  decompose: (enrich: EnrichLike, grounding: GroundLike) => Promise<DecomposeOut>;
  critique: (decompPhases: PhaseLite[]) => Promise<CritiqueOut>;
  /** ★ arcHint(decisions 채널·P2) — 있으면 확정 아크 수와 실제 페이즈 수를 대조(아크 정합 검증). */
  granularity: (decompPhases: PhaseLite[], arcHint?: number) => Promise<GranularityOut>;
}

export interface BuildStagesResult {
  enrich: EnrichLike; grounding: GroundLike; dedup: DedupLike;
  redesignLine: string;
  phaseCount: number; decomposeOk: boolean; decomposeError: string; decomposeTransientFailed: boolean;
  decompPhases: PhaseLite[]; phaseLines: string;
  critiqueResult: unknown | null; critiqueLine: string;
  granularityLine: string;
  /** 완주가능 게이트 과대 페이즈 개수(≥2 → synthesis narrow-redecompose·대표 2026-07-23). */
  granularityOversizedCount?: number;
  /** coordinator 실행 그룹(관측·shadow parity trace). */
  groups: BuildStage[][];
  executed: BuildStage[];
  /** 실제 실행 경로(coordinator vs sequential) — 관측/폴백 판정용. */
  via: 'coordinator' | 'sequential';
}

const EMPTY_ENRICH: EnrichLike = { researched: false, enrichments: [], corrections: [], needReason: '' };
const EMPTY_GROUND: GroundLike = { grounded: false, context: '', files: [] };
const EMPTY_DEDUP: DedupLike = { ok: false, overlaps: [], comparedCount: 0 };
const EMPTY_DECOMPOSE: DecomposeOut = { ok: false, phaseCount: 0, error: '', transientFailed: false, decompPhases: [], phaseLines: '' };

/**
 * ★ build-context seed(3-pillar RFC-mission-build-context-exchange·research/ground→RUN 이관·2026-07-19) —
 * BUILD 조사(enrich=외부자료조사·grounding=내부소스검색)를 RUN 페이즈(walker/SE)가 **재참조**할 provenance=
 * 'build' 워킹메모리 엔트리로 변환(순수·caller 가 코디네이터 게이트로 write). se-bridge:217·walker wmBlock 이
 * read → 재조사/재구현 방지("재조사 방지·균형을 구현으로"). 종전 이 writer 가 미배선이라 hasBuildContext 항상
 * false 였다(read/관측만 존재). 조사 내용이 없으면 null(무주입). phaseId='build:context' sentinel(dedup 최신 1개).
 */
export function buildContextSeedEntry(enrich: EnrichLike, grounding: GroundLike): (Omit<WorkingMemoryEntry, 'at'>) | null {
  const hasResearch = enrich.researched && (enrich.enrichments.length > 0 || enrich.corrections.length > 0);
  const hasGround = grounding.grounded && (grounding.context.trim().length > 0 || grounding.files.length > 0 || (grounding.memoryFacts?.length ?? 0) > 0 || (grounding.refFacts?.length ?? 0) > 0);
  if (!hasResearch && !hasGround) return null;
  const parts: string[] = [];
  if (hasGround && grounding.context.trim()) parts.push(`내부 grounding: ${grounding.context.trim().slice(0, 400)}`);
  if (hasResearch) {
    if (enrich.enrichments.length) parts.push(`외부조사 보강: ${enrich.enrichments.slice(0, 5).join(' / ')}`);
    if (enrich.corrections.length) parts.push(`교정: ${enrich.corrections.slice(0, 3).join(' / ')}`);
  }
  return {
    phaseId: 'build:context',
    phaseTitle: '빌드 조사 문맥(research/ground)',
    kind: 'investigation',
    provenance: 'build',
    summary: parts.join(' · '),
    reusables: grounding.files.slice(0, 20),   // 내부 소스 파일 = 재사용 경계(재조사·재구현 방지)
    // ★ L3(skill 계약)+L4(코드 export 심볼) 팩트를 decisions 로 carry(경로 reusables 와 별개·내용).
    //   `[skill:`·`[code:` prefix 로 formatWorkingMemoryForPrompt 가 각 섹션에 내용째 렌더 → 구현이 Read/추측
    //   없이도 계약·심볼 보유(재사용 환각 차단). skill≤6·code≤10.
    decisions: [...(grounding.skillFacts ?? []).slice(0, 6), ...(grounding.codeFacts ?? []).slice(0, 10), ...(grounding.memoryFacts ?? []).slice(0, 6), ...(grounding.refFacts ?? []).slice(0, 8)],
    artifacts: [],
  };
}

/** 실행할 단계 집합(clarify 제외 — 선형 게이트). heavy 아니면 분해 이후 단계 제외. */
export function selectBuildStages(heavy: boolean): BuildStage[] {
  const base: BuildStage[] = ['research', 'ground', 'dedup'];
  return heavy ? [...base, 'shape', 'decompose', 'critique', 'granularity'] : base;
}

/** 단계 실행 함수(blackboard 의존 주입) — coordinator/순차 공유. impl 을 호출하고 결과를 output 에. */
function makeRunStage(impls: StageImpls): (stage: BuildStage, bb: Blackboard) => Promise<BuildAgentResult> {
  const out = (bb: Blackboard, s: BuildStage): unknown => bb.results[s]?.output;
  return async (stage, bb) => {
    // ★ 컨텍스트 교환 관측(RFC P6·제1원칙 2026-07-17) — 각 스테이지가 blackboard 에서 무엇을 받았나.
    //   대표 지적("조율자가 신호를 충분히 받아 다시 전달해야 하는데 빠졌다")의 관측 관문. 어느 선행
    //   산출이 실제로 도달했는지 logs.db 로 조회(monad logs --category mission.build.stage-context).
    debug.log('mission.build.stage-context', stage, {
      received: (Object.keys(bb.results) as BuildStage[]).filter((k) => bb.results[k]?.output !== undefined),
      decompPhaseCount: (out(bb, 'decompose') as DecomposeOut | undefined)?.decompPhases?.length,
    });
    switch (stage) {
      case 'research': return { stage, ok: true, output: await impls.research() };
      case 'ground': return { stage, ok: true, output: await impls.ground() };
      case 'dedup': { const d = await impls.dedup(); return { stage, ok: d.ok, output: d }; }
      case 'shape': {
        const enrich = (out(bb, 'research') as EnrichLike | undefined) ?? EMPTY_ENRICH;
        return { stage, ok: true, output: await impls.shape(enrich) };
      }
      case 'decompose': {
        const enrich = (out(bb, 'research') as EnrichLike | undefined) ?? EMPTY_ENRICH;
        const grounding = (out(bb, 'ground') as GroundLike | undefined) ?? EMPTY_GROUND;
        const d = await impls.decompose(enrich, grounding);
        return { stage, ok: d.ok, output: d };
      }
      case 'critique': {
        const dc = (out(bb, 'decompose') as DecomposeOut | undefined)?.decompPhases ?? [];
        return { stage, ok: true, output: await impls.critique(dc) };
      }
      case 'granularity': {
        const dc = (out(bb, 'decompose') as DecomposeOut | undefined)?.decompPhases ?? [];
        // ★ decisions 채널(P2)에서 확정 아크 수를 재전달 — granularity 가 아크 정합을 검증한다.
        return { stage, ok: true, output: await impls.granularity(dc, bb.decisions.arcHint) };
      }
      default: return { stage, ok: true };
    }
  };
}

/** ★ S5(실행 적응·pause) — 분해 파이프라인이 stage 경계에서 pause 를 인지하도록 던지는 신호.
 *  좀비 분해 방지(사고 2026-07-18): cancel/pause 했는데 분해가 계속 도는 갭 수복. 호출측(se-mission-
 *  prepare)이 catch 해 관측+상태 보존 종료(exit 0). 완료된 stage 의 프레임은 이미 저널에 남아 resume 재개. */
export class MissionPausedError extends Error {
  readonly stage: BuildStage;
  constructor(stage: BuildStage) {
    super(`mission paused before stage '${stage}'`);
    this.name = 'MissionPausedError';
    this.stage = stage;
  }
}

/** ★ S5 pause 게이트 래퍼(비파괴·opt-in) — 각 stage 실행 **전** pauseCheck 확인. paused 면 MissionPausedError
 *  throw(그 stage 는 실행 안 됨·frame 미기록). pauseCheck 없으면 원본 그대로(no-op). withFrameJournal 바깥에
 *  둬 "pause 확인 → (통과 시) 실행 → frame append" 순서 보장(pause 된 stage 는 프레임을 남기지 않는다). */
function withPauseGate(
  run: (stage: BuildStage, bb: Blackboard) => Promise<BuildAgentResult>,
  pauseCheck?: () => boolean,
): (stage: BuildStage, bb: Blackboard) => Promise<BuildAgentResult> {
  if (!pauseCheck) return run;
  return async (stage, bb) => {
    if (pauseCheck()) throw new MissionPausedError(stage);
    return run(stage, bb);
  };
}

/** ★ 프레임 저널 계측 래퍼(P0·관측·비파괴) — runStage 실행 후 완료 프레임(inputsSnapshot+output)을
 *  append 해 관측·리플레이·되감기의 SoT 를 남긴다. journal 없으면 원본 그대로(no-op). seq 는 저널
 *  파일에서 이어받아 클로저로 단조 증가(clarify 재-spawn 시 이전 저널에 이어붙임). 병렬 그룹도 append
 *  는 동기라 seq 충돌 없음. inputsSnapshot=진입 blackboard(foldResult 불변이라 그 시점 값 보존). */
function withFrameJournal(
  run: (stage: BuildStage, bb: Blackboard) => Promise<BuildAgentResult>,
  journal?: { missionId: string; via?: 'coordinator' | 'sequential' },
): (stage: BuildStage, bb: Blackboard) => Promise<BuildAgentResult> {
  if (!journal) return run;
  const mid = journal.missionId;
  let seq = nextSeq(mid);
  return async (stage, bb) => {
    const result = await run(stage, bb);
    const s = seq++;
    appendFrame({
      frameId: makeFrameId(mid, s), missionId: mid, seq: s,
      stageIndex: BUILD_STAGES.indexOf(stage), stage,
      status: result.ok ? 'done' : 'failed', timestamp: new Date().toISOString(),
      op: 'push', inputsSnapshot: bb, output: result, version: 0,
      ...(journal.via ? { via: journal.via } : {}), // ★ P5 — 실행 컨트롤러 owner 관측
    });
    return result;
  };
}

/** blackboard → typed 결과 추출(선형/coordinator 공유). */
function extract(bb: Blackboard, groups: BuildStage[][], executed: BuildStage[], via: 'coordinator' | 'sequential'): BuildStagesResult {
  const o = <T>(s: BuildStage, fallback: T): T => (bb.results[s]?.output as T | undefined) ?? fallback;
  const dec = o<DecomposeOut>('decompose', EMPTY_DECOMPOSE);
  const crit = o<CritiqueOut>('critique', { critiqueResult: null, critiqueLine: '' });
  const gran = o<GranularityOut>('granularity', { granularityLine: '', granularityOversizedCount: 0 });
  return {
    enrich: o<EnrichLike>('research', EMPTY_ENRICH),
    grounding: o<GroundLike>('ground', EMPTY_GROUND),
    dedup: o<DedupLike>('dedup', EMPTY_DEDUP),
    redesignLine: o<{ redesignLine: string }>('shape', { redesignLine: '' }).redesignLine,
    phaseCount: dec.phaseCount, decomposeOk: dec.ok, decomposeError: dec.error, decomposeTransientFailed: dec.transientFailed,
    decompPhases: dec.decompPhases, phaseLines: dec.phaseLines,
    critiqueResult: crit.critiqueResult, critiqueLine: crit.critiqueLine,
    granularityLine: gran.granularityLine,
    granularityOversizedCount: gran.granularityOversizedCount ?? 0,
    groups, executed, via,
  };
}

/** 빌드 단계 실행 — coordinator(의존 병렬 그룹) 또는 순차. 결과는 blackboard 통일 → 후처리 공유.
 *  coordinator=true 면 runBuildCoordinator(그룹 병렬), false 면 위상 순서 순차(동일 impl·동일 결과).
 *  stages 부분집합 + seed 로 분할 실행 지원(clarify 게이트 사이 선행/후행 나눠 호출). */
export async function runBuildStages(
  impls: StageImpls,
  opts: {
    stages: readonly BuildStage[];
    coordinator: boolean;
    onGroup?: (group: BuildStage[], idx: number) => void;
    seed?: Blackboard;
    /** ★ 프레임 저널 계측(P0·opt-in·비파괴) — 각 단계 실행을 프레임으로 남겨 관측·리플레이·되감기.
     *  미설정 시 no-op(config `autopilot.pipelineFrames` 로 호출측이 gate). */
    journal?: { missionId: string };
    /** ★ S5 pause 게이트(opt-in·비파괴) — 각 stage 실행 전 확인. true 면 MissionPausedError throw(좀비
     *  분해 방지). 미설정 시 no-op. 호출측(se-mission-prepare)이 isMissionPaused 를 주입·catch. */
    pauseCheck?: () => boolean;
  },
): Promise<BuildStagesResult> {
  const stages = [...opts.stages];
  // ★ P5 — 저널에 실행 컨트롤러(via) 태그 주입(owner 관측·컨트롤러 drift 감지 근거). journal 없으면 no-op.
  const journalWithVia = opts.journal ? { ...opts.journal, via: (opts.coordinator ? 'coordinator' : 'sequential') as 'coordinator' | 'sequential' } : undefined;
  const runStage = withPauseGate(withFrameJournal(makeRunStage(impls), journalWithVia), opts.pauseCheck);
  if (opts.coordinator) {
    const r = await runBuildCoordinator(runStage, { stages, onGroup: opts.onGroup, ...(opts.seed ? { seed: opts.seed } : {}) });
    return extract(r.blackboard, r.groups, stages, 'coordinator');
  }
  // 순차 폴백 — 같은 위상 그룹 순서를 순차로(그룹 내도 순차). 동일 impl·동일 blackboard.
  const groups = scheduleStages(stages);
  let bb: Blackboard = opts.seed ? { results: { ...opts.seed.results }, decisions: opts.seed.decisions ?? {} } : emptyBlackboard();
  for (let gi = 0; gi < groups.length; gi++) {
    opts.onGroup?.(groups[gi], gi);
    for (const s of groups[gi]) bb = foldResult(bb, await runStage(s, bb));
  }
  return extract(bb, groups, stages, 'sequential');
}
