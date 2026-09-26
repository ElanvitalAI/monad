// RIF(경쟁 억제 능동망각) 단위테스트 — 승자 있는 클러스터의 warm·미회상·저현저 조기 강등·인메모리.
import { describe, test, expect } from 'bun:test';
import { openSurfaceEventsDb, recordEvent } from './surface-events.js';
import { retrievalInducedForgetting } from './memory-rif.js';

/** warm·recall·importance·domain 지정 이벤트 seed, id 반환. */
function seed(db: ReturnType<typeof openSurfaceEventsDb>, o: { domain: string; recall?: number; imp?: number; tier?: string }): string {
  const id = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: `${o.domain} 발송`, importance: o.imp ?? 3, domain: o.domain });
  db.prepare(`UPDATE events SET recall_count = ?, tier = ? WHERE id = ?`).run(o.recall ?? 0, o.tier ?? 'warm', id);
  return id;
}

describe('retrievalInducedForgetting — 경쟁 억제', () => {
  test('승자(recall≥2) 있는 도메인의 warm·미회상·저현저 → cold 강등', () => {
    const db = openSurfaceEventsDb(':memory:');
    const winner = seed(db, { domain: 'finance', recall: 3, imp: 6 });   // 자주 회상된 승자
    const loser = seed(db, { domain: 'finance', recall: 0, imp: 3 });    // 경쟁 패자(억제 대상)
    const r = retrievalInducedForgetting(db);
    expect(r.suppressed).toBe(1);
    expect((db.query(`SELECT tier FROM events WHERE id=?`).get(loser) as { tier: string }).tier).toBe('cold');
    expect((db.query(`SELECT tier FROM events WHERE id=?`).get(winner) as { tier: string }).tier).toBe('warm'); // 승자 보존
    db.close();
  });

  test('승자 없으면(모두 미회상) 억제 안 함', () => {
    const db = openSurfaceEventsDb(':memory:');
    seed(db, { domain: 'finance', recall: 0, imp: 3 });
    seed(db, { domain: 'finance', recall: 1, imp: 3 });   // recall 1 < winnerRecall 2
    const r = retrievalInducedForgetting(db);
    expect(r.clusters).toBe(0);
    expect(r.suppressed).toBe(0);
    db.close();
  });

  test('회상됐거나(recall>0) 고현저(importance>4)는 억제 제외', () => {
    const db = openSurfaceEventsDb(':memory:');
    seed(db, { domain: 'finance', recall: 3, imp: 6 });                  // 승자
    const recalled = seed(db, { domain: 'finance', recall: 1, imp: 3 }); // 회상된 적 있음 → 보호
    const salient = seed(db, { domain: 'finance', recall: 0, imp: 8 });  // 고현저 → 보호
    const r = retrievalInducedForgetting(db);
    expect(r.suppressed).toBe(0);
    expect((db.query(`SELECT tier FROM events WHERE id=?`).get(recalled) as { tier: string }).tier).toBe('warm');
    expect((db.query(`SELECT tier FROM events WHERE id=?`).get(salient) as { tier: string }).tier).toBe('warm');
    db.close();
  });

  test('다른 도메인의 경쟁 기억은 안 건드림(도메인 스코프)', () => {
    const db = openSurfaceEventsDb(':memory:');
    seed(db, { domain: 'finance', recall: 3, imp: 6 });                  // finance 승자
    const other = seed(db, { domain: 'elanous', recall: 0, imp: 3 });      // elanous(승자 없음)
    const r = retrievalInducedForgetting(db);
    expect((db.query(`SELECT tier FROM events WHERE id=?`).get(other) as { tier: string }).tier).toBe('warm'); // 무접촉
    db.close();
  });
});
