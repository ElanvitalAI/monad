import { describe, expect, test } from 'bun:test';
import { inspectSubscription, enforceSubscriptionFirst } from './subscription-first.js';

const noTokens = () => null;
const noFiles = () => false;

describe('구독 판정 — ⛔ 「없다」를 확인 없이 말하지 않는다', () => {
  test('elanous auth store 에 있으면 구독이다', () => {
    const r = inspectSubscription('anthropic', { loadTokens: (p) => (p === 'anthropic' ? {} : null), fileExists: noFiles });
    expect(r.hasSubscription).toBe(true);
    expect(r.source).toBe('elanous-auth-store');
  });

  test('provider 홈 파일에 있으면 구독이다 ⊕ 본 경로를 말한다', () => {
    const r = inspectSubscription('grok', { loadTokens: noTokens, fileExists: (p) => p.endsWith('/.grok/auth.json'), home: () => '/h' });
    expect(r.hasSubscription).toBe(true);
    expect(r.source).toBe('provider-home');
    expect(r.checkedPath).toBe('/h/.grok/auth.json');
  });

  test('두 자리 «다» 없으면 구독이 아니다', () => {
    const r = inspectSubscription('grok', { loadTokens: noTokens, fileExists: noFiles, home: () => '/h' });
    expect(r.hasSubscription).toBe(false);
    expect(r.source).toBe('none');
  });

  test('모르는 provider 는 과금 env 를 «지어내지» 않는다', () => {
    const r = inspectSubscription('local', { loadTokens: noTokens, fileExists: noFiles });
    expect(r.hasSubscription).toBe(false);
    expect(r.billingEnv).toEqual([]);
  });
});

describe('만료 축 — ⛔ 「자격이 있다」와 「지금 쓸 수 있다」는 다른 값', () => {
  const live = { tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } };
  const dead = { tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1_000 } };

  test('만료된 토큰은 「구독 있음」으로 «안» 센다 — 지우면 구독도 API 도 못 쓴다', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-x' };
    const r = enforceSubscriptionFirst('openai-codex', env, { loadTokens: () => dead, fileExists: noFiles });
    expect(r.enforced).toBe(false);
    expect(r.reason).toBe('subscription-expired');   // ⛔ 'no-subscription' 과 «다른» 이유 — 처방이 다르다
    expect(env.OPENAI_API_KEY).toBe('sk-x');         // 지우지 «않았다»
    expect(r.expiryChecked).toBe(true);
  });

  test('살아 있는 토큰은 그대로 강제한다', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-x' };
    const r = enforceSubscriptionFirst('openai-codex', env, { loadTokens: () => live, fileExists: noFiles });
    expect(r.enforced).toBe(true);
    expect(r.expiryChecked).toBe(true);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  test('provider 홈 파일 경로는 만료를 «안 쟀다»고 말한다 — 「유효하다」가 아니다', () => {
    const r = inspectSubscription('grok', { loadTokens: noTokens, fileExists: (p) => p.endsWith('/.grok/auth.json'), home: () => '/h' });
    expect(r.hasSubscription).toBe(true);
    expect(r.expiryChecked).toBe(false);   // ⛔ 모른다를 「유효」로 읽지 않게 «값»으로 남긴다
  });

  test('expiresAt 이 null 이면 만료로 «단정하지 않는다»', () => {
    const noExpiry = { tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: null } };
    const r = inspectSubscription('anthropic', { loadTokens: () => noExpiry, fileExists: noFiles });
    expect(r.hasSubscription).toBe(true);
  });
});

describe('구독 강제 — 대표 「구독이 있으면 항상 구독」', () => {
  test('구독이 있으면 «있는» 과금 키를 지운다', () => {
    const env: NodeJS.ProcessEnv = { XAI_API_KEY: 'xai-x', GROK_API_KEY: 'gk' };
    const r = enforceSubscriptionFirst('grok', env, { loadTokens: () => ({}), fileExists: noFiles });
    expect(r.enforced).toBe(true);
    expect(r.reason).toBe('subscription-present');
    expect(env.XAI_API_KEY).toBeUndefined();
    expect(env.GROK_API_KEY).toBeUndefined();
    expect([...r.removed].sort()).toEqual(['GROK_API_KEY', 'XAI_API_KEY']);
  });

  // ⭐ 110차 오독의 «직접» 처방 — 목록이 아니라 「실제로 있어서 지운 것」만 센다.
  test('removed 는 «목록»이 아니라 «실제로 지운 것»이다', () => {
    const env: NodeJS.ProcessEnv = { XAI_API_KEY: 'xai-x' };   // 셋 중 하나만 있다
    const r = enforceSubscriptionFirst('grok', env, { loadTokens: () => ({}), fileExists: noFiles });
    expect(r.removed).toEqual(['XAI_API_KEY']);
    expect(r.removed.length).toBeLessThan(3);
  });

  test('구독이 «없으면» 아무것도 안 지운다 — 그러면 호출이 아예 못 간다', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-x' };
    const r = enforceSubscriptionFirst('openai-codex', env, { loadTokens: noTokens, fileExists: noFiles });
    expect(r.enforced).toBe(false);
    expect(r.reason).toBe('no-subscription');
    expect(env.OPENAI_API_KEY).toBe('sk-x');
    expect(r.present).toEqual(['OPENAI_API_KEY']);   // 「있었다」는 사실은 남긴다
  });

  // ⭐ 무인 리뷰 지적(should-fix) 수리 — 예전 판은 `removed: present` 로 «같은 배열»을 돌려줘
  //   removedCount 와 billingEnvPresentCount 가 항상 같은 수였다(관측 칸 하나가 무의미했다).
  test('removed 는 「지우기로 한 것」이 아니라 «지워진 것»이다 — 삭제가 막히면 갈라진다', () => {
    const env: NodeJS.ProcessEnv = { XAI_API_KEY: 'a', GROK_API_KEY: 'b' };
    // GROK_API_KEY 를 지울 수 없게 만든다(비-configurable) — delete 가 조용히 실패하는 조건.
    Object.defineProperty(env, 'GROK_API_KEY', { value: 'b', configurable: false, writable: false, enumerable: true });
    const r = enforceSubscriptionFirst('grok', env, { loadTokens: () => ({}), fileExists: noFiles });
    expect(r.present).toContain('GROK_API_KEY');       // 「있었다」는 그대로
    expect(r.removed).not.toContain('GROK_API_KEY');   // ⛔ 「지워졌다」로는 세지 않는다
    expect(r.removed).toContain('XAI_API_KEY');
    expect(r.removed.length).toBeLessThan(r.present.length);
  });

  test('구독은 있는데 지울 것이 없으면 enforced 이되 removed 는 비었다', () => {
    const env: NodeJS.ProcessEnv = {};
    const r = enforceSubscriptionFirst('anthropic', env, { loadTokens: () => ({}), fileExists: noFiles });
    expect(r.enforced).toBe(true);
    expect(r.removed).toEqual([]);
  });

  test('꺼져 있으면 건드리지 않고 그 사실을 말한다', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-x' };
    const r = enforceSubscriptionFirst('openai-codex', env, { enabled: false, loadTokens: () => ({}) });
    expect(r.reason).toBe('disabled');
    expect(env.OPENAI_API_KEY).toBe('sk-x');
  });

  test('anthropic 은 대체 인증·프로바이더 스위치까지 지운다 (키 하나만 지우면 샌다)', () => {
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', CLAUDE_CODE_USE_BEDROCK: '1' };
    const r = enforceSubscriptionFirst('anthropic', env, { loadTokens: () => ({}), fileExists: noFiles });
    expect(r.removed.length).toBe(3);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
  });
});
