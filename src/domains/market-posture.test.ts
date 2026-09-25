import { describe, expect, test } from 'bun:test';
import type { LeveragePlan } from './capstone-leverage.js';
import type { RegimeVector } from './regime-synth.js';
import {
  DEFAULT_DEFCON_THRESHOLDS,
  MARKET_POSTURE_SCHEMA_VERSION,
  deriveDefcon,
  defconResponseProfile,
  deriveMarketPosture,
  normalizeLeveragedReturn,
  progressiveDefcon,
  tripwireDefcon,
  type DeriveMarketPostureInput,
} from './market-posture.js';

const REGIME: RegimeVector = {
  axes: [],
  composite: -0.3,
  regimeLabel: 'RISK_OFF',
  transition: false,
  transitionAxes: [],
  asOf: '2026-07-16T00:00:00.000Z',
};

const LEVERAGE: LeveragePlan = {
  regime: 'BULL_1X',
  label: 'x',
  targetExposure: 1,
  weights: { stock: 1, lev2x: 0, inverse2x: 0, cash: 0 },
  effectiveExposure: 1,
  note: 'x',
};

function baseInput(overrides: Partial<DeriveMarketPostureInput> = {}): DeriveMarketPostureInput {
  return {
    asOf: '2026-07-16T01:00:00.000Z',
    provenance: { sources: ['test'], calculatedBy: 'unit' },
    freshness: { status: 'FRESH', observedAt: '2026-07-16T00:59:00.000Z', ageMs: 60000 },
    regime: REGIME,
    leverage: LEVERAGE,
    ...overrides,
  };
}

describe('progressiveDefcon — 점진 융합', () => {
  test('no drivers → DEFCON 5 (평시)', () => {
    expect(progressiveDefcon(undefined, DEFAULT_DEFCON_THRESHOLDS)).toBe(5);
    expect(progressiveDefcon([], DEFAULT_DEFCON_THRESHOLDS)).toBe(5);
  });

  test('weighted-average fusion escalates to 4 then 3', () => {
    expect(
      progressiveDefcon([{ key: 'a', contribution: 0.4, weight: 1 }], DEFAULT_DEFCON_THRESHOLDS),
    ).toBe(4);
    expect(
      progressiveDefcon(
        [
          { key: 'a', contribution: 0.9, weight: 2 },
          { key: 'b', contribution: 0.6, weight: 2 },
        ],
        DEFAULT_DEFCON_THRESHOLDS,
      ),
    ).toBe(3);
  });

  test('contribution clamped to [0,1] and invalid weights ignored', () => {
    const level = progressiveDefcon(
      [
        { key: 'bad', contribution: 5, weight: -1 },
        { key: 'zero', contribution: 1, weight: 0 },
        { key: 'ok', contribution: 5, weight: 1 },
      ],
      DEFAULT_DEFCON_THRESHOLDS,
    );
    expect(level).toBe(3);
  });

  test('progressive never produces 2 or 1', () => {
    const level = progressiveDefcon(
      [{ key: 'a', contribution: 1, weight: 1 }],
      DEFAULT_DEFCON_THRESHOLDS,
    );
    expect(level).toBeGreaterThanOrEqual(3);
  });

  // 임계값 경계 직전/직후 (L4=0.33, L3=0.66). score = contribution at weight 1.
  const progBoundary: Array<[number, 5 | 4 | 3]> = [
    [0.32, 5], // L4 직전
    [0.33, 4], // L4 경계
    [0.65, 4], // L3 직전
    [0.66, 3], // L3 경계
  ];
  for (const [contribution, expected] of progBoundary) {
    test(`score ${contribution} boundary -> DEFCON ${expected}`, () => {
      expect(
        progressiveDefcon([{ key: 'k', contribution, weight: 1 }], DEFAULT_DEFCON_THRESHOLDS),
      ).toBe(expected);
    });
  }
});

describe('normalizeLeveragedReturn — 기초자산 등가 변동률', () => {
  test('3x -21% → -7% underlying-equivalent', () => {
    expect(normalizeLeveragedReturn(-0.21, 3)).toBeCloseTo(-0.07, 10);
  });

  test('2x -14% → -7% underlying-equivalent', () => {
    expect(normalizeLeveragedReturn(-0.14, 2)).toBeCloseTo(-0.07, 10);
  });

  test('missing / zero / negative leverage → return unchanged (fail-safe)', () => {
    expect(normalizeLeveragedReturn(-0.07)).toBe(-0.07);
    expect(normalizeLeveragedReturn(-0.07, 0)).toBe(-0.07);
    expect(normalizeLeveragedReturn(-0.07, -2)).toBe(-0.07);
    expect(normalizeLeveragedReturn(-0.07, Number.NaN)).toBe(-0.07);
  });
});

describe('tripwireDefcon — 하드 임계 + 종목별 민감도 보정', () => {
  test('index -5% → DEFCON 2, -10% → DEFCON 1', () => {
    expect(tripwireDefcon({ indices: [{ symbol: 'KOSPI', dayReturn: -0.05 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(2);
    expect(tripwireDefcon({ indices: [{ symbol: 'KOSPI', dayReturn: -0.1 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(1);
  });

  test('circuit breaker → DEFCON 1', () => {
    expect(
      tripwireDefcon({ indices: [{ symbol: 'KOSDAQ', dayReturn: -0.02, circuitBreaker: true }] }, DEFAULT_DEFCON_THRESHOLDS),
    ).toBe(1);
  });

  test('held spot large-cap -7% → DEFCON 2 (경계 직전/경계)', () => {
    expect(tripwireDefcon({ spots: [{ symbol: '005930', dayReturn: -0.069 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(5);
    expect(tripwireDefcon({ spots: [{ symbol: '005930', dayReturn: -0.07 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(2);
    expect(tripwireDefcon({ spots: [{ symbol: '005930', dayReturn: -0.06 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(5);
  });

  test('leveraged ETF 등가 경계 직전/직후 (2x -13.9% vs -14%)', () => {
    expect(tripwireDefcon({ leveragedEtfs: [{ symbol: 'KODEX', dayReturn: -0.139, leverage: 2 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(5);
    expect(tripwireDefcon({ leveragedEtfs: [{ symbol: 'KODEX', dayReturn: -0.14, leverage: 2 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(2);
  });

  test('leveraged ETF normalized before judgment — 3x -7% is NOT a trip', () => {
    expect(tripwireDefcon({ leveragedEtfs: [{ symbol: 'KORU', dayReturn: -0.07, leverage: 3 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(5);
    expect(tripwireDefcon({ leveragedEtfs: [{ symbol: 'KORU', dayReturn: -0.21, leverage: 3 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(2);
    expect(tripwireDefcon({ leveragedEtfs: [{ symbol: 'KODEX', dayReturn: -0.14, leverage: 2 }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(2);
  });

  test('futures limit-down / gap-down → DEFCON 2', () => {
    expect(tripwireDefcon({ futures: [{ symbol: 'ES', limitDown: true }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(2);
    expect(tripwireDefcon({ futures: [{ symbol: 'NQ', gapDown: true }] }, DEFAULT_DEFCON_THRESHOLDS)).toBe(2);
  });

  test('system crisis → DEFCON 1; no trips → DEFCON 5', () => {
    expect(tripwireDefcon({ systemCrisis: true }, DEFAULT_DEFCON_THRESHOLDS)).toBe(1);
    expect(tripwireDefcon(undefined, DEFAULT_DEFCON_THRESHOLDS)).toBe(5);
  });
});

describe('deriveDefcon — progressive + tripwire = 더 심각한 쪽(min)', () => {
  test('takes the more severe of the two paths', () => {
    const level = deriveDefcon({
      drivers: [{ key: 'a', contribution: 0.4, weight: 1 }],
      tripwire: { indices: [{ symbol: 'KOSPI', dayReturn: -0.05 }] },
    });
    expect(level).toBe(2);
  });

  test('progressive alone escalates when no tripwire', () => {
    expect(deriveDefcon({ drivers: [{ key: 'a', contribution: 1, weight: 1 }] })).toBe(3);
  });
});

describe('defconResponseProfile — 5단계 기민성 계약', () => {
  test('severity increases cadence/depth/alerts and only enables sweep at DEFCON 3 or above', () => {
    expect(defconResponseProfile(5)).toEqual({ cadenceMultiplier: 1, depth: 'rules', alertMode: 'batch', emergencySweep: false, gate2HitlRequired: false });
    expect(defconResponseProfile(3)).toEqual({ cadenceMultiplier: 5, depth: 'cross-check', alertMode: 'immediate', emergencySweep: true, gate2HitlRequired: true });
    expect(defconResponseProfile(1)).toEqual({ cadenceMultiplier: 30, depth: 'emergency', alertMode: 'immediate', emergencySweep: true, gate2HitlRequired: true });
  });

  test('profile is alertness-only: it cannot freeze, choose a side, or issue an order', () => {
    const responseKeys = Object.keys(defconResponseProfile(1));
    expect(responseKeys).not.toContain('freezeNewBuys');
    expect(responseKeys).not.toContain('side');
    expect(responseKeys).not.toContain('order');
  });
});

describe('deriveMarketPosture — pure projection + DEFCON', () => {
  test('projects regime/leverage and derives DEFCON deterministically', () => {
    const posture = deriveMarketPosture(
      baseInput({
        drivers: [{ key: 'regime', contribution: 0.4, weight: 1 }],
        tripwire: { leveragedEtfs: [{ symbol: 'KORU', dayReturn: -0.21, leverage: 3 }] },
      }),
    );
    expect(posture.schemaVersion).toBe(MARKET_POSTURE_SCHEMA_VERSION);
    expect(posture.defcon).toBe(2);
    expect(posture.response).toEqual({ cadenceMultiplier: 15, depth: 'deep', alertMode: 'immediate', emergencySweep: true, gate2HitlRequired: true });
    expect(posture.regime.label).toBe('RISK_OFF');
    expect(posture.regime.composite).toBe(-0.3);
    expect(posture.leverage.effectiveExposure).toBe(1);
    expect(Object.keys(posture)).not.toContain('order');
    expect(Object.keys(posture.leverage)).toEqual(['regime', 'effectiveExposure']);
  });

  test('deterministic — same input yields same output; no external state', () => {
    const inp = baseInput({ drivers: [{ key: 'a', contribution: 0.9, weight: 3 }] });
    expect(deriveMarketPosture(inp)).toEqual(deriveMarketPosture(inp));
  });

  test('empty threat inputs → DEFCON 5 (평시)', () => {
    expect(deriveMarketPosture(baseInput()).defcon).toBe(5);
  });
});
