import { describe, it, expect } from 'bun:test';
import { replayFrames } from './frame-replay.js';
import type { PipelineFrame } from './frame-types.js';
import { emptyBlackboard, type BuildStage, type BuildAgentResult } from '../mission-build-coordinator.js';

function fr(seq: number, stage: BuildStage, over: Partial<PipelineFrame> = {}): PipelineFrame {
  const output: BuildAgentResult = { stage, ok: true, output: { v: stage } };
  return {
    frameId: `m1:${seq}`, missionId: 'm1', seq, stageIndex: seq, stage,
    status: 'done', timestamp: '2026-07-18T00:00:00.000Z', op: 'push',
    inputsSnapshot: emptyBlackboard(), version: 0, output, ...over,
  };
}

describe('frame-replay — 저장 출력 재생(결정론·LLM 0)', () => {
  it('output 순서대로 foldResult 재구성', () => {
    const r = replayFrames([fr(0, 'research'), fr(1, 'ground'), fr(2, 'decompose')]);
    expect(r.replayed).toEqual(['research', 'ground', 'decompose']);
    expect(Object.keys(r.blackboard.results)).toEqual(['research', 'ground', 'decompose']);
    expect(r.skipped).toEqual([]);
  });

  it('superseded/failed skip(재생 대상 아님)', () => {
    const r = replayFrames([
      fr(0, 'research'),
      fr(1, 'ground', { status: 'superseded' }),
      fr(2, 'decompose', { status: 'failed' }),
    ]);
    expect(r.replayed).toEqual(['research']);
    expect(r.skipped).toEqual(['ground', 'decompose']);
    expect(r.blackboard.results.ground).toBeUndefined();
  });

  it('되감기 마커(pop/goto) skip', () => {
    const r = replayFrames([fr(0, 'research'), fr(1, 'ground', { op: 'goto', output: undefined }), fr(2, 'ground')]);
    // goto 프레임은 재생 대상 아님, seq2 의 ground 만 재생
    expect(r.replayed).toEqual(['research', 'ground']);
  });

  it('decisions 진입 스냅샷 누적 병합(arcHint 복원)', () => {
    const withArc = emptyBlackboard();
    const r = replayFrames([
      fr(0, 'research'),
      fr(1, 'decompose', { inputsSnapshot: { results: withArc.results, decisions: { arcHint: 5 } } }),
    ]);
    expect(r.blackboard.decisions.arcHint).toBe(5);
  });

  it('toStage 지정 시 그 단계까지만', () => {
    const r = replayFrames([fr(0, 'research'), fr(1, 'ground'), fr(2, 'decompose')], { toStage: 'ground' });
    expect(r.replayed).toEqual(['research', 'ground']);
    expect(r.stoppedAt).toBe('ground');
    expect(r.blackboard.results.decompose).toBeUndefined();
  });

  it('빈 프레임 = empty blackboard', () => {
    const r = replayFrames([]);
    expect(r.replayed).toEqual([]);
    expect(Object.keys(r.blackboard.results)).toEqual([]);
  });
});
