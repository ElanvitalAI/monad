import { test, expect, describe } from 'bun:test';
import { buildMacroItems, formatMacroBriefing, renderMacroBriefing, buildMacro, type MacroDeps } from './macro-briefing.js';

const q = (close: number, changePct: number) => ({ close, changePct });

// 전 심볼 성공 + ust10y.
const fullDeps: MacroDeps = {
  quote: (s) => ({ 'USO.US': q(109.34, 0.39), 'UUP.US': q(28.39, -0.02), 'USDKRW.FOREX': q(1511.6, -1.14) } as Record<string, any>)[s] ?? null,
  ust10y: () => 4.48,
};

describe('buildMacro — 단일 fetch → items + snapshot', () => {
  test('items + raw snapshot 동시 산출', () => {
    const { items, snapshot } = buildMacro(fullDeps);
    expect(items.map((i) => i.label)).toEqual(['유가(WTI)', '달러(DXY)', '원/달러', '미10년']);
    expect(snapshot).toEqual({ oilPct: 0.39, dxyPct: -0.02, usdkrw: 1511.6, ust10y: 4.48 });
  });
  test('일부 실패 → snapshot 해당 필드 생략', () => {
    const { snapshot } = buildMacro({ quote: (s) => (s === 'USDKRW.FOREX' ? q(1500, -0.5) : null), ust10y: () => null });
    expect(snapshot).toEqual({ usdkrw: 1500 });
  });
});

describe('buildMacroItems', () => {
  test('전 항목 성공 → 4개(유가·달러·원달러·미10년)', () => {
    const items = buildMacroItems(fullDeps);
    expect(items.map((i) => i.label)).toEqual(['유가(WTI)', '달러(DXY)', '원/달러', '미10년']);
    // 프록시(유가·달러)는 value 빈값, 원달러·미10년은 실값.
    expect(items[0]?.value).toBe('');
    expect(items[2]?.value).toBe('1511.6');
    expect(items[3]?.value).toBe('4.48%');
    expect(items[3]?.changePct).toBeNull();
  });

  test('일부 심볼 실패 → 항목별 fail-soft(빠짐)', () => {
    const items = buildMacroItems({ quote: (s) => (s === 'USDKRW.FOREX' ? q(1500, -0.5) : null), ust10y: () => null });
    expect(items.map((i) => i.label)).toEqual(['원/달러']);
  });

  test('ust10y null/0 → 미10년 제외', () => {
    expect(buildMacroItems({ quote: () => null, ust10y: () => 0 }).length).toBe(0);
    expect(buildMacroItems({ quote: () => null, ust10y: () => null }).length).toBe(0);
  });
});

describe('formatMacroBriefing', () => {
  test('빈 항목 → 빈 문자열(섹션 생략)', () => {
    expect(formatMacroBriefing([])).toBe('');
  });

  test('방향 화살표 + 실값', () => {
    const out = renderMacroBriefing(fullDeps);
    expect(out).toContain('📈 *매크로 핵심*');
    expect(out).toContain('유가(WTI) ▲+0.39%');   // 프록시 방향
    expect(out).toContain('달러(DXY) ·-0.02%');    // |변화|<0.05 → 중립 점
    expect(out).toContain('원/달러 1511.6 ▼-1.14%'); // 실값 + 하락
    expect(out).toContain('미10년 4.48%');          // 수익률(변화 없음)
  });

  test('상승/하락/중립 화살표 경계', () => {
    const s = formatMacroBriefing([
      { label: 'A', value: '', changePct: 0.1 },
      { label: 'B', value: '', changePct: -0.1 },
      { label: 'C', value: '', changePct: 0.0 },
    ]);
    expect(s).toContain('A ▲+0.10%');
    expect(s).toContain('B ▼-0.10%');
    expect(s).toContain('C ·+0.00%');
  });
});
