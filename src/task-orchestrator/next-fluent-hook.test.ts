import { describe, it, expect } from 'bun:test';
import { runNextFluentShowroom, type TaskDoneRecord } from './next-fluent-hook.js';
import { createMissionNextActionSource } from '../intent-prediction/next-action-source.js';
import type { ShowroomLaneCallable } from './surfaces/showroom-surface.js';

const record: TaskDoneRecord = {
  refId: 'task:p1', refKind: 'task', finishedSurface: null, outcome: 'failed', completedAt: 1,
};
const failedSrc = createMissionNextActionSource({
  lookupPhase: () => ({ isMissionPhase: true, status: 'failed', hasPr: false, missionCompleted: false, hasCritique: false }),
});

describe('runNextFluentShowroom — 결정론 경로(laneCallable 없음·무비용)', () => {
  it('laneCallable 미주입 → 후보 그대로 제안(endorsedBy none·reason=rationale·transcript 빈)', async () => {
    const card = await runNextFluentShowroom(record, { source: failedSrc, enabled: () => true, now: () => 42 });
    expect(card).not.toBeNull();
    expect(card!.suggestions.map((s) => s.kind)).toEqual(['rebuild', 'split', 'revise', 'skip', 'escalate']);
    expect(card!.suggestions.every((s) => s.endorsedBy === 'none')).toBe(true);
    expect(card!.suggestions[0]!.reason).toContain('재구현');
    expect(card!.transcript).toBe('');
    expect(card!.createdAt).toBe(42);
  });
  it('enabled=false → null(토글 OFF)', async () => {
    expect(await runNextFluentShowroom(record, { source: failedSrc, enabled: () => false })).toBeNull();
  });
  it('후보 0(비미션) → null', async () => {
    const empty = createMissionNextActionSource({ lookupPhase: () => null });
    expect(await runNextFluentShowroom(record, { source: empty, enabled: () => true })).toBeNull();
  });
  it('laneCallable 주입 → 페르소나 endorsement 반영(옵션 경로)', async () => {
    const lane: ShowroomLaneCallable = async () => ({ text: 'rebuild — 이게 최선', modelId: 'local' });
    const card = await runNextFluentShowroom(record, { source: failedSrc, enabled: () => true, laneCallable: lane, now: () => 1 });
    const rebuild = card!.suggestions.find((s) => s.kind === 'rebuild');
    expect(rebuild!.endorsedBy).not.toBe('none'); // 페르소나가 endorse
    expect(card!.transcript).toContain('rebuild');
  });
});
