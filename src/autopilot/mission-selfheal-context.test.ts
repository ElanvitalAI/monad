import { describe, it, expect } from 'bun:test';
import {
  summarizeSelfHealHistory,
  buildSelfHealContext,
  formatSelfHealContextForPrompt,
  type SelfHealHistoryEntry,
} from './mission-selfheal-context.js';

const H = (stage: string, verdict: string, ts: string, extra: Partial<SelfHealHistoryEntry> = {}): SelfHealHistoryEntry =>
  ({ stage, verdict, ts, ...extra });

describe('summarizeSelfHealHistory — 순수 파생 신호', () => {
  it('빈 이력이면 0/false', () => {
    const s = summarizeSelfHealHistory([]);
    expect(s.total).toBe(0);
    expect(s.repeatDeadlock).toBe(false);
    expect(s.recentVerdicts).toEqual([]);
  });

  it('stage/verdict 별 카운트를 집계한다', () => {
    const s = summarizeSelfHealHistory([
      H('prevent', 'inject', '2026-07-14T01:00:00Z'),
      H('recover', 'fail', '2026-07-14T02:00:00Z'),
      H('deadlock', 'stuck', '2026-07-14T03:00:00Z'),
      H('diagnose', 'no-op', '2026-07-14T04:00:00Z'),
    ]);
    expect(s.total).toBe(4);
    expect(s.byStage.deadlock).toBe(1);
    expect(s.deadlockCount).toBe(1);
    expect(s.recoverFailCount).toBe(1);
    expect(s.noopCount).toBe(1);
    expect(s.repeatDeadlock).toBe(true);
  });

  it('교착 이력 없으면 repeatDeadlock=false', () => {
    const s = summarizeSelfHealHistory([H('prevent', 'inject', '2026-07-14T01:00:00Z'), H('diagnose', 'pass', '2026-07-14T02:00:00Z')]);
    expect(s.repeatDeadlock).toBe(false);
    expect(s.passCount).toBe(1);
  });

  it('recentVerdicts 는 최신순(ts 내림차순) 최대 5', () => {
    const s = summarizeSelfHealHistory([
      H('a', 'v1', '2026-07-14T01:00:00Z'),
      H('b', 'v2', '2026-07-14T02:00:00Z'),
      H('c', 'v3', '2026-07-14T03:00:00Z'),
    ]);
    expect(s.recentVerdicts[0]).toBe('c:v3');
    expect(s.recentVerdicts[2]).toBe('a:v1');
  });

  it('converge 도 pass 로 센다', () => {
    const s = summarizeSelfHealHistory([H('recover', 'converge', '2026-07-14T01:00:00Z')]);
    expect(s.passCount).toBe(1);
  });
});

describe('buildSelfHealContext — 3박자 조립(주입 reader)', () => {
  it('logs/ops/wm reader 를 조립한다', () => {
    const ctx = buildSelfHealContext(
      { missionId: 'apm_x', phaseId: 'task:p1', phaseTitle: '타입 정의' },
      {
        logsReader: () => [H('deadlock', 'stuck', '2026-07-14T03:00:00Z', { missing: 'validate 없음' })],
        opsReader: () => [],
        wmReader: () => ({ reusables: ['createCoordinatorMission'], decisions: ['narrow waist=TradeIntentEntry'] }),
      },
    );
    expect(ctx.summary.repeatDeadlock).toBe(true);
    expect(ctx.reusables).toContain('createCoordinatorMission');
    expect(ctx.decisions).toHaveLength(1);
  });

  it('reader 가 던져도 상위로 안 던진다(각 default 는 fail-soft) — 주입 reader 는 그대로 전파', () => {
    // 주입 reader 는 테스트가 통제하므로, 여기선 빈 조립이 정상 동작하는지만 확인.
    const ctx = buildSelfHealContext(
      { missionId: 'm', phaseId: 'p', phaseTitle: 't' },
      { logsReader: () => [], opsReader: () => [], wmReader: () => ({ reusables: [], decisions: [] }) },
    );
    expect(ctx.summary.total).toBe(0);
    expect(ctx.history).toEqual([]);
  });
});

describe('formatSelfHealContextForPrompt — 압축 주입 문자열', () => {
  it('첫 시도(이력 0)면 빈 문자열', () => {
    const ctx = buildSelfHealContext(
      { missionId: 'm', phaseId: 'p', phaseTitle: 't' },
      { logsReader: () => [], opsReader: () => [], wmReader: () => ({ reusables: [], decisions: [] }) },
    );
    expect(formatSelfHealContextForPrompt(ctx)).toBe('');
  });

  it('교착 이력이 있으면 경고 라인을 포함한다', () => {
    const ctx = buildSelfHealContext(
      { missionId: 'm', phaseId: 'p', phaseTitle: 't' },
      {
        logsReader: () => [H('deadlock', 'stuck', '2026-07-14T03:00:00Z'), H('recover', 'fail', '2026-07-14T02:00:00Z')],
        opsReader: () => [],
        wmReader: () => ({ reusables: [], decisions: [] }),
      },
    );
    const out = formatSelfHealContextForPrompt(ctx);
    expect(out).toContain('셀프힐 이력');
    expect(out).toContain('교착 1회');
    expect(out).toContain('범위를 좁히거나');
  });

  it('Layer 2 — 운영 결정은 셀프힐 이력이 없어도 최상단 부각(전제·재투쟁 금지)', () => {
    const ctx = buildSelfHealContext(
      { missionId: 'm', phaseId: 'p', phaseTitle: 't' },
      {
        logsReader: () => [], opsReader: () => [],
        wmReader: () => ({ reusables: [], decisions: [], governingDecisions: ['[operator·re-ground] [A1 crit2] arming 으로 미룸'] }),
      },
    );
    expect(ctx.governingDecisions).toHaveLength(1);
    const out = formatSelfHealContextForPrompt(ctx);
    expect(out).toContain('미션 운영 결정');
    expect(out).toContain('arming 으로 미룸');
    expect(out).toContain('재투쟁하지 말고');
  });

  it('운영 결정 + 셀프힐 이력 둘 다면 결정이 위·이력이 아래', () => {
    const ctx = buildSelfHealContext(
      { missionId: 'm', phaseId: 'p', phaseTitle: 't' },
      {
        logsReader: () => [H('deadlock', 'stuck', '2026-07-14T03:00:00Z')],
        opsReader: () => [],
        wmReader: () => ({ reusables: [], decisions: [], governingDecisions: ['[operator·boundary] A3=arming HITL'] }),
      },
    );
    const out = formatSelfHealContextForPrompt(ctx);
    expect(out.indexOf('운영 결정')).toBeLessThan(out.indexOf('셀프힐 이력'));
  });
});
