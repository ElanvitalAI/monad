// 공용 frames(C5 승격) — 제네릭 replay/rewind(도메인 주입) 검증(토이 도메인).
import { test, expect, describe } from 'bun:test';
import { replayFrames, rewind, gotoStage, type PipelineFrame } from './frames.js';

type Stage = 'a' | 'b' | 'c';
type State = { acc: string[] };
type Out = { emit: string };

const frame = (seq: number, stage: Stage, o: Partial<PipelineFrame<Stage, State, Out>> = {}): PipelineFrame<Stage, State, Out> => ({
  frameId: `m:${seq}`, missionId: 'm', seq, stageIndex: seq, stage, status: 'done',
  timestamp: '2026-07-20T00:00:00Z', op: 'push', inputsSnapshot: { acc: [] }, output: { emit: stage }, version: 1, ...o,
});

const deps = {
  emptyState: (): State => ({ acc: [] }),
  fold: (s: State, f: PipelineFrame<Stage, State, Out>): State => ({ acc: [...s.acc, f.output!.emit] }),
};

describe('frames — replayFrames(제네릭·주입 fold)', () => {
  test('done 프레임 output fold·순서 재구성', () => {
    const r = replayFrames([frame(1, 'a'), frame(2, 'b')], deps);
    expect(r.blackboard.acc).toEqual(['a', 'b']);
    expect(r.replayed).toEqual(['a', 'b']);
  });
  test('superseded/failed/output없음 skip', () => {
    const r = replayFrames([
      frame(1, 'a'),
      frame(2, 'b', { status: 'superseded' }),
      frame(3, 'c', { status: 'failed' }),
    ], deps);
    expect(r.blackboard.acc).toEqual(['a']);
    expect(r.skipped).toEqual(['b', 'c']);
  });
  test('pop/goto 마커는 재생 대상 아님', () => {
    const r = replayFrames([frame(1, 'a'), frame(2, 'b', { op: 'goto' })], deps);
    expect(r.blackboard.acc).toEqual(['a']);
  });
  test('toStage 지정 시 그 단계까지만', () => {
    const r = replayFrames([frame(1, 'a'), frame(2, 'b'), frame(3, 'c')], deps, { toStage: 'b' });
    expect(r.stoppedAt).toBe('b');
    expect(r.blackboard.acc).toEqual(['a', 'b']);
  });
});

describe('frames — rewind/gotoStage(제네릭·주입 makeFrameId)', () => {
  const mk = (mid: string, seq: number) => `${mid}:${seq}`;
  test('gotoStage — 타겟 이후 supersede + 되감기 기록', () => {
    const frames = [frame(1, 'a'), frame(2, 'b'), frame(3, 'c')];
    const plan = gotoStage(frames, 'a', '2026-07-20T01:00:00Z', mk);
    expect(plan.ok).toBe(true);
    expect(plan.targetStage).toBe('a');
    // b·c supersede(2) + 되감기 기록(1) = 3 append
    const superseded = plan.framesToAppend.filter((f) => f.status === 'superseded');
    expect(superseded.map((f) => f.stage).sort()).toEqual(['b', 'c']);
    expect(plan.framesToAppend[plan.framesToAppend.length - 1]!.op).toBe('goto');
  });
  test('rewind — 활성 프레임 없으면 ok:false', () => {
    expect(rewind([], 1, 'now', mk).ok).toBe(false);
  });
  test('gotoStage — done 프레임 없으면 ok:false', () => {
    expect(gotoStage([frame(1, 'a', { status: 'failed' })], 'a', 'now', mk).ok).toBe(false);
  });
});
