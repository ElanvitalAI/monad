import { describe, expect, test } from 'bun:test';
import { classifyAuthError } from './codex.js';

// ⛔⭐ 무인 리뷰 must-fix [1]·[3] — 1라운드 테스트는 «소스 문자열»만 봐서 Goodhart 였다.
//   이제 «행동»으로 문다: 실제 토큰 모양을 넣어 산출에 그 조각이 «없음»을 확인한다.
describe('갱신 실패 분류가 «원문을 절대 안 낸다»', () => {
  const SECRETS = [
    'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    'xai-SHORT1',                                   // ⛔ 짧다 — 정규식 그물을 빠져나가던 모양
    'eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSM',           // JWT
    'Bearer aB3',                                   // ⛔ 아주 짧다
    'rt_9f!@#$%^&*',                                // ⛔ 특수문자
  ];

  test('산출 필드가 «셋»뿐이다 — reason 같은 자유 문자열이 없다', () => {
    const out = classifyAuthError(new Error('anything'));
    expect(Object.keys(out).sort()).toEqual(['errorKind', 'errorName', 'messageLength']);
  });

  test.each(SECRETS)('비밀 「%s」이 산출 어디에도 «안 남는다»', (secret) => {
    const out = classifyAuthError(new Error(`refresh failed: token=${secret} at endpoint`));
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(secret);
    // 조각도 안 된다 — 앞 6자만이라도 새면 안 된다.
    expect(serialized).not.toContain(secret.slice(0, 6));
  });

  test('그래도 «재현 방향»은 준다 — 종류와 길이', () => {
    expect(classifyAuthError(new Error('HTTP 401 invalid_grant')).errorKind).toBe('unauthorized');
    expect(classifyAuthError(new Error('429 rate limit exceeded')).errorKind).toBe('rate-limited');
    expect(classifyAuthError(new Error('503 service unavailable')).errorKind).toBe('server');
    expect(classifyAuthError(new Error('ETIMEDOUT')).errorKind).toBe('timeout');
    expect(classifyAuthError(new Error('ECONNREFUSED')).errorKind).toBe('network');
    expect(classifyAuthError(new Error('something else')).errorKind).toBe('other');
    expect(classifyAuthError(new Error('12345')).messageLength).toBe(5);
  });

  test('Error 가 아닌 것도 안전하게 분류한다', () => {
    const out = classifyAuthError({ secret: 'sk-leak-me' });
    expect(JSON.stringify(out)).not.toContain('sk-leak');
    expect(out.errorName).toBe('object');
  });
});
