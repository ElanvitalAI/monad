import { describe, it, expect } from 'bun:test';
import { reconstructStack, currentStatus, stackTop, currentBlackboard, diagnoseStack } from './frame-stack.js';
import type { PipelineFrame } from './frame-types.js';
import { emptyBlackboard, type BuildStage } from '../mission-build-coordinator.js';

function frame(seq: number, stage: BuildStage, over: Partial<PipelineFrame> = {}): PipelineFrame {
  return {
    frameId: `m1:${seq}`, missionId: 'm1', seq, stageIndex: seq, stage,
    status: 'done', timestamp: '2026-07-18T00:00:00.000Z', op: 'push',
    inputsSnapshot: emptyBlackboard(), version: 0, ...over,
  };
}

describe('frame-stack — 자기인지(스택 재구성·진단)', () => {
  it('reconstructStack.top = 마지막 non-superseded', () => {
    const f = [frame(0, 'research'), frame(1, 'ground'), frame(2, 'dedup', { status: 'superseded' })];
    expect(reconstructStack('m1', f).top!.stage).toBe('ground');
  });

  it('currentStatus = 각 stage 최신 프레임 status(미기록=pending)', () => {
    const f = [frame(0, 'research'), frame(1, 'research', { status: 'failed' }), frame(2, 'ground')];
    const st = currentStatus(f);
    expect(st.research).toBe('failed'); // 최신이 이김
    expect(st.ground).toBe('done');
    expect(st.decompose).toBe('pending'); // 미기록
  });

  it('stackTop / currentBlackboard(top output 반영)', () => {
    const bb = emptyBlackboard();
    const f = [frame(0, 'research', {
      output: { stage: 'research', ok: true },
    })];
    expect(stackTop(f)!.stage).toBe('research');
    expect(currentBlackboard(f).results.research?.ok).toBe(true);
    expect(currentBlackboard([]).results).toEqual(bb.results);
  });

  it('diagnoseStack — stuck(failed) 감지 + healable + 셀프힐 권장', () => {
    const f = [frame(0, 'research'), frame(1, 'ground'), frame(2, 'decompose', { status: 'failed' })];
    const d = diagnoseStack('m1', f);
    expect(d.stuck).toContain('decompose');
    expect(d.healable).toBe(true);
    expect(d.recommendation).toContain('되감아');
    expect(d.current).toBe('decompose');
  });

  it('diagnoseStack — superseded / incomplete 분류', () => {
    const f = [frame(0, 'research'), frame(1, 'ground', { status: 'superseded' })];
    const d = diagnoseStack('m1', f);
    expect(d.superseded).toContain('ground');
    expect(d.incomplete).toContain('decompose'); // 미기록=pending
    expect(d.healable).toBe(false); // stuck 없음
  });

  it('빈 저널 = current null·전부 pending', () => {
    const d = diagnoseStack('m1', []);
    expect(d.current).toBeNull();
    expect(Object.values(d.statuses).every((s) => s === 'pending')).toBe(true);
  });
});
