// 활동의존 replay 단위테스트 — 우선순위(importance×recency×novelty) 강화·인메모리·결정론.
import { describe, test, expect } from 'bun:test';
import { openSurfaceEventsDb, recordEvent } from './surface-events.js';
import { activeRecallReplay } from './memory-replay.js';

const NOW = Date.parse('2026-07-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3.6e6).toISOString();

describe('activeRecallReplay — 우선순위 재활성화', () => {
  test('중요·최근·미회상 에피소드가 우선 강화(recall_count++)', () => {
    const db = openSurfaceEventsDb(':memory:');
    // 고중요·최근·미회상 = 우선순위 최상.
    const hot = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'alert', text: '중대 신호', importance: 9, domain: 'finance', ts: hoursAgo(2) });
    // 저중요·오래됨 = 후순위.
    const cold = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: '평범', importance: 2, domain: 'general', ts: hoursAgo(120) });
    recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: '시작 경계', importance: 1, domain: 'start', ts: hoursAgo(168) });
    recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: '종료 경계', importance: 1, domain: 'end', ts: new Date(NOW).toISOString() });
    const future = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'alert', text: '미래 신호', importance: 10, domain: 'future', ts: new Date(NOW + 1).toISOString() });

    // 구현 결함 판정: nowMs 이후 fixture는 점수 보정이 아니라 후보 SQL에서 제외돼야 한다.
    const r = activeRecallReplay(db, { topK: 1, nowMs: NOW });
    expect(r.candidates).toBe(4); // 시작·종료 경계는 포함하고 nowMs 이후만 제외
    expect(r.strengthened).toBe(1);        // topK=1 → 상위 1건만
    expect(r.themes).toEqual(['finance']); // 고중요 finance 가 선택됨

    const hotCount = (db.query(`SELECT recall_count c FROM events WHERE id=?`).get(hot) as { c: number }).c;
    const coldCount = (db.query(`SELECT recall_count c FROM events WHERE id=?`).get(cold) as { c: number }).c;
    const futureCount = (db.query(`SELECT recall_count c FROM events WHERE id=?`).get(future) as { c: number }).c;
    expect(hotCount).toBe(1);              // 강화됨
    expect(coldCount).toBe(0);             // 미강화
    expect(futureCount).toBe(0);           // 미래 후보는 강화되지 않음
    db.close();
  });

  test('novelty — 이미 자주 회상된(recall_count↑) 기억은 후순위(과강화 방지)', () => {
    const db = openSurfaceEventsDb(':memory:');
    const fresh = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'alert', text: '신규', importance: 5, domain: 'a', ts: hoursAgo(3) });
    const familiar = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'alert', text: '익숙', importance: 5, domain: 'b', ts: hoursAgo(3) });
    db.prepare(`UPDATE events SET recall_count = 20 WHERE id = ?`).run(familiar); // 이미 포화

    const r = activeRecallReplay(db, { topK: 1, nowMs: NOW });
    expect(r.strengthened).toBe(1);
    const freshC = (db.query(`SELECT recall_count c FROM events WHERE id=?`).get(fresh) as { c: number }).c;
    expect(freshC).toBe(1);                // 같은 importance/recency 면 novelty 높은 신규가 선택
    db.close();
  });

  test('cold tier 는 replay 제외(흐려진 기억)', () => {
    const db = openSurfaceEventsDb(':memory:');
    const id = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'alert', text: '흐림', importance: 9, domain: 'a', ts: hoursAgo(2) });
    db.prepare(`UPDATE events SET tier='cold' WHERE id=?`).run(id);
    const r = activeRecallReplay(db, { nowMs: NOW });
    expect(r.candidates).toBe(0);          // cold 만 있으면 후보 0
    expect(r.strengthened).toBe(0);
    db.close();
  });

  test('빈 원장 fail-soft', () => {
    const db = openSurfaceEventsDb(':memory:');
    const r = activeRecallReplay(db, { nowMs: NOW });
    expect(r).toEqual({ candidates: 0, strengthened: 0, themes: [] });
    db.close();
  });
});
