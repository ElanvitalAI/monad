import { describe, it, expect } from 'bun:test';
import {
  parseBenchRecords, splitBenchRecords, aggregateRecords, deriveBestPurpose, deriveTier,
  parseParamsB, bytesPerParam, estimateRamGb, buildScoreRows, sortRows,
  formatScoreMap, scoreRowToJson,
  type BenchRecord, type InventoryMeta,
} from './scores.js';

const rec = (p: Partial<BenchRecord> & { model: string; node: string; total: number }): BenchRecord => ({
  at: '2026-07-19T00:00:00.000Z', endpoint: 'http://x:1234', max: 100,
  coding: 0, reasoning: 0, rag: 0, krFormat: 0, ...p,
});

describe('parseBenchRecords', () => {
  it('유효 JSONL 라인만 파싱·손상/비대상 라인 스킵', () => {
    const text = [
      JSON.stringify({ model: 'a', node: 'n', total: 76, coding: 40, reasoning: 20, rag: 8, krFormat: 8 }),
      '',
      '{ broken json',
      JSON.stringify({ notAModel: true }),
      JSON.stringify({ model: 'b', node: 'n', total: 60, coding: 30, reasoning: 15, rag: 8, krFormat: 7 }),
    ].join('\n');
    const out = parseBenchRecords(text);
    expect(out.map((r) => r.model)).toEqual(['a', 'b']);
  });
});

describe('aggregateRecords', () => {
  it('latest = (model,node)별 최근 at', () => {
    const recs = [
      rec({ model: 'a', node: 'n', total: 70, at: '2026-07-18T00:00:00Z' }),
      rec({ model: 'a', node: 'n', total: 90, at: '2026-07-19T00:00:00Z' }),
    ];
    const out = aggregateRecords(recs, 'latest');
    expect(out).toHaveLength(1);
    expect(out[0]!.total).toBe(90);
  });
  it('best = (model,node)별 최고 total', () => {
    const recs = [
      rec({ model: 'a', node: 'n', total: 95, at: '2026-07-18T00:00:00Z' }),
      rec({ model: 'a', node: 'n', total: 90, at: '2026-07-19T00:00:00Z' }),
    ];
    const out = aggregateRecords(recs, 'best');
    expect(out[0]!.total).toBe(95);
  });
  it('같은 모델 다른 노드는 별개 행', () => {
    const recs = [
      rec({ model: 'a', node: 'n1', total: 80 }),
      rec({ model: 'a', node: 'n2', total: 70 }),
    ];
    expect(aggregateRecords(recs, 'latest')).toHaveLength(2);
  });
});

describe('deriveBestPurpose — 카테고리 정규화 최고', () => {
  it('coding 만점 → coding', () => {
    const r = rec({ model: 'a', node: 'n', total: 60, coding: 50, reasoning: 5, rag: 2, krFormat: 3 });
    expect(deriveBestPurpose(r).purpose).toBe('coding');
  });
  it('reasoning 이 상대적으로 우세 → reasoning', () => {
    // coding 25/50=0.5 · reasoning 27/30=0.9 → reasoning
    const r = rec({ model: 'a', node: 'n', total: 60, coding: 25, reasoning: 27, rag: 3, krFormat: 5 });
    expect(deriveBestPurpose(r).purpose).toBe('reasoning');
  });
  it('동점은 coding 우선(헤드라인)', () => {
    // coding 25/50=0.5 · rag 5/10=0.5 → 동점 → coding
    const r = rec({ model: 'a', node: 'n', total: 40, coding: 25, reasoning: 0, rag: 5, krFormat: 0 });
    expect(deriveBestPurpose(r).purpose).toBe('coding');
  });
});

describe('deriveTier — 총점→라우팅 tier', () => {
  it('경계값', () => {
    expect(deriveTier(rec({ model: 'a', node: 'n', total: 85 })).tier).toBe('best');
    expect(deriveTier(rec({ model: 'a', node: 'n', total: 84 })).tier).toBe('balanced');
    expect(deriveTier(rec({ model: 'a', node: 'n', total: 70 })).tier).toBe('balanced');
    expect(deriveTier(rec({ model: 'a', node: 'n', total: 69 })).tier).toBe('budget');
    expect(deriveTier(rec({ model: 'a', node: 'n', total: 49 })).tier).toBe('weak');
  });
});

describe('parseParamsB — 총 파라미터 추정', () => {
  it('단순 35b', () => expect(parseParamsB('qwen3.6-35b')).toBe(35));
  it('active 마커 a3b 배제·total 35b 채택', () => expect(parseParamsB('qwen3.6-35b-a3b-ud-mlx')).toBe(35));
  it('active 만 있으면 폴백', () => expect(parseParamsB('foo-a3b-mlx')).toBe(3));
  it('소수 4.5b', () => expect(parseParamsB('gemma-4.5b-it')).toBe(4.5));
  it('없으면 undefined', () => expect(parseParamsB('gpt-oss-coder')).toBeUndefined());
  it('120b MoE 대형', () => expect(parseParamsB('gpt-oss-120b')).toBe(120));
});

describe('bytesPerParam / estimateRamGb', () => {
  it('quant별 바이트', () => {
    expect(bytesPerParam('Q4_K_M')).toBe(0.5);
    expect(bytesPerParam('8bit')).toBe(1.0);
    expect(bytesPerParam('fp16')).toBe(2.0);
    expect(bytesPerParam(undefined)).toBe(0.5); // Q4 기본
  });
  it('35b Q4 ≈ 18.9GB', () => {
    const g = estimateRamGb('qwen3.6-35b', 'Q4_K_M')!;
    expect(g).toBeGreaterThan(18);
    expect(g).toBeLessThan(20);
  });
  it('파라미터 미상 → undefined', () => expect(estimateRamGb('mystery-model')).toBeUndefined());
});

describe('buildScoreRows — 조인(RAM inventory 우선·추정 폴백)', () => {
  const recs = [rec({ model: 'qwen3.6-35b', node: 'node-b', total: 90, coding: 45, reasoning: 27, rag: 9, krFormat: 9, tokPerSec: 42, saturated: false })];
  it('inventory sizeBytes 있으면 실측(source=inventory)', () => {
    const inv = new Map<string, InventoryMeta>([['qwen3.6-35b', { sizeBytes: 20 * 1024 ** 3, quantization: 'Q4_K_M', format: 'mlx', loaded: true }]]);
    const rows = buildScoreRows(recs, inv);
    expect(rows[0]!.ramSource).toBe('inventory');
    expect(rows[0]!.ramGb!).toBeCloseTo(20, 1);
    expect(rows[0]!.loaded).toBe(true);
    expect(rows[0]!.bestPurpose).toBe('coding');
    expect(rows[0]!.tier).toBe('best');
  });
  it('inventory 없으면 파라미터 추정(source=estimate)', () => {
    const rows = buildScoreRows(recs, new Map());
    expect(rows[0]!.ramSource).toBe('estimate');
    expect(rows[0]!.ramGb!).toBeGreaterThan(15);
    expect(rows[0]!.paramsB).toBe(35);
  });
});

describe('sortRows', () => {
  const rows = buildScoreRows([
    rec({ model: 'fast-7b', node: 'n', total: 70, coding: 30, tokPerSec: 120 }),
    rec({ model: 'smart-70b', node: 'n', total: 92, coding: 48, tokPerSec: 20 }),
  ], new Map());
  it('speed=tok/s 내림차순', () => expect(sortRows(rows, 'speed')[0]!.model).toBe('fast-7b'));
  it('total=총점 내림차순', () => expect(sortRows(rows, 'total')[0]!.model).toBe('smart-70b'));
  it('coding=코딩 내림차순', () => expect(sortRows(rows, 'coding')[0]!.model).toBe('smart-70b'));
  it('ram=작은 것 우선(추정 7b<70b)', () => expect(sortRows(rows, 'ram')[0]!.model).toBe('fast-7b'));
});

describe('formatScoreMap / scoreRowToJson', () => {
  const rows = buildScoreRows([rec({ model: 'qwen3.6-35b', node: 'node-b', total: 90, coding: 45, reasoning: 27, rag: 9, krFormat: 9, tokPerSec: 42 })], new Map());
  it('빈 입력은 안내 문구', () => {
    expect(formatScoreMap([], { sort: 'total', now: Date.parse('2026-07-19T00:00:00Z') })).toContain('스코어 없음');
  });
  it('표에 모델·용도·tier 포함', () => {
    const s = formatScoreMap(rows, { sort: 'total', now: Date.parse('2026-07-19T00:00:00Z') });
    expect(s).toContain('qwen3.6-35b');
    expect(s).toContain('코딩');
  });
  it('예산 초과는 ! 마크', () => {
    const s = formatScoreMap(rows, { sort: 'total', now: Date.parse('2026-07-19T00:00:00Z'), budgetGb: 5 });
    expect(s).toContain('!');
  });
  it('JSON 직렬화 핵심 필드', () => {
    const j = scoreRowToJson(rows[0]!);
    expect(j.model).toBe('qwen3.6-35b');
    expect(j.bestPurpose).toBe('coding');
    expect(j.tier).toBe('best');
    expect(j.ramSource).toBe('estimate');
  });
});

describe('score total consistency', () => {
  const line = (over: Record<string, unknown>) => JSON.stringify({
    at: '2026-09-24T00:00:00Z', node: 'n1', model: 'm1', total: 10, max: 40,
    coding: 4, reasoning: 3, rag: 2, krFormat: 1, ...over,
  });

  it('a record whose category scores do not add up to total is reported and not treated as a normal result', () => {
    const text = [line({}), line({ model: 'm2', total: 12 })].join('\n');
    const split = splitBenchRecords(text);
    expect(split.records.map((r) => r.model)).toEqual(['m1']);
    expect(split.mismatches).toEqual([{ model: 'm2', node: 'n1', at: '2026-09-24T00:00:00Z', total: 12, categorySum: 10 }]);
    expect(parseBenchRecords(text).map((r) => r.model)).toEqual(['m1']);
  });

  it('a consistent record is kept', () => {
    expect(splitBenchRecords(line({})).mismatches).toEqual([]);
  });

  it('an older record without category scores cannot be checked and is kept', () => {
    const old = JSON.stringify({ at: '2026-01-01T00:00:00Z', node: 'n1', model: 'old', total: 7, max: 40 });
    const split = splitBenchRecords(old);
    expect(split.records.map((r) => r.model)).toEqual(['old']);
    expect(split.mismatches).toEqual([]);
  });
});
