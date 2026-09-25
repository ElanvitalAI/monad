import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runScreens, recordDaily, isStock, reportMd, type ScreenResult } from './conatus-screen.js';

// ── 결정론 픽스처: 임시 CONATUS_DATA_DIR + 6 거래일 fake bulk 파일 ──────────────
//
// 손계산 가능한 소수 종목으로 rs/value/rolling-count/flag/멤버십 검증.
// 거래일(모두 평일): 6/15~6/22 (6/20 토·6/21 일 skip). end=2026-06-22, days=6.

const DATES = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-22'];

// code -> {closes(6일), vol(최종일 거래량), name, ex, type}
// ⚠️ 모든 비율은 이진 정확값(1.25/1.5/0.8/0.75/1.125)만 사용 — 부동소수 경계(예: 1.2→19.9999)
//    회피해 손계산 기대치를 명확히. (경계 float 거동 자체는 python↔TS 파리티에서 이미 일치 확인.)
const FIX: Record<string, { closes: number[]; vol: number; name: string; ex: 'KO' | 'KQ'; type: string }> = {
  // Alpha: [80,100,80,120,120,150] → 주간수익률 [+25,-20,+50,0,+25]
  //   n15=3 n20=3 nlimit=1(+50) ncrash=1(-20) · chg=+25 · ddPeak=0 · 🟢양호 · value=150*1000
  '000001': { closes: [80, 100, 80, 120, 120, 150], vol: 1000, name: 'Alpha Corp', ex: 'KO', type: 'Common Stock' },
  // Beta: [200,160,120,120,120,120] → [-20,-25,0,0,0]
  //   ncrash=2 → 🔴제외 · chg=0 · ddPeak=(120/160-1)=-25.0(peak=160)
  '000002': { closes: [200, 160, 120, 120, 120, 120], vol: 500, name: 'Beta Ltd', ex: 'KO', type: 'Common Stock' },
  // Gamma(KOSDAQ): [80,80,80,80,80,90] → [0,0,0,0,+12.5] · chg=+12.5 · ddPeak=0 · 🟢양호
  '100001': { closes: [80, 80, 80, 80, 80, 90], vol: 2000, name: 'Gamma Tech', ex: 'KQ', type: 'Common Stock' },
  // ETF(이름 KODEX) → isStock 배제
  '000003': { closes: [10, 11, 12, 13, 14, 15], vol: 100, name: 'KODEX 200', ex: 'KO', type: 'ETF' },
  // 우선주(type Preferred) → isStock 배제
  '000004': { closes: [90, 91, 92, 93, 94, 95], vol: 100, name: 'Alpha Corp Pref', ex: 'KO', type: 'Preferred Share' },
};

let dataDir: string;
let prevEnv: string | undefined;

beforeAll(() => {
  prevEnv = process.env.CONATUS_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'conatus-screen-test-'));
  const cache = join(dataDir, 'cache');
  mkdirSync(cache, { recursive: true });
  process.env.CONATUS_DATA_DIR = dataDir;

  // bulk 파일(거래소별·날짜별). date-integrity guard 위해 각 행 date 정확히 기입.
  for (let di = 0; di < DATES.length; di++) {
    const date = DATES[di]!;
    for (const ex of ['KO', 'KQ'] as const) {
      const rows = Object.entries(FIX)
        .filter(([, v]) => v.ex === ex)
        .map(([code, v]) => {
          const c = v.closes[di]!;
          return {
            code, exchange_short_name: ex, date,
            open: c, high: c, low: c, close: c, adjusted_close: c, volume: v.vol,
          };
        });
      writeFileSync(join(cache, `bulk_${ex}_${date}.json`), JSON.stringify(rows));
    }
  }
  // ticker_map (주간 캐시·mtime 방금 → refetch 안 함)
  const tm: Record<string, { name: string; exchange: string; type: string }> = {};
  for (const [code, v] of Object.entries(FIX)) {
    tm[code] = { name: v.name, exchange: v.ex === 'KO' ? 'KOSPI' : 'KOSDAQ', type: v.type };
  }
  writeFileSync(join(cache, 'ticker_map.json'), JSON.stringify(tm));
});

afterAll(() => {
  if (prevEnv === undefined) delete process.env.CONATUS_DATA_DIR;
  else process.env.CONATUS_DATA_DIR = prevEnv;
  if (dataDir && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
});

function run(): ScreenResult {
  return runScreens({ days: 6, end: '2026-06-22', includeInvestor: false });
}

describe('isStock — 공통주 필터(screen.py _is_stock)', () => {
  test('Common Stock 통과', () => {
    expect(isStock({ type: 'Common Stock', name: 'Alpha Corp' })).toBe(true);
  });
  test('type 공백이면 이름검사만', () => {
    expect(isStock({ type: '', name: 'Some Co' })).toBe(true);
  });
  test('ETF/KODEX 이름 배제', () => {
    expect(isStock({ type: 'ETF', name: 'KODEX 200' })).toBe(false);
    expect(isStock({ type: '', name: 'TIGER 반도체' })).toBe(false);
  });
  test('non-common type 배제(우선주)', () => {
    expect(isStock({ type: 'Preferred Share', name: 'Alpha Corp Pref' })).toBe(false);
  });
});

describe('runScreens — 시장방향·rs·value(하드 계산)', () => {
  test('공통주만 카운트(ETF/우선주 제외) → n=3', () => {
    expect(run().n).toBe(3);
  });
  test('시장방향 = 거래소별 평균등락', () => {
    const m = run().market;
    // KOSPI: mean(Alpha +25, Beta 0) = +12.5 · KOSDAQ: +12.5(감마만)
    expect(m.KOSPI).toBeCloseTo(12.5, 4);
    expect(m.KOSDAQ).toBeCloseTo(12.5, 4);
  });
  test('value = close*volume · rs = chg - mkt · impact = |chg|*value', () => {
    const out = run();
    const alpha = out.rows.get('000001')!;
    expect(alpha.value).toBe(150 * 1000);
    expect(alpha.chgPct).toBeCloseTo(25, 4);
    expect(alpha.rs).toBeCloseTo(25 - 12.5, 4); // +12.5
    expect(alpha.impact).toBeCloseTo(25 * 150000, 2);
    const beta = out.rows.get('000002')!;
    expect(beta.chgPct).toBeCloseTo(0, 4);
    expect(beta.rs).toBeCloseTo(0 - 12.5, 4); // -12.5
  });
});

describe('runScreens — 주간 롤링 카운트 + 플래그', () => {
  test('Alpha: n15/n20/nlimit/ncrash/ddPeak/flag', () => {
    const m = run().mom.get('000001')!;
    // 주간 [+25,-20,+50,0,+25]
    expect(m.n15).toBe(3); // +25,+50,+25
    expect(m.n20).toBe(3); // +25,+50,+25
    expect(m.nlimit).toBe(1); // +50 (>=29)
    expect(m.ncrash).toBe(1); // -20 (<=-10)
    expect(m.ddPeak).toBeCloseTo(0, 4); // peak=150=last
    expect(m.flag).toBe('🟢양호');
    expect(m.excluded).toBe(false);
  });
  test('Beta: ncrash>=2 → 🔴제외 · ddPeak 고점대비', () => {
    const m = run().mom.get('000002')!;
    // 주간 [-20,-25,0,0,0]
    expect(m.ncrash).toBe(2); // -20, -25
    expect(m.n15).toBe(0);
    expect(m.ddPeak).toBeCloseTo(-25, 4); // (120/160-1)*100 · peak=160(최근5일)
    expect(m.flag).toBe('🔴제외');
    expect(m.excluded).toBe(true);
  });
  test('Gamma: 급등 없음 → 🟢양호', () => {
    const m = run().mom.get('100001')!;
    // 주간 [0,0,0,0,+12.5]
    expect(m.n15).toBe(0); // 12.5 < 15
    expect(m.n20).toBe(0);
    expect(m.nlimit).toBe(0);
    expect(m.ncrash).toBe(0);
    expect(m.ddPeak).toBeCloseTo(0, 4);
    expect(m.flag).toBe('🟢양호');
  });
});

describe('runScreens — 스크린 멤버십(결정론적 code tie-break)', () => {
  test('volTop = value 내림차순', () => {
    // Gamma 154000 > Alpha 143000 > Beta 70000
    expect(run().screens.volTop).toEqual(['100001', '000001', '000002']);
  });
  test('gainTop = chg 내림차순', () => {
    // Alpha +25, Gamma +12.5, Beta 0
    expect(run().screens.gainTop).toEqual(['000001', '100001', '000002']);
  });
  test('outperformers = rs>0', () => {
    expect(run().screens.outperformers).toEqual(['000001']); // Gamma rs=0(제외)
  });
  test('kospi10 = KOSPI & chg>=10', () => {
    expect(run().screens.kospi10).toEqual(['000001']); // Alpha +25
  });
  test('capMovers = impact 내림차순', () => {
    // Alpha 25*150000=3.75M > Gamma 12.5*180000=2.25M > Beta 0
    expect(run().screens.capMovers).toEqual(['000001', '100001', '000002']);
  });
  test('momMajor = (n20>=2||nlimit>=1) & !excluded', () => {
    expect(run().screens.momMajor).toEqual(['000001']);
  });
  test('momCandidate = n15>=2 minus major (Alpha 이미 major) → []', () => {
    expect(run().screens.momCandidate).toEqual([]);
  });
  test('momExcluded = major/cand 파티션의 제외분(Beta 는 필터 미통과 → 없음)', () => {
    expect(run().screens.momExcluded).toEqual([]);
  });
});

describe('reportMd — 텔레그램 마크다운', () => {
  test('헤더·섹션 렌더', () => {
    const md = reportMd(run());
    expect(md).toContain('📊 *한국시장 스크리너* ─ 2026-06-22');
    expect(md).toContain('KOSPI');
    expect(md).toContain('💰 *거래대금 상위*');
    expect(md).toContain('🔥 *주요 와칭*'); // Alpha 가 momMajor
  });
});

describe('recordDaily — 격리 DB WRITE(SAFETY)', () => {
  test('prices/screen 카운트 + 멤버십 문자열', () => {
    const out = run();
    const dbPath = join(dataDir, 'isolated-screener.db');
    const res = recordDaily(out, dbPath);
    expect(res.date).toBe('2026-06-22');
    expect(res.prices).toBe(5); // 전 종목(ETF/우선주 포함) close notna
    expect(res.screen).toBe(3); // 스크린 등장 union = Alpha/Beta/Gamma

    const db = new Database(dbPath, { readonly: true });
    const row = db.query('SELECT screens, flag, n15 FROM screen WHERE code=?').get('000001') as
      { screens: string; flag: string; n15: number };
    // Alpha 소속: cap_movers,gain_top,kospi_10,mom_major,outperformers,vol_top (sorted)
    expect(row.screens).toBe('cap_movers,gain_top,kospi_10,mom_major,outperformers,vol_top');
    expect(row.flag).toBe('🟢양호');
    expect(row.n15).toBe(3);
    db.close();
  });
});
