// 속보 동일뉴스 다중소스 dedup (2026-07-06 대표 지적 — 독일 재무장 3중 발송).
// 실사례 변형("- FT" / "(@handle)" / "- FT.|FJ")이 접히고, 다른 뉴스는 안 접히는지.

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isNearDuplicate, dedupeByText, recentAlertedTexts, openSignalsDb,
} from '../src/domains/breaking-signals.js';

// 2026-07-06 실제 초긴급 3중 발송 원문
const GERMANY = [
  'GERMANY TO BORROW €800BN FOR REARMAMENT IN HISTORIC SHIFT - FT',
  'GERMANY TO BORROW €800BN FOR REARMAMENT IN HISTORIC SHIFT - FT (@WalterBloomberg)',
  'Germany is going to borrow €800 bln for rearmament in historic shift - FT.|FJ',
];

describe('breaking signals dedup', () => {
  test('temporary database handle sets busy_timeout to 2000ms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'signals-store-test-'));
    const db = openSignalsDb(join(dir, 'signals.db'));
    const timeout = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    expect(timeout.timeout).toBe(2000);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('실사례: 독일 재무장 3변형은 서로 근사중복', () => {
    expect(isNearDuplicate(GERMANY[0]!, GERMANY[1]!)).toBe(true);
    expect(isNearDuplicate(GERMANY[0]!, GERMANY[2]!)).toBe(true);
    expect(isNearDuplicate(GERMANY[1]!, GERMANY[2]!)).toBe(true);
  });

  test('다른 뉴스는 접히지 않음', () => {
    expect(isNearDuplicate(GERMANY[0]!, 'FED HOLDS RATES STEADY, SIGNALS TWO CUTS THIS YEAR')).toBe(false);
    expect(isNearDuplicate(GERMANY[0]!, 'SAMSUNG ELECTRONICS Q2 OPERATING PROFIT BEATS ESTIMATES')).toBe(false);
    // 같은 주제·다른 사건 (국가/금액 다름)
    expect(isNearDuplicate(GERMANY[0]!, 'POLAND TO RAISE DEFENSE SPENDING TO 5% OF GDP NEXT YEAR')).toBe(false);
  });

  test('dedupeByText: 첫 항목 유지 + 접힌 소스 수', () => {
    const items = [...GERMANY, 'FED HOLDS RATES STEADY'].map((text, i) => ({ text, i }));
    const out = dedupeByText(items, x => x.text);
    expect(out.length).toBe(2);
    expect(out[0]!.item.i).toBe(0);       // 첫 소스 유지
    expect(out[0]!.sources).toBe(3);      // 3개 소스 접힘
    expect(out[1]!.sources).toBe(1);
  });

  test('recentAlertedTexts: 시간창 내 alerted=1만', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dedup-test-'));
    const db = openSignalsDb(join(dir, 's.db'));
    const ins = db.prepare(`INSERT INTO signals(id, ts, text, alerted) VALUES (?,?,?,?)`);
    ins.run('a', new Date().toISOString(), GERMANY[0], 1);
    ins.run('b', new Date().toISOString(), 'not alerted', 0);
    ins.run('c', new Date(Date.now() - 24 * 3600_000).toISOString(), 'old alerted', 1);
    const texts = recentAlertedTexts(db, 12);
    expect(texts).toEqual([GERMANY[0]!]);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
