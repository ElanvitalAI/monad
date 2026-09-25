// 회고 조정 sweep(C4) 단위테스트 — backfill·dedup(idempotent)·fail-soft·인메모리.
import { describe, expect, it } from 'bun:test';
import { openSurfaceEventsDb, queryEvents } from '../domains/surface-events.js';
import {
  sweepMissionRetrospectives,
  existingRetroMissionIds,
  type MissionForRetro,
} from './mission-retrospect.js';

const mission = (id: string): MissionForRetro => ({
  id,
  goal: `골 ${id}`,
  arcs: [{ arcId: 'a1', name: 'arc1', status: 'done', verifyResult: { ok: true } }],
});

describe('sweepMissionRetrospectives — 완료 미션 backfill 회고', () => {
  it('미각인 미션을 회고+각인(mission.retro + mission.feedback)', async () => {
    const db = openSurfaceEventsDb(':memory:');
    const res = await sweepMissionRetrospectives({ missions: [mission('m1'), mission('m2')], db });
    expect(res.scanned).toBe(2);
    expect(res.retrospected.sort()).toEqual(['m1', 'm2']);
    expect(res.skipped).toBe(0);
    // mission.retro 이벤트 2건 각인됨.
    const retros = queryEvents(db, { category: 'mission.retro', limit: 10 });
    expect(retros.length).toBe(2);
    const feedbacks = queryEvents(db, { category: 'mission.feedback', limit: 10 });
    expect(feedbacks.length).toBe(2);
    db.close();
  });

  it('idempotent — 두 번째 sweep 은 이미 각인된 것 skip(중복 각인 없음)', async () => {
    const db = openSurfaceEventsDb(':memory:');
    await sweepMissionRetrospectives({ missions: [mission('m1')], db });
    const second = await sweepMissionRetrospectives({ missions: [mission('m1'), mission('m2')], db });
    expect(second.retrospected).toEqual(['m2']); // m1 은 skip
    expect(second.skipped).toBe(1);
    // mission.retro 총 2건(m1 중복 없음).
    expect(queryEvents(db, { category: 'mission.retro', limit: 10 }).length).toBe(2);
    db.close();
  });

  it('existingRetroMissionIds — 각인된 missionId 집합 회수', async () => {
    const db = openSurfaceEventsDb(':memory:');
    await sweepMissionRetrospectives({ missions: [mission('mX')], db });
    const ids = existingRetroMissionIds(db);
    expect(ids.has('mX')).toBe(true);
    expect(ids.has('nope')).toBe(false);
    db.close();
  });

  it('빈 목록 → no-op', async () => {
    const db = openSurfaceEventsDb(':memory:');
    const res = await sweepMissionRetrospectives({ missions: [], db });
    expect(res).toEqual({ scanned: 0, retrospected: [], skipped: 0 });
    db.close();
  });
});
