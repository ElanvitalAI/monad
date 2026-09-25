// ── codex loopback baseUrl guard (인시던트 2026-07-17) ────────────────────
//
// config 최상위 `llm.baseUrl: http://localhost:1234/v1`(local-LLM 잔재)를
// makeCodexProvider 가 흡수해 codex 요청을 로컬 LM Studio 로 보내 1초
// "Internal error" 가 났다. isLoopbackBaseUrl 이 loopback override 를 걸러
// codex 가 canonical 엔드포인트(chatgpt.com/backend-api/codex)로 폴백한다.

import { describe, it, expect } from 'bun:test';
import { isLoopbackBaseUrl } from './llm.js';

describe('isLoopbackBaseUrl — codex loopback baseUrl guard', () => {
  it('local-LLM 잔재 baseUrl 은 loopback 으로 감지(무시 대상)', () => {
    expect(isLoopbackBaseUrl('http://localhost:1234/v1')).toBe(true); // 인시던트 실측
    expect(isLoopbackBaseUrl('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLoopbackBaseUrl('http://0.0.0.0:8080')).toBe(true);
    expect(isLoopbackBaseUrl('http://[::1]:1234/v1')).toBe(true);
    expect(isLoopbackBaseUrl('http://LocalHost:1234')).toBe(true); // 대소문자 무관
  });

  it('원격 codex-proxy override 는 통과(의도된 기능 보존)', () => {
    expect(isLoopbackBaseUrl('https://chatgpt.com/backend-api/codex')).toBe(false);
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackBaseUrl('https://codex-proxy.internal.corp/v1')).toBe(false);
  });

  it('파싱불가/빈 문자열 은 false(통과 — 폴백 로직이 canonical 처리)', () => {
    expect(isLoopbackBaseUrl('')).toBe(false);
    expect(isLoopbackBaseUrl('not-a-url')).toBe(false);
  });
});
