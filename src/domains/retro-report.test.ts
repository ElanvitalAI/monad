// R1 · 회고 리포트 렌더 단위테스트 (순수).
import { describe, expect, test } from 'bun:test';
import { renderReflectionMd, reflectionFilename } from './retro-report.js';
import type { PeriodSummary } from './retro-aggregate.js';

const SUMMARY: PeriodSummary = {
  window: { period: 'weekly', from: '2026-07-01', to: '2026-07-08', days: 7 },
  backtest: { experiments: 12, byVerdict: { CONFIRMED: 3, INCONCLUSIVE: 9 }, confirmed: 3, promotions: 1,
    topStrategies: [{ strategy: 'external_regime_adaptive', count: 5, confirmed: 2 }] },
  regime: { samples: 20, transitions: 2, meanComposite: 0.35, current: 'RISK_ON', distribution: { RISK_ON: 14, NEUTRAL: 6 } },
  trades: { cycles: 5, orders: 3 },
  surface: null,
  highlights: ['백테스팅 12건 · CONFIRMED 3건', '국면 RISK_ON'],
  generatedAt: '2026-07-08T00:00:00Z',
};

describe('reflectionFilename', () => {
  test('period·date 포함', () => {
    expect(reflectionFilename(SUMMARY)).toBe('REFLECTION-weekly-2026-07-08.md');
  });
});

describe('renderReflectionMd', () => {
  test('결정론 base — 핵심 관찰·백테스팅·국면·매매 섹션', () => {
    const md = renderReflectionMd(SUMMARY);
    expect(md).toContain('# 주간 회고 — 2026-07-01 ~ 2026-07-08');
    expect(md).toContain('## 핵심 관찰');
    expect(md).toContain('## 백테스팅 루프');
    expect(md).toContain('CONFIRMED 3');
    expect(md).toContain('external_regime_adaptive');
    expect(md).toContain('## 국면');
    expect(md).toContain('RISK_ON');
    expect(md).toContain('## 매매');
    expect(md).toContain('HITL');
  });

  test('LLM 서사 opt-in 없으면 서사 섹션 없음', () => {
    expect(renderReflectionMd(SUMMARY)).not.toContain('## 종합 서사');
  });

  test('narrative 주입 시 서사 섹션', () => {
    const md = renderReflectionMd(SUMMARY, { narrative: '이번 주는 반도체 강세.' });
    expect(md).toContain('## 종합 서사');
    expect(md).toContain('반도체 강세');
  });

  test('proposalMd 주입 시 리밸런싱 제안 섹션(HITL)', () => {
    const md = renderReflectionMd(SUMMARY, { proposalMd: '- aggressive fund에 external_regime_adaptive 편입 검토' });
    expect(md).toContain('## 리밸런싱·목표 제안 (HITL 승인 필요)');
    expect(md).toContain('편입 검토');
  });

  test('regime null·trades 0 → 해당 섹션 생략', () => {
    const md = renderReflectionMd({ ...SUMMARY, regime: null, trades: null });
    expect(md).not.toContain('## 국면');
    expect(md).not.toContain('## 매매');
    expect(md).toContain('## 백테스팅 루프');  // 백테스팅은 유지
  });
});
