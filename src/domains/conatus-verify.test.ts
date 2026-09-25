import { test, expect, describe } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  verifyRiskBounds,
  checkRiskInvariants,
  readRiskBounds,
  screenerDir,
  verifyPosition,
  verifyExposure,
  verifyOrderFilled,
  matchOrder,
  verifyOneOrder,
  type RiskBoundsConfig,
} from './conatus-verify.js';

// ══════════════════════════════════════════════════════════════════════════
// I. verifyRiskBounds — DETERMINISTIC python 파리티 + 불변식 유닛
//    파리티는 라이브 risk_bounds.json(브로커 무접촉·순수 config)에서만 성립.
// ══════════════════════════════════════════════════════════════════════════

describe('verifyRiskBounds', () => {
  // ── 결정론 파리티: python verify_risk_bounds.py --check vs TS ─────────────
  // 같은 risk_bounds.json 에 대해 exit code(0↔ok) 일치. 브로커 조회 없음 → 결정론.
  test('DETERMINISTIC parity vs verify_risk_bounds.py on live risk_bounds.json', () => {
    const py = join(homedir(), '.pyenv/versions/3.12.12/bin/python3');
    const script = join(screenerDir(), 'verify_risk_bounds.py');
    if (!existsSync(py) || !existsSync(script)) {
      // 파이썬/스크립트 부재 환경(CI 등)에서는 파리티 skip — 유닛은 그대로 검증.
      console.warn('[parity] python/script 부재 → risk-bounds 파리티 skip');
      return;
    }
    // python exit code 회수 (0=OK, 1=violation, 2=config)
    let pyCode = 0;
    let pyOut = '';
    try {
      pyOut = execFileSync(py, [script, '--check'], { encoding: 'utf-8' });
    } catch (e: any) {
      pyCode = typeof e?.status === 'number' ? e.status : -1;
      pyOut = `${e?.stdout ?? ''}${e?.stderr ?? ''}`;
    }

    const ts = verifyRiskBounds(readRiskBounds());

    // exit 0 ↔ ok:true, 그리고 code 자체가 동형이어야 한다.
    expect(ts.code).toBe(pyCode as 0 | 1 | 2);
    expect(ts.ok).toBe(pyCode === 0);
    // 위반 유무 파리티: python 은 위반 시 "FAIL", 통과 시 "OK" 를 출력.
    if (ts.violations.length > 0) {
      expect(pyOut).toContain('FAIL');
    } else {
      expect(pyOut).toContain('OK');
    }
  });

  test('I1/I2 통과 (현행 risk_bounds.json 형상)', () => {
    const cfg: RiskBoundsConfig = {
      breakeven_usd: 540.0,
      active_full_exit_stop_usd: 571,
      trailing_stops_usd: { trim25: 610, trim50: 591, full_exit: 571 },
    };
    const r = verifyRiskBounds(cfg);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.violations).toEqual([]);
  });

  test('I1 위반: 전량 손절선 < 본전 (571→500)', () => {
    const r = verifyRiskBounds({ breakeven_usd: 540, active_full_exit_stop_usd: 500 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]).toContain('I1 위반');
  });

  test('I2 위반: 사다리 비단조 (trim25<trim50)', () => {
    const r = verifyRiskBounds({
      breakeven_usd: 540,
      active_full_exit_stop_usd: 571,
      trailing_stops_usd: { trim25: 591, trim50: 610, full_exit: 571 },
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.violations[0]).toContain('I2 위반');
    expect(r.violations[0]).toContain('비단조');
  });

  test('I2 위반: 사다리 full_exit < 본전 (단조는 만족)', () => {
    const r = verifyRiskBounds({
      breakeven_usd: 540,
      active_full_exit_stop_usd: 571,
      trailing_stops_usd: { trim25: 610, trim50: 591, full_exit: 500 },
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    // 단조(610>591>500)는 만족 → 비단조 아님, full_exit<본전만 위반
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]).toContain('사다리 full_exit $500 < 본전 $540');
  });

  test('config 불완전: full_exit 누락 → 위반 1건(code 1)', () => {
    const r = verifyRiskBounds({ breakeven_usd: 540 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.violations[0]).toContain('config 불완전');
  });

  test('config 없음/손상(null) → fail-closed code 2', () => {
    const r = verifyRiskBounds(null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(2);
  });

  test('checkRiskInvariants: 0 은 null 로 취급 안 함 (breakeven 0 유효)', () => {
    // python `is None` 동형 — 0 은 유효값. full_exit 0 >= be 0 → 통과.
    const v = checkRiskInvariants({ breakeven_usd: 0, active_full_exit_stop_usd: 0 });
    expect(v).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// II. verifyPosition — 픽스처 유닛 (라이브 브로커 파리티 아님 · 비결정론이라 제외)
//     기대치는 verify_position.py cmd_check 로직에서 손계산.
// ══════════════════════════════════════════════════════════════════════════

describe('verifyPosition', () => {
  test('정합: 실보유 == 기대 → code 0', () => {
    const r = verifyPosition({ KORU: 36 }, { positions: { KORU: 36 } });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.drift).toEqual([]);
  });

  test('드리프트: 수량 불일치 → code 1', () => {
    const r = verifyPosition({ KORU: 30 }, { positions: { KORU: 36 } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.drift[0]).toBe('KORU: 기대 36주 != 실보유 30주');
  });

  test('드리프트: 기대 종목 미보유(실보유 0) → code 1', () => {
    const r = verifyPosition({}, { positions: { KORU: 36 } });
    expect(r.code).toBe(1);
    expect(r.drift[0]).toBe('KORU: 기대 36주 != 실보유 0주');
  });

  test('드리프트: 미선언 보유(qty>0, 매니페스트에 없음) → code 1', () => {
    const r = verifyPosition({ '005930': 10 }, { positions: {} });
    expect(r.code).toBe(1);
    expect(r.drift[0]).toBe('005930: 미선언 보유 10주 (매니페스트에 없음)');
  });

  test('미선언이라도 qty 0 이면 적신호 아님 (python qty>0 조건)', () => {
    const r = verifyPosition({ '005930': 0 }, { positions: {} });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  });

  test('매니페스트 없음(null) → fail-closed code 2', () => {
    const r = verifyPosition({ KORU: 36 }, null);
    expect(r.code).toBe(2);
  });

  test('브로커 조회 실패(actual null) → fail-closed code 3', () => {
    const r = verifyPosition(null, { positions: { KORU: 36 } });
    expect(r.code).toBe(3);
  });

  test('매니페스트+브로커 둘 다 실패 → python 순서상 code 2(매니페스트 먼저)', () => {
    const r = verifyPosition(null, null);
    expect(r.code).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// III. verifyExposure — 픽스처 유닛 (라이브 파리티 아님)
//      equity=Σ(qty×price)+cash · effective=Σ(value×lev) · ratioPct=eff/eq×100.
//      전부 verify_exposure.py compute_exposure 공식에서 손계산.
// ══════════════════════════════════════════════════════════════════════════

describe('verifyExposure', () => {
  const lev3 = { gross_cap_pct: 150, leverage: { KORU: 3 } };

  test('상한 이내: KORU 10@100 + cash 10000, lev3 → ratioPct 27.27% ≤ 150 → code 0', () => {
    // value=1000, eff=3000, equity=1000+10000=11000, ratioPct=3000/11000*100=27.27%
    const r = verifyExposure([{ symbol: 'KORU', quantity: 10 }], { KORU: 100 }, 10000, lev3);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.effective).toBe(3000);
    expect(r.equity).toBe(11000);
    expect(r.ratioPct).toBeCloseTo(27.2727, 3);
    expect(r.ratio).toBeCloseTo(0.272727, 5);
    expect(r.breaches).toEqual([]);
  });

  test('BREACH(block): KORU 36@100 cash 0 lev3 → eff 10800 / eq 3600 = 300% > 150 → code 1', () => {
    // value=3600, eff=10800, equity=3600, ratioPct=300%
    const r = verifyExposure([{ symbol: 'KORU', quantity: 36 }], { KORU: 100 }, 0, lev3);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.effective).toBe(10800);
    expect(r.equity).toBe(3600);
    expect(r.ratioPct).toBeCloseTo(300, 6);
    expect(r.ratio).toBeCloseTo(3, 6);
    expect(r.breaches[0]).toContain('총 노출');
  });

  test('BREACH(warn): on_breach=warn 이면 초과라도 통과 code 0', () => {
    const r = verifyExposure(
      [{ symbol: 'KORU', quantity: 36 }],
      { KORU: 100 },
      0,
      { gross_cap_pct: 150, leverage: { KORU: 3 }, on_breach: 'warn' },
    );
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.breaches.length).toBe(1); // 사유는 기록되되 통과
  });

  test('종목당 상한 BREACH: gross 는 여유(1000%)지만 per_symbol_cap 100% 초과 → code 1', () => {
    // KORU eff 10800 / eq 3600 = 300% > 종목당 100%, gross 1000% 는 통과
    const r = verifyExposure(
      [{ symbol: 'KORU', quantity: 36 }],
      { KORU: 100 },
      0,
      { gross_cap_pct: 1000, per_symbol_cap_pct: 100, leverage: { KORU: 3 } },
    );
    expect(r.code).toBe(1);
    expect(r.breaches[0]).toContain('종목 KORU');
  });

  test('레버리지 미지정 종목 = 1배 (python leverage.get(sym,1))', () => {
    // 005930 2@100 lev=1 → value 200 eff 200; equity 200+800=1000; ratioPct 20%
    const r = verifyExposure([{ symbol: '005930', quantity: 2 }], { '005930': 100 }, 800, { gross_cap_pct: 150 });
    expect(r.effective).toBe(200);
    expect(r.equity).toBe(1000);
    expect(r.ratioPct).toBeCloseTo(20, 6);
    expect(r.code).toBe(0);
  });

  test('qty<=0 종목은 skip (python continue)', () => {
    const r = verifyExposure(
      [
        { symbol: 'KORU', quantity: 0 },
        { symbol: '005930', quantity: 2 },
      ],
      { KORU: 100, '005930': 100 },
      800,
      { gross_cap_pct: 150 },
    );
    // KORU skip → perSymbol 에 005930 만
    expect(Object.keys(r.perSymbol)).toEqual(['005930']);
    expect(r.effective).toBe(200);
  });

  test('순자산 <= 0 → fail-closed code 3', () => {
    const r = verifyExposure([], {}, 0, { gross_cap_pct: 150 });
    expect(r.code).toBe(3);
  });

  test('config 없음(null) → fail-closed code 2', () => {
    const r = verifyExposure([{ symbol: 'KORU', quantity: 10 }], { KORU: 100 }, 10000, null);
    expect(r.code).toBe(2);
  });

  test('gross_cap_pct 기본값 150 (미지정)', () => {
    // eff 3000 / eq 1000 = 300% > 기본 150 → BREACH
    const r = verifyExposure([{ symbol: 'KORU', quantity: 10 }], { KORU: 100 }, 0, { leverage: { KORU: 3 } });
    expect(r.code).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// IV. verifyOrderFilled — 픽스처 유닛 (라이브 파리티 아님)
//     매칭(orderId 우선 → symbol/side/qty) + FILLED + 체결수량 정합. python 손계산.
// ══════════════════════════════════════════════════════════════════════════

describe('verifyOrderFilled', () => {
  test('통과: orderId 매칭 + FILLED + 수량정합 → code 0', () => {
    const r = verifyOrderFilled(
      [{ orderId: 'X', symbol: '005930', side: 'SELL', quantity: 100, status: 'FILLED', execution: { filledQuantity: 100 } }],
      [{ orderId: 'X', quantity: 100 }],
    );
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  });

  test('통과: (symbol,side,qty) 매칭 fallback', () => {
    const r = verifyOrderFilled(
      [{ symbol: '005930', side: 'SELL', quantity: 5, status: 'FILLED', execution: { filledQuantity: 5 } }],
      [{ symbol: '005930', side: 'SELL', quantity: 5 }],
    );
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  });

  test('불일치: 체결수량 != 선언 → code 1', () => {
    const r = verifyOrderFilled(
      [{ orderId: 'X', status: 'FILLED', execution: { filledQuantity: 50 } }],
      [{ orderId: 'X', quantity: 100 }],
    );
    expect(r.code).toBe(1);
    expect(r.mismatches[0]).toContain('체결수량 50 != 선언 100');
  });

  test('미체결: status != FILLED → code 1', () => {
    const r = verifyOrderFilled(
      [{ orderId: 'X', status: 'CANCELED', execution: null }],
      [{ orderId: 'X', quantity: 100 }],
    );
    expect(r.code).toBe(1);
    expect(r.mismatches[0]).toContain('status=CANCELED');
  });

  test('이력에 없음: 매칭 실패 → code 1', () => {
    const r = verifyOrderFilled([], [{ orderId: 'Z', quantity: 1 }]);
    expect(r.code).toBe(1);
    expect(r.mismatches[0]).toContain('체결 이력에 없음');
  });

  test('명시적 빈 의도 배열 → 검증할 주문 없음 → code 0', () => {
    const r = verifyOrderFilled([{ orderId: 'X', status: 'FILLED' }], []);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  });

  test('의도 파일 없음(null) → fail-closed code 2', () => {
    const r = verifyOrderFilled([], null);
    expect(r.code).toBe(2);
  });

  test('브로커 조회 실패(null, 의도 non-empty) → fail-closed code 3', () => {
    const r = verifyOrderFilled(null, [{ orderId: 'X', quantity: 1 }]);
    expect(r.code).toBe(3);
  });

  test('python 순서: 의도 빈배열이면 브로커 null 이라도 통과 code 0', () => {
    const r = verifyOrderFilled(null, []);
    expect(r.code).toBe(0);
  });

  test('matchOrder: orderId 우선(같은 symbol 여러건 중 정확 매칭)', () => {
    const orders = [
      { orderId: 'A', symbol: '005930', side: 'BUY', quantity: 1, status: 'FILLED' },
      { orderId: 'B', symbol: '005930', side: 'BUY', quantity: 1, status: 'CANCELED' },
    ];
    expect(matchOrder({ orderId: 'B' }, orders)?.orderId).toBe('B');
  });

  test('verifyOneOrder: quantity 미선언(-1 기본)이면 수량검사 skip', () => {
    // want=-1 → want>=0 false → 수량 불일치 검사 안 함. FILLED 면 통과.
    const reason = verifyOneOrder({ orderId: 'X' }, { orderId: 'X', status: 'FILLED', execution: { filledQuantity: 999 } });
    expect(reason).toBeNull();
  });
});
