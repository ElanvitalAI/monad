// 미션빌드 orchestrator 단위테스트 (BC5) — coordinator≡sequential 동치·부분집합·seed·결과 추출.
import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  runBuildStages,
  selectBuildStages,
  type StageImpls,
  type EnrichLike,
  type GroundLike,
} from '../src/autopilot/mission-build-orchestrate.js';
import { type BuildStage } from '../src/autopilot/mission-build-coordinator.js';
import { setFrameDir, readFrames } from '../src/autopilot/pipeline/frame-journal.js';

const ENRICH: EnrichLike = { researched: true, enrichments: ['e1', 'e2'], corrections: ['c1'], needReason: 'need' };
const GROUND: GroundLike = { grounded: true, context: 'ctx', files: ['a.ts', 'b.ts'] };
const PHASES = [{ id: 'p1', title: 'P1', prompt: 'do', acceptance: ['x'] }];

/** 결정론 mock impls — 호출 순서 기록. shape/decompose 는 주입된 enrich/grounding 을 확인. */
function mkImpls(trace: string[], seen: { enrich?: EnrichLike; grounding?: GroundLike } = {}): StageImpls {
  return {
    research: async () => { trace.push('research'); return ENRICH; },
    ground: async () => { trace.push('ground'); return GROUND; },
    dedup: async () => { trace.push('dedup'); return { ok: true, overlaps: [], comparedCount: 3 }; },
    shape: async (enrich) => { trace.push('shape'); seen.enrich = enrich; return { redesignLine: 'REDESIGN' }; },
    decompose: async (enrich, grounding) => {
      trace.push('decompose'); seen.enrich = enrich; seen.grounding = grounding;
      return { ok: true, phaseCount: 1, error: '', transientFailed: false, decompPhases: PHASES, phaseLines: '  0. P1' };
    },
    critique: async (dp) => { trace.push(`critique:${dp.length}`); return { critiqueResult: { hasCritical: false }, critiqueLine: 'CRIT' }; },
    granularity: async (dp, arcHint) => { trace.push(`granularity:${dp.length}:arc${arcHint ?? '-'}`); return { granularityLine: 'GRAN' }; },
  };
}

describe('selectBuildStages', () => {
  it('heavy=false → research/ground/dedup 만', () => {
    expect(selectBuildStages(false)).toEqual(['research', 'ground', 'dedup']);
  });
  it('heavy=true → 7단계(clarify 제외)', () => {
    expect(selectBuildStages(true)).toEqual(['research', 'ground', 'dedup', 'shape', 'decompose', 'critique', 'granularity']);
  });
});

describe('runBuildStages — coordinator vs sequential 동치', () => {
  const stages = selectBuildStages(true);
  it('coordinator: 결과·via 정확', async () => {
    const trace: string[] = [];
    const r = await runBuildStages(mkImpls(trace), { stages, coordinator: true });
    expect(r.via).toBe('coordinator');
    expect(r.enrich.enrichments).toEqual(['e1', 'e2']);
    expect(r.grounding.files).toHaveLength(2);
    expect(r.redesignLine).toBe('REDESIGN');
    expect(r.phaseCount).toBe(1);
    expect(r.decompPhases).toHaveLength(1);
    expect(r.critiqueLine).toBe('CRIT');
    expect(r.granularityLine).toBe('GRAN');
  });
  it('sequential: 동일 결과', async () => {
    const trace: string[] = [];
    const r = await runBuildStages(mkImpls(trace), { stages, coordinator: false });
    expect(r.via).toBe('sequential');
    expect(r.redesignLine).toBe('REDESIGN');
    expect(r.phaseCount).toBe(1);
    expect(r.critiqueLine).toBe('CRIT');
    expect(r.granularityLine).toBe('GRAN');
  });
  it('두 경로 결과 동치(핵심 필드)', async () => {
    const co = await runBuildStages(mkImpls([]), { stages, coordinator: true });
    const seq = await runBuildStages(mkImpls([]), { stages, coordinator: false });
    for (const k of ['redesignLine', 'phaseCount', 'critiqueLine', 'granularityLine'] as const) {
      expect(co[k]).toEqual(seq[k]);
    }
    expect(co.enrich).toEqual(seq.enrich);
  });
});

describe('runBuildStages — 의존 주입(shape/decompose 가 선행 결과 참조)', () => {
  it('decompose 는 research/ground 산출을 받는다', async () => {
    const seen: { enrich?: EnrichLike; grounding?: GroundLike } = {};
    await runBuildStages(mkImpls([], seen), { stages: selectBuildStages(true), coordinator: true });
    expect(seen.enrich?.enrichments).toEqual(['e1', 'e2']);
    expect(seen.grounding?.files).toHaveLength(2);
  });
  it('critique/granularity 는 decompose 의 decompPhases 를 받는다(길이 1)', async () => {
    const trace: string[] = [];
    await runBuildStages(mkImpls(trace), { stages: selectBuildStages(true), coordinator: true });
    expect(trace).toContain('critique:1');
    expect(trace).toContain('granularity:1:arc-'); // arcHint 미주입(decisions 비어있음)
  });
});

describe('runBuildStages — 분할 실행(seed) : 선행/후행', () => {
  it('후행이 seed 로 선행 결과 참조', async () => {
    const seen: { enrich?: EnrichLike; grounding?: GroundLike } = {};
    // 선행: research/ground/dedup
    const pre = await runBuildStages(mkImpls([]), { stages: ['research', 'ground', 'dedup'], coordinator: true });
    // 후행: shape/decompose/critique/granularity — seed 로 선행 산출 주입
    const seed = { results: {
      research: { stage: 'research' as BuildStage, ok: true, output: pre.enrich },
      ground: { stage: 'ground' as BuildStage, ok: true, output: pre.grounding },
    }, decisions: {} };
    const post = await runBuildStages(mkImpls([], seen), {
      stages: ['shape', 'decompose', 'critique', 'granularity'], coordinator: true, seed,
    });
    expect(seen.enrich?.enrichments).toEqual(['e1', 'e2']); // seed 로 전달됨
    expect(seen.grounding?.files).toHaveLength(2);
    expect(post.phaseCount).toBe(1);
  });

  it('P2 decisions 채널 — seed.decisions.arcHint 가 granularity 로 재전달된다', async () => {
    const trace: string[] = [];
    const seed = { results: {}, decisions: { arcHint: 5 } };
    await runBuildStages(mkImpls(trace), {
      stages: ['decompose', 'granularity'], coordinator: true, seed,
    });
    // 조율자가 decisions.arcHint(5)를 granularity 소비자로 재전달 — 대표 "컨텍스트 교환"
    expect(trace).toContain('granularity:1:arc5');
  });
});

describe('runBuildStages — light 경로', () => {
  it('heavy=false → shape/decompose 미실행·기본값', async () => {
    const trace: string[] = [];
    const r = await runBuildStages(mkImpls(trace), { stages: selectBuildStages(false), coordinator: true });
    expect(trace.sort()).toEqual(['dedup', 'ground', 'research']);
    expect(r.phaseCount).toBe(0);
    expect(r.redesignLine).toBe('');
    expect(r.critiqueLine).toBe('');
  });
});

describe('runBuildStages — 프레임 저널 계측(P0·관측·비파괴)', () => {
  let dir: string | null = null;
  afterEach(() => { setFrameDir(null); if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } } dir = null; });

  it('journal 옵션 시 각 단계 = 프레임(순차·seq 단조·inputsSnapshot 인자 보존)', async () => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'orch-pf-')); setFrameDir(dir);
    await runBuildStages(mkImpls([]), { stages: selectBuildStages(true), coordinator: false, journal: { missionId: 'mj' } });
    const frames = readFrames('mj');
    expect(frames.map((f) => f.stage)).toEqual(['research', 'ground', 'dedup', 'shape', 'decompose', 'critique', 'granularity']);
    expect(frames.map((f) => f.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(frames.every((f) => f.status === 'done' && f.op === 'push')).toBe(true);
    // ★ 리플레이 토대 — decompose 프레임의 inputsSnapshot(인자)에 선행 산출이 실제로 담긴다.
    const dec = frames.find((f) => f.stage === 'decompose')!;
    expect(dec.inputsSnapshot.results.research).toBeDefined();
    expect(dec.inputsSnapshot.results.ground).toBeDefined();
    expect(dec.output?.ok).toBe(true);
  });

  it('실패 단계 = failed 프레임(자기인지 stuck 판정 근거)', async () => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'orch-pf-')); setFrameDir(dir);
    const impls = mkImpls([]);
    impls.dedup = async () => ({ ok: false, overlaps: [], comparedCount: 0 });
    await runBuildStages(impls, { stages: ['research', 'ground', 'dedup'], coordinator: false, journal: { missionId: 'mf' } });
    expect(readFrames('mf').find((f) => f.stage === 'dedup')!.status).toBe('failed');
  });

  it('journal 없으면 no-op(파일 미생성·비파괴)', async () => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'orch-pf-')); setFrameDir(dir);
    await runBuildStages(mkImpls([]), { stages: selectBuildStages(false), coordinator: false });
    expect(readFrames('nomission')).toEqual([]);
  });
});
