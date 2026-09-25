import { afterAll, describe, expect, test } from 'bun:test';
import { buildUserConfig } from '../src/user-config.js';
import { buildPrApprovalRequest, resolvePrApprovalDelivery, type PrApprovalDelivery } from '../src/hitl/pr-approval-delivery.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** ⛔ 이 축의 계약은 **좁은 쪽으로 떨어진다** 하나다 —
 *  승인 카드가 어디로 갈지는 사람의 주의를 어디서 뺏을지를 정하고,
 *  오타 하나가 **아이폰 푸시를 다시 켜면 안 된다**(그것이 이 PR 이 생긴 이유다). */
const madeDirs: string[] = [];
afterAll(() => { for (const d of madeDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function loadWith(toolsRaw: unknown): ReturnType<typeof buildUserConfig> {
  const dir = mkdtempSync(join(tmpdir(), 'monad-pr-delivery-'));
  madeDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(toolsRaw === undefined ? {} : { tools: toolsRaw }));
  return buildUserConfig(path);
}
const deliveryOf = (toolsRaw: unknown) => loadWith(toolsRaw).tools.selfImplement.prApprovalDelivery;

describe('self-implement PR 승인 표면 — prApprovalDelivery', () => {
  test('⭐ 기본은 terminal — 설정이 없으면 팬아웃하지 않는다', () => {
    expect(deliveryOf(undefined)).toBe('terminal');
    expect(deliveryOf({})).toBe('terminal');
    expect(deliveryOf({ selfImplement: {} })).toBe('terminal');
  });

  test('⭐ all 을 명시하면 종전 팬아웃이 복원된다(되돌릴 길을 남긴다)', () => {
    expect(deliveryOf({ selfImplement: { prApprovalDelivery: 'all' } })).toBe('all');
  });

  test('⛔ 알 수 없는 값은 좁은 쪽으로 — 오타가 팬아웃을 켜면 안 된다', () => {
    for (const bad of ['ALL', 'push', 'telegram', '', 'terminal ', 0, 1, true, null, [], {}]) {
      expect(deliveryOf({ selfImplement: { prApprovalDelivery: bad } })).toBe('terminal');
    }
  });

  test('⛔ 음성 대조 — 이 키가 없던 종전 설정도 terminal 이고 이웃 키는 그대로다(무회귀)', () => {
    const cfg = loadWith({ selfImplement: { autoOpenPr: false } });
    expect(cfg.tools.selfImplement.prApprovalDelivery).toBe('terminal');
    expect(cfg.tools.selfImplement.autoOpenPr).toBe(false);
  });
});

describe('⭐ 결정 자체 — resolvePrApprovalDelivery (리뷰 must-fix ②③)', () => {
  test('⛔ 읽기 실패는 좁은 쪽으로 — 설정을 못 읽었다고 폰으로 밀어내지 않는다', () => {
    expect(resolvePrApprovalDelivery(() => { throw new Error('config unreadable'); })).toBe('terminal');
  });

  test('⭐ all 을 **명시**했을 때만 팬아웃한다', () => {
    expect(resolvePrApprovalDelivery(() => ({ tools: { selfImplement: { prApprovalDelivery: 'all' } } }))).toBe('all');
    expect(resolvePrApprovalDelivery(() => ({ tools: { selfImplement: {} } }))).toBe('terminal');
    expect(resolvePrApprovalDelivery(() => ({}))).toBe('terminal');
  });

  test('⛔ 음성 대조 — 이 결정을 지우면(항상 all) 위 두 계약이 동시에 깨진다', () => {
    const always = (): 'all' => 'all';
    expect(always()).not.toBe(resolvePrApprovalDelivery(() => ({})));
    expect(always()).not.toBe(resolvePrApprovalDelivery(() => { throw new Error('x'); }));
  });

  test('⛔ 승인 요청이 delivery 를 **항상** 싣는다 — production 과 같은 함수로 (3R 리뷰 must-fix)', () => {
    // ⚠️ 종전 이 테스트는 자기가 만든 fakeConfirm 을 검증해서, dashboard 에서 delivery 를
    //    지워도 통과했다(Goodhart). ⇒ 이제 **production 이 부르는 그 함수**를 부른다.
    const req = buildPrApprovalRequest({ branch: 'b1', implSummary: 'x', delivery: resolvePrApprovalDelivery(() => ({})) });
    expect(req.delivery).toBe('terminal');          // ⛔ undefined 면 전 채널 팬아웃이다
    expect(req.prompt).toContain('b1');
    expect(req.yesLabel).toBe('PR 열기');
  });

  test('⭐ all 로 결정되면 요청에도 all 이 실린다(되돌릴 길이 살아 있다)', () => {
    const delivery: PrApprovalDelivery = resolvePrApprovalDelivery(() => ({ tools: { selfImplement: { prApprovalDelivery: 'all' } } }));
    expect(buildPrApprovalRequest({ branch: 'b', implSummary: '', delivery }).delivery).toBe('all');
  });

  test('⭐ gateLog 는 있을 때만 붙고 상한이 걸린다(무회귀)', () => {
    const withGate = buildPrApprovalRequest({ branch: 'b', implSummary: 'S'.repeat(2000), gateLog: 'G'.repeat(1000), delivery: 'terminal' });
    expect(withGate.detail).toContain('[gate]');
    expect(withGate.detail.length).toBeLessThanOrEqual(1200 + 600 + 10);
    expect(buildPrApprovalRequest({ branch: 'b', implSummary: 's', delivery: 'terminal' }).detail).not.toContain('[gate]');
  });
});
