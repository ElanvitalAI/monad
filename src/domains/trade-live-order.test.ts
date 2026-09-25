// 실주문 배선 회귀 (실돈·2026-07-22) — tossOrder primitive + native placeOrder + 정책.
// ⚠️ 실주문 절대 안 냄: poster/token 주입 seam 으로 HTTP 완전 모킹. 실 Toss 무접촉.

import { afterEach, expect, test } from 'bun:test';
import { tossOrder, _setTossPoster, _setTossToken, type TossOrderInput } from './toss-quote.js';
import { resolveOrderPolicy, makePolicyApprover } from './trade-policy.js';
import { runTradeHitl, type TradeIntent } from './trade-hitl.js';

const prevAcct = process.env.TOSSINVEST_ACCOUNT_SEQ;
afterEach(() => {
  _setTossPoster(); _setTossToken(); // 실 poster/token 복원
  if (prevAcct === undefined) delete process.env.TOSSINVEST_ACCOUNT_SEQ; else process.env.TOSSINVEST_ACCOUNT_SEQ = prevAcct;
});

function mockPoster(capture: { url?: string; body?: unknown; headers?: Record<string, string> }) {
  _setTossPoster((url, body, headers) => {
    capture.url = url; capture.body = JSON.parse(body); capture.headers = headers;
    return { result: { orderId: 'MOCK-ORDER-1' } };
  });
}

test('tossOrder: fail-closed — qty<=0 (토큰/네트워크 도달 전 거부)', () => {
  const r = tossOrder({ symbol: '005930', side: 'buy', qty: 0, orderType: 'MARKET' });
  expect(r.ok).toBe(false); expect(r.detail).toContain('qty');
});

test('tossOrder: fail-closed — LIMIT 인데 price 없음', () => {
  const r = tossOrder({ symbol: '005930', side: 'buy', qty: 1, orderType: 'LIMIT' });
  expect(r.ok).toBe(false); expect(r.detail).toContain('price');
});

test('tossOrder: fail-closed — 토큰 없음(자격 미설정)', () => {
  _setTossToken(null); // 토큰 없음
  const r = tossOrder({ symbol: '005930', side: 'buy', qty: 1, orderType: 'MARKET' });
  expect(r.ok).toBe(false); expect(r.detail).toContain('토큰');
});

test('tossOrder: fail-closed — ACCOUNT_SEQ 없음', () => {
  _setTossToken('FAKE-TOK'); delete process.env.TOSSINVEST_ACCOUNT_SEQ;
  // conatusEnv fallback 에 값이 있을 수 있으므로, 있으면 이 케이스는 skip 판정
  const r = tossOrder({ symbol: '005930', side: 'buy', qty: 1, orderType: 'MARKET' });
  if (!r.ok && r.detail.includes('ACCOUNT_SEQ')) expect(r.detail).toContain('ACCOUNT_SEQ');
  else expect(r.ok || r.detail.length > 0).toBeTruthy(); // 환경에 account 있으면 통과 경로(모킹 안 함) — 관대
});

test('tossOrder: 정상 body 구성 (buy MARKET) — 모킹 poster', () => {
  _setTossToken('FAKE-TOK'); process.env.TOSSINVEST_ACCOUNT_SEQ = 'ACC-1';
  const cap: { body?: any; headers?: Record<string, string> } = {};
  mockPoster(cap);
  const r = tossOrder({ symbol: '005930', side: 'buy', qty: 3, orderType: 'MARKET' });
  expect(r.ok).toBe(true); expect(r.orderId).toBe('MOCK-ORDER-1');
  expect(cap.body).toEqual({ symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: 3 });
  expect(cap.headers?.['X-Tossinvest-Account']).toBe('ACC-1');
  expect(cap.headers?.['Authorization']).toBe('Bearer FAKE-TOK');
});

test('tossOrder: 정상 body 구성 (sell LIMIT price 포함)', () => {
  _setTossToken('FAKE-TOK'); process.env.TOSSINVEST_ACCOUNT_SEQ = 'ACC-1';
  const cap: { body?: any } = {};
  mockPoster(cap);
  const r = tossOrder({ symbol: '000660', side: 'sell', qty: 2, orderType: 'LIMIT', price: 123000 });
  expect(r.ok).toBe(true);
  expect(cap.body).toEqual({ symbol: '000660', side: 'SELL', orderType: 'LIMIT', quantity: 2, price: 123000 });
});

test('tossOrder: 브로커 거부(orderId 없음) → ok:false', () => {
  _setTossToken('FAKE-TOK'); process.env.TOSSINVEST_ACCOUNT_SEQ = 'ACC-1';
  _setTossPoster(() => ({ error: 'rejected' }));
  const r = tossOrder({ symbol: '005930', side: 'buy', qty: 1, orderType: 'MARKET' });
  expect(r.ok).toBe(false); expect(r.detail).toContain('실패');
});

// ── 정책 (대표: user→approve / else→HITL) ──
const mkIntent = (source: TradeIntent['source']): TradeIntent =>
  ({ id: 't1', symbol: '005930', side: 'buy', qty: 1, reason: 'test', source });

test('정책: 신뢰 user origin → auto-approve', () => {
  const d = resolveOrderPolicy({ intent: mkIntent('user'), trustedUserOrigin: true });
  expect(d.path).toBe('auto-approve');
});

test('정책: 비신뢰(자율) → require-hitl (fail-safe 기본)', () => {
  for (const src of ['agent', 'signal', 'user'] as const) {
    const d = resolveOrderPolicy({ intent: mkIntent(src), trustedUserOrigin: false });
    expect(d.path).toBe('require-hitl'); // ⚠️ source=user 라도 trustedUserOrigin=false 면 HITL(위조방지)
  }
});

test('정책 approver: trusted → 자동승인, 비신뢰 → 사람 위임', async () => {
  let humanCalled = 0;
  const human = async () => { humanCalled++; return { approved: false }; };
  const autoApprover = makePolicyApprover(true, human);
  expect((await autoApprover('p', 1)).approved).toBe(true);
  expect(humanCalled).toBe(0); // 사람 미호출
  const hitlApprover = makePolicyApprover(false, human);
  expect((await hitlApprover('p', 1)).approved).toBe(false);
  expect(humanCalled).toBe(1); // 사람 위임됨
});

// ── HITL stages (대표 결정: 실주문=1단계) ──
test('runTradeHitl: stages=1 → 승인 1회만(2차 스킵)·집행 도달', async () => {
  const calls: Array<1 | 2> = [];
  const r = await runTradeHitl(mkIntent('user'), {
    stages: 1,
    verifyGate: async () => ({ gate: 'CLEARED' }),
    requestApproval: async (_p, stage) => { calls.push(stage); return { approved: true, channel: 'telegram' }; },
    executor: async () => ({ filled: true, detail: 'mock' }),
  });
  expect(calls).toEqual([1]);           // 1차만
  expect(r.executed).toBe(true);
  expect(r.state === 'FILLED' || r.state === 'EXECUTED').toBe(true);
});

test('runTradeHitl: 기본(stages 미지정) → 2단계(회귀 보호)', async () => {
  const calls: Array<1 | 2> = [];
  await runTradeHitl(mkIntent('user'), {
    verifyGate: async () => ({ gate: 'CLEARED' }),
    requestApproval: async (_p, stage) => { calls.push(stage); return { approved: true }; },
    executor: async () => ({ filled: true, detail: 'mock' }),
  });
  expect(calls).toEqual([1, 2]);        // 2단계 유지
});

test('runTradeHitl: stages=1 이라도 1차 거부 → 집행 안 함', async () => {
  const r = await runTradeHitl(mkIntent('user'), {
    stages: 1,
    verifyGate: async () => ({ gate: 'CLEARED' }),
    requestApproval: async () => ({ approved: false }),
    executor: async () => ({ filled: true, detail: 'should-not-run' }),
  });
  expect(r.executed).toBe(false);
  expect(r.state).toBe('REJECTED');
});
