// KR 수급 파서 + 야간 무음(00:00~06:30 KST) 결정론 검증 (대표 지시 2026-07-06).

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { parseInvestorMarkdown, ingestInvestor } from '../src/domains/kr-investor.js';
import { inQuietHours, kstMinutes } from '../src/domains/outbound-alert.js';

const SAMPLE_MD = `## 외국인/기관 매매종목 가집계 [한투API — 장중]

### 외국인 순매수 상위
| 종목명 | 현재가 | 등락률(%) | 순매수(주) |
| --- | --- | --- | --- |
| 기아 | 160,700 | 5.72 | 558,000 |
| S-Oil | 116,900 | 6.08 | 191,000 |

### 기관 순매수 상위
| 종목명 | 현재가 | 등락률(%) | 순매수(주) |
| --- | --- | --- | --- |
| SK하이닉스 | 1,113,000 | 2.59 | 84,000 |
`;

describe('kr-investor ingest', () => {
  test('마크다운 파싱 — 섹션·랭크·수치 (Conatus 스키마 호환)', () => {
    const rows = parseInvestorMarkdown(SAMPLE_MD, '2026-07-06');
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ date: '2026-07-06', type: '외국인', rank: 1, name: '기아', price: 160700, chg_pct: 5.72, net_qty: 558000 });
    expect(rows[2]!.type).toBe('기관');
    expect(rows[2]!.rank).toBe(1); // 섹션 전환 시 랭크 리셋
    expect(rows[2]!.price).toBe(1113000);
  });

  test('DB 적재 멱등 (INSERT OR REPLACE) + dig 트리거 쿼리 호환', () => {
    const dir = mkdtempSync(join(tmpdir(), 'krinv-'));
    const dbPath = join(dir, 'screener.db');
    expect(ingestInvestor(dbPath, SAMPLE_MD, '2026-07-06')).toBe(3);
    expect(ingestInvestor(dbPath, SAMPLE_MD, '2026-07-06')).toBe(3); // 재실행 = 교체
    const db = new Database(dbPath);
    expect((db.prepare(`SELECT COUNT(*) n FROM investor`).get() as any).n).toBe(3);
    // dig-engine 트리거 쿼리 (rank<=2 · |chg_pct|>=5)
    const hits = db.prepare(`SELECT name FROM investor WHERE rank <= 2 AND ABS(chg_pct) >= 5`).all() as any[];
    expect(hits.map(h => h.name).sort()).toEqual(['S-Oil', '기아']);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('빈 응답 → 0건 (기존 데이터 무손상)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'krinv-'));
    const dbPath = join(dir, 's.db');
    expect(ingestInvestor(dbPath, '(수급 데이터 없음)', '2026-07-06')).toBe(0);
    expect(existsSync(dbPath)).toBe(false); // 0건이면 DB 생성도 안 함
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('야간 무음 창 (00:00~06:30 KST)', () => {
  // KST = UTC+9 — UTC 시각으로 결정론 주입
  const atKst = (h: number, m: number) => new Date(Date.UTC(2026, 6, 6, (h - 9 + 24) % 24, m));

  test('경계: 00:00 진입 · 06:29 무음 · 06:30 해제 · 23:59 해제', () => {
    expect(inQuietHours(atKst(0, 0))).toBe(true);
    expect(inQuietHours(atKst(3, 15))).toBe(true);
    expect(inQuietHours(atKst(6, 29))).toBe(true);
    expect(inQuietHours(atKst(6, 30))).toBe(false);
    expect(inQuietHours(atKst(12, 0))).toBe(false);
    expect(inQuietHours(atKst(23, 59))).toBe(false);
  });

  test('kstMinutes 변환 정합', () => {
    expect(kstMinutes(atKst(6, 30))).toBe(390);
    expect(kstMinutes(atKst(0, 5))).toBe(5);
  });
});
