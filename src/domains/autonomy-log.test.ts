// Autonomy log (Autopilot P0) 단위테스트 — 인메모리 surface_events(무네트워크).
import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  recordAutonomousAction, recallAutonomy, recentAutonomyDigest,
  AUTONOMY_DOMAIN, AUTONOMY_KIND,
} from './autonomy-log.js';
import { openSurfaceEventsDb, queryEvents } from './surface-events.js';
import { recallSelfEvents } from './self-awareness.js';

function surfaceDb(): Database {
  return openSurfaceEventsDb(':memory:');
}

describe('recordAutonomousAction — 자율행동 주입', () => {
  test('domain=elanous·kind=autonomy·surface=loop:<loop> 기록 + rationale 를 text 에 포함', () => {
    const db = surfaceDb();
    const id = recordAutonomousAction(db, {
      loop: 'trade',
      action: 'SELL 1 삼성 LIMIT @291,500',
      rationale: '국면 BEAR_CASH 방어',
      outcome: 'FILLED orderId 6_VH2I8',
      refs: { orderId: '6_VH2I8' },
    });
    expect(id).toBeTruthy();
    const rows = queryEvents(db, { domain: AUTONOMY_DOMAIN });
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.surface).toBe('loop:trade');
    expect(r.direction).toBe('outbound');
    expect(r.kind).toBe(AUTONOMY_KIND);
    expect(r.domain).toBe('elanous');
    expect(r.category).toBe('autonomy');
    expect(r.importance).toBe(8);            // trade 루프 기본 현저성
    expect(r.text).toContain('why: 국면 BEAR_CASH 방어');
    expect(r.text).toContain('outcome: FILLED');
    expect(r.tags).toContain('loop:trade');
    expect(r.refs).toContain('6_VH2I8');
    db.close();
  });

  test('루프별 기본 현저성 + importance override', () => {
    const db = surfaceDb();
    recordAutonomousAction(db, { loop: 'dig', action: 'A', rationale: 'r' });
    recordAutonomousAction(db, { loop: 'replay', action: 'B', rationale: 'r', importance: 9 });
    const rows = queryEvents(db, { domain: AUTONOMY_DOMAIN });
    const byLoop = Object.fromEntries(rows.map(r => [r.surface, r.importance]));
    expect(byLoop['loop:dig']).toBe(5);       // dig 기본
    expect(byLoop['loop:replay']).toBe(9);    // override
    db.close();
  });

  test('outcome/refs 없이도 기록(선택 필드)', () => {
    const db = surfaceDb();
    const id = recordAutonomousAction(db, { loop: 'retro', action: '주간 회고', rationale: '성과 집계' });
    expect(id).toBeTruthy();
    const r = queryEvents(db, { domain: AUTONOMY_DOMAIN })[0]!;
    expect(r.text).not.toContain('outcome:');
    expect(r.refs).toBeNull();
    db.close();
  });
});

describe('recallAutonomy — 자율행동 회상', () => {
  test('kind=autonomy 만 회상 + loop 필터', () => {
    const db = surfaceDb();
    recordAutonomousAction(db, { loop: 'trade', action: '삼성 매도', rationale: '방어' });
    recordAutonomousAction(db, { loop: 'dig', action: '반도체 디깅', rationale: '급락 조사' });
    // 잡음: 다른 kind(발송) — 회상되면 안 됨.
    recordAutonomousAction(db, { loop: 'backtest', action: 'XA 백테스트', rationale: '가설 검증' });

    const all = recallAutonomy(db, '', { limit: 10 });
    expect(all.length).toBe(3);
    expect(all.every(h => h.kind === AUTONOMY_KIND)).toBe(true);

    const digOnly = recallAutonomy(db, '', { loop: 'dig', limit: 10 });
    expect(digOnly.length).toBe(1);
    expect(digOnly[0]!.surface).toBe('loop:dig');
    db.close();
  });

  test('self_recall(recallSelfEvents)가 자율행동을 impl 과 함께 회상(P0.3 통합)', () => {
    const db = surfaceDb();
    recordAutonomousAction(db, { loop: 'trade', action: '삼성 매도 자율집행', rationale: 'BEAR_CASH' });
    // domain=elanous 이므로 self_recall 이 집어야 한다.
    const hits = recallSelfEvents(db, '삼성', { bump: false });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some(h => h.surface === 'loop:trade')).toBe(true);
    db.close();
  });
});

describe('recentAutonomyDigest — ambient 다이제스트', () => {
  test('행동 없으면 빈 문자열', () => {
    const db = surfaceDb();
    expect(recentAutonomyDigest(db)).toBe('');
    db.close();
  });

  test('최근 자율행동 요약 라인', () => {
    const db = surfaceDb();
    recordAutonomousAction(db, { loop: 'trade', action: '삼성 매도', rationale: '방어' });
    const digest = recentAutonomyDigest(db, { sinceHours: 24 });
    expect(digest).toContain('최근 자율행동');
    expect(digest).toContain('삼성 매도');
    db.close();
  });
});
