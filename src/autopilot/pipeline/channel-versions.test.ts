// 조율자 격상 P0 조각3 — 채널별 version 파생(세밀 skip/rerun 토대) 검증.
import { test, expect, describe } from 'bun:test';
import { computeChannelVersions, channelVersionsAt, changedChannels, channelsChangedBetween, DECISIONS_CHANNEL } from './channel-versions.js';
import type { PipelineFrame } from './frame-types.js';
import type { BuildStage, BuildAgentResult } from '../mission-build-coordinator.js';

// 최소 프레임 헬퍼 — output(=채널 write)·decisions 스냅샷·superseded 를 제어.
function frame(seq: number, stage: BuildStage, opts: { output?: boolean; decisions?: unknown; superseded?: boolean } = {}): PipelineFrame {
  const output: BuildAgentResult | undefined = opts.output ? { stage, ok: true } : undefined;
  return {
    frameId: `m:${seq}`, missionId: 'm', seq, stageIndex: seq, stage,
    status: opts.superseded ? 'superseded' : 'done',
    timestamp: `2026-07-19T10:${String(seq).padStart(2, '0')}:00.000Z`,
    op: 'push',
    inputsSnapshot: { results: {}, decisions: (opts.decisions ?? {}) as PipelineFrame['inputsSnapshot']['decisions'] },
    version: 0,
    ...(output ? { output } : {}),
    ...(opts.superseded ? { supersededBy: seq + 1 } : {}),
  };
}

describe('channel-versions — 채널별 version 파생(P0 조각3)', () => {
  test('output 있는 프레임이 해당 stage 채널 version +1', () => {
    const frames = [
      frame(0, 'research', { output: true }),
      frame(1, 'ground', { output: true }),
      frame(2, 'decompose', { output: true }),
    ];
    const v = computeChannelVersions(frames);
    expect(v.research).toBe(1);
    expect(v.ground).toBe(1);
    expect(v.decompose).toBe(1);
  });

  test('같은 채널 재실행 시 version 누적(rerun)', () => {
    const frames = [
      frame(0, 'decompose', { output: true }),
      frame(1, 'decompose', { output: true }), // 재분해
    ];
    expect(computeChannelVersions(frames).decompose).toBe(2);
  });

  test('superseded(MESI I) 프레임은 세지 않는다', () => {
    const frames = [
      frame(0, 'decompose', { output: true, superseded: true }), // 무효화됨
      frame(1, 'decompose', { output: true }),
    ];
    expect(computeChannelVersions(frames).decompose).toBe(1); // superseded 제외
  });

  test('output 없는 프레임은 채널 미갱신', () => {
    const frames = [frame(0, 'research', { output: false })];
    expect(computeChannelVersions(frames).research).toBeUndefined();
  });

  test('decisions 변경 시 decisions 채널 version +1', () => {
    const frames = [
      frame(0, 'research', { output: true, decisions: {} }),
      frame(1, 'shape', { output: true, decisions: { scope: 'heavy' } }), // 변경
      frame(2, 'decompose', { output: true, decisions: { scope: 'heavy' } }), // 동일 → 미갱신
    ];
    expect(computeChannelVersions(frames)[DECISIONS_CHANNEL]).toBe(1);
  });

  test('channelVersionsAt — 특정 seq 까지의 기준선', () => {
    const frames = [
      frame(0, 'research', { output: true }),
      frame(1, 'decompose', { output: true }),
      frame(2, 'decompose', { output: true }),
    ];
    expect(channelVersionsAt(frames, 1).decompose).toBe(1);
    expect(channelVersionsAt(frames, 2).decompose).toBe(2);
  });

  test('changedChannels / channelsChangedBetween — 무엇이 바뀌었나(세밀 skip/rerun)', () => {
    const frames = [
      frame(0, 'research', { output: true }),
      frame(1, 'decompose', { output: true }),
      frame(2, 'critique', { output: true }),
    ];
    expect(changedChannels({ research: 1 }, { research: 1, decompose: 1 })).toEqual(['decompose']);
    // seq0 이후 seq2 까지 바뀐 채널 = decompose + critique(research 는 seq0 에 이미 있음)
    expect(channelsChangedBetween(frames, 0, 2).sort()).toEqual(['critique', 'decompose']);
  });
});
