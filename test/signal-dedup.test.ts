// 6h 의미 dedup 분류기 (2026-07-07 대표 피드백). Covers: LLM 판정 경로
// (suppress+clusters 접기·소스 합산), 임베딩 폴백(주입 벡터), Jaccard 최후
// 폴백, dedupKey(reason 우선), 잘못된 LLM 출력 → 폴백.

import { describe, test, expect } from 'bun:test';
import {
  dedupeSignalsSemantic, dedupKey, cosineSim, SEMANTIC_DUP_THRESHOLD,
} from '../src/domains/signal-dedup.js';
import type { EmbedFn } from '../src/domains/knowledge.js';

const item = (text: string, reason?: string) => ({ item: { text, reason: reason ?? null }, sources: 1 });

describe('dedupKey', () => {
  test('reason(한국어 요약) 우선 · 없거나 짧으면 원문', () => {
    expect(dedupKey({ text: 'Samsung Q2 surges', reason: '삼성 2분기 급증 — 반도체 서프라이즈' }))
      .toBe('삼성 2분기 급증 — 반도체 서프라이즈');
    expect(dedupKey({ text: 'Samsung Q2 surges', reason: null })).toBe('Samsung Q2 surges');
    expect(dedupKey({ text: 'Samsung Q2 surges', reason: '짧음' })).toBe('Samsung Q2 surges');
  });
});

describe('LLM 판정 경로', () => {
  test('clusters 접기(소스 합산) + suppress 억제 — 07-07 아침 실사례 형상', async () => {
    // 실사례: 초긴급으로 삼성 실적(영어) 기발송 → 다이제스트 후보에 삼성 실적
    // 한국어 2건(영업익/매출) + AI버블 2건 + 무관 2건
    const items = [
      item('[1보] 삼성전자 2분기 영업이익 89조4천억원', '삼성전자 2분기 영업익 89.4조 — 실적 서프라이즈'),
      item('삼성전자 2분기 매출 171조 사상 최대', '삼성전자 2분기 매출 171조 — 호조 재확인'),
      item('Treasury internal report warns AI bubble', '美 재무부 AI 버블 경고'),
      item('Treasury draft report set to warn of AI bubble risk', 'AI 버블 경고 보도'),
      item('SK Hynix raises $28B in share sale', 'SK하이닉스 유상증자'),
      item('Fed inflation methodology changes', 'Fed 산식 변경'),
    ];
    const recent = [{ text: 'Samsung Electronics Q2 operating profit surges 1,810%', reason: '삼성전자 영업익 1,810% 급증' }];
    const r = await dedupeSignalsSemantic(items, recent, {
      llm: async () => JSON.stringify({ suppress: [1, 2], clusters: [[3, 4]] }),
    });
    expect(r.method).toBe('llm');
    expect(r.suppressed).toBe(2); // 삼성 2건 — 초긴급 기발송과 같은 사건
    expect(r.kept.length).toBe(3); // AI버블(접힘) + SK + Fed
    const ai = r.kept.find(k => k.item.text.includes('Treasury internal'));
    expect(ai?.sources).toBe(2); // AI버블 2건 → 1건 ×2
  });

  test('LLM 출력이 깨지면 폴백으로 (임베딩 주입)', async () => {
    const a = new Float32Array(4).fill(1);
    const embed: EmbedFn = async () => ({ vector: a, model: 't' });
    const r = await dedupeSignalsSemantic([item('x'), item('y')], [], {
      llm: async () => 'JSON 아님!!',
      embed,
    });
    expect(r.method).toBe('embedding');
    expect(r.kept.length).toBe(1); // 동일 벡터 → cos 1.0 → 접힘
    expect(r.kept[0]!.sources).toBe(2);
  });
});

describe('임베딩 폴백', () => {
  const vec = (...v: number[]) => new Float32Array(v);
  test('threshold 이상만 접고 recent 유사분 억제', async () => {
    const table: Record<string, Float32Array> = {
      A: vec(1, 0, 0), A2: vec(0.99, 0.1, 0), B: vec(0, 1, 0), R: vec(1, 0.02, 0),
    };
    const embed: EmbedFn = async (t) => ({ vector: table[t]!, model: 't' });
    const r = await dedupeSignalsSemantic(
      [item('A'), item('A2'), item('B')],
      [{ text: 'R', reason: null }],
      { llm: async () => null, embed },
    );
    expect(r.method).toBe('embedding');
    // A는 R과 cos≈1 → 억제 · A2도 R과 유사(≥0.87) → 억제 · B만 생존
    expect(r.suppressed).toBe(2);
    expect(r.kept.map(k => k.item.text)).toEqual(['B']);
  });

  test('cosineSim 기본 성질', () => {
    expect(cosineSim(vec(1, 0), vec(1, 0))).toBeCloseTo(1);
    expect(cosineSim(vec(1, 0), vec(0, 1))).toBeCloseTo(0);
    expect(SEMANTIC_DUP_THRESHOLD).toBeGreaterThan(0.8); // 비중복 실측 최대 0.705와 갭 유지
  });
});

describe('최후 폴백 (LLM·임베딩 전멸)', () => {
  test('recent와 Jaccard 근사중복만 억제 — 기존 동작 보존', async () => {
    const r = await dedupeSignalsSemantic(
      [item('Canada submarine deal goes to TKMS Hanwha loses'), item('Fed inflation methodology changes')],
      [{ text: 'Canada submarine deal goes to TKMS — Hanwha Ocean loses bid', reason: null }],
      { llm: async () => null, embed: (async () => { throw new Error('down'); }) as unknown as EmbedFn },
    );
    expect(r.method).toBe('jaccard-only');
    expect(r.suppressed).toBe(1);
    expect(r.kept.length).toBe(1);
  });
});
