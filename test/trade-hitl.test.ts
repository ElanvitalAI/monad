// P8c — HITL 매매 상태머신 안전 불변식. 전부 주입 stub(실 I/O 없음)으로 hermetic.
// 핵심 검증: (1) 게이트 fail-closed (2) 승인 fail-closed (3) executor 미주입 시
// 모든 승인 통과해도 집행 안 됨 (4) 재검증 실패 시 집행 취소.

import { describe, test, expect } from 'bun:test';
import { runTradeHitl, type TradeIntent } from '../src/domains/trade-hitl';

const intent: TradeIntent = { id: 't1', symbol: 'KORU', side: 'buy', qty: 1, reason: '테스트', source: 'user' };
const approve = async () => ({ approved: true, channel: 'pushcut' });
const cleared = async () => ({ gate: 'CLEARED' });

describe('runTradeHitl — fail-closed 안전 불변식', () => {
  test('게이트 BLOCKED → 승인 요청도 안 하고 REJECTED', async () => {
    let approvalAsked = false;
    const r = await runTradeHitl(intent, {
      verifyGate: async () => ({ gate: 'BLOCKED', detail: '리스크' }),
      requestApproval: async () => { approvalAsked = true; return { approved: true }; },
    });
    expect(r.state).toBe('REJECTED');
    expect(r.executed).toBe(false);
    expect(approvalAsked).toBe(false); // 게이트 실패면 사람에게 묻지도 않음
  });

  test('MARKET_CLOSED → REJECTED (장 마감이면 매매 없음)', async () => {
    const r = await runTradeHitl(intent, {
      verifyGate: async () => ({ gate: 'MARKET_CLOSED' }), requestApproval: approve,
    });
    expect(r.state).toBe('REJECTED');
  });

  test('1차 승인 거부 → REJECTED, 2차 안 물음', async () => {
    let stage2 = false;
    const r = await runTradeHitl(intent, {
      verifyGate: cleared,
      requestApproval: async (_p, stage) => { if (stage === 2) stage2 = true; return stage === 1 ? { approved: false } : { approved: true }; },
    });
    expect(r.state).toBe('REJECTED');
    expect(stage2).toBe(false);
  });

  test('★ 승인 전부 통과 + executor 미주입 → 집행 안 됨 (하드 거부)', async () => {
    const r = await runTradeHitl(intent, { verifyGate: cleared, requestApproval: approve });
    expect(r.state).toBe('REJECTED');
    expect(r.executed).toBe(false);
    expect(r.rejectReason).toMatch(/집행 배선 없음|executor 미주입/);
    expect(r.approvals).toHaveLength(2); // 2 승인은 받았으나 집행은 거부
  });

  test('집행 직전 재검증 실패 → 승인 후에도 집행 취소', async () => {
    let calls = 0;
    const r = await runTradeHitl(intent, {
      verifyGate: async () => (++calls === 1 ? { gate: 'CLEARED' } : { gate: 'BLOCKED' }), // 재검증에서 BLOCKED
      requestApproval: approve,
      executor: async () => ({ filled: true, detail: 'should not run' }),
    });
    expect(r.state).toBe('REJECTED');
    expect(r.executed).toBe(false);
    expect(r.rejectReason).toMatch(/재검증/);
  });

  test('전 조건 충족 + executor 주입(stub) → EXECUTED/FILLED', async () => {
    let executed = false;
    const r = await runTradeHitl(intent, {
      verifyGate: cleared, requestApproval: approve,
      executor: async () => { executed = true; return { filled: true, detail: 'stub 체결' }; },
    });
    expect(executed).toBe(true);
    expect(r.state).toBe('FILLED');
    expect(r.executed).toBe(true);
  });

  test('never throws — executor가 throw해도 REJECTED로 안전 종료', async () => {
    const r = await runTradeHitl(intent, {
      verifyGate: cleared, requestApproval: approve,
      executor: async () => { throw new Error('broker down'); },
    });
    expect(r.state).toBe('REJECTED');
    expect(r.rejectReason).toMatch(/broker down|집행 실패/);
  });
});
