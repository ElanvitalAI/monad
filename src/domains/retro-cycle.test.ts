// R3 · 회고 오케스트레이터 단위테스트 (순수·mock deps).
import { describe, expect, test } from 'bun:test';
import { runRetroCycle, type RetroCycleDeps } from './retro-cycle.js';
import type { RetroDeps, BacktestAgg } from './retro-aggregate.js';

const bt: BacktestAgg = {
  experiments: 10, byVerdict: { CONFIRMED: 4 }, confirmed: 4, promotions: 1,
  topStrategies: [{ strategy: 'external_regime_adaptive', count: 5, confirmed: 4 }],
};
const retro: RetroDeps = {
  backtest: () => bt,
  regime: () => ({ samples: 20, transitions: 1, meanComposite: 0.3, current: 'RISK_ON', distribution: { RISK_ON: 20 } }),
};

function deps(over: Partial<RetroCycleDeps> = {}): RetroCycleDeps {
  return {
    retro, candidates: () => [{ expId: 'exp:1', strategy: 'momentum_overlay', stage: 'live-candidate' }],
    writeReport: () => '/vault/REFLECTION-weekly-2026-07-08.md',
    now: () => '2026-07-08T00:00:00Z', ...over,
  };
}

describe('runRetroCycle', () => {
  test('집계→리포트 저장→제안 알림', async () => {
    const notices: string[] = [];
    const rep = await runRetroCycle(deps({ notify: t => notices.push(t) }), 'weekly');
    expect(rep.period).toBe('weekly');
    expect(rep.reportPath).toContain('REFLECTION-weekly');
    expect(rep.hasProposal).toBe(true);         // live-candidate + 엔진교체
    expect(notices.length).toBe(1);             // HITL 알림
    expect(notices[0]).toContain('승인 필요');
  });

  test('리포트 md 저장 호출(내용 포함)', async () => {
    let savedMd = '';
    await runRetroCycle(deps({ writeReport: (_f, md) => { savedMd = md; return '/p'; } }), 'monthly');
    expect(savedMd).toContain('회고');
    expect(savedMd).toContain('## 백테스팅 루프');
    expect(savedMd).toContain('리밸런싱·목표 제안');  // proposalMd 주입
  });

  test('Phase C: 독립 sanity check 판정 포함(정상→승인)', async () => {
    const rep = await runRetroCycle(deps(), 'weekly');
    expect(rep.sanity.approved).toBe(true);
    expect(rep.sanity.checks.some(c => c.name === 'hitl-invariant')).toBe(true);
  });

  test('제안 없음 → 알림 안 함', async () => {
    const notices: string[] = [];
    const empty: RetroDeps = { backtest: () => ({ experiments: 0, byVerdict: {}, confirmed: 0, promotions: 0, topStrategies: [] }), regime: () => null };
    const rep = await runRetroCycle(deps({ retro: empty, candidates: () => [], notify: t => notices.push(t) }), 'weekly');
    expect(rep.hasProposal).toBe(false);
    expect(notices.length).toBe(0);
  });

  test('narrate opt-in(async) → 서사 포함', async () => {
    let savedMd = '';
    await runRetroCycle(deps({ narrate: async () => '반도체 강세 지속.', writeReport: (_f, md) => { savedMd = md; return '/p'; } }), 'quarterly');
    expect(savedMd).toContain('## 종합 서사');
    expect(savedMd).toContain('반도체 강세');
  });

  test('surface(미엘린) 집계 → 발송·기억 섹션 + 하이라이트', async () => {
    let savedMd = '';
    await runRetroCycle(deps({
      retro: { ...retro, surface: () => ({ outbound: 12, byKind: { alert: 7, report: 3, digest: 2 }, recalled: 4, topImportant: [{ summary: '삼성 수급 전환 알림', kind: 'alert', importance: 8 }] }) },
      writeReport: (_f, md) => { savedMd = md; return '/p'; },
    }), 'weekly');
    expect(savedMd).toContain('## 발송·기억 (미엘린)');
    expect(savedMd).toContain('발송 12건 · 재참조 4건');
    expect(savedMd).toContain('삼성 수급 전환 알림');
  });
});
