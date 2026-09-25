// ⛔ 배선 테스트 — 「판정기가 맞나」가 아니라 「그 판정기가 실행 «경로»에 있는가」.
//
// 이 파일이 있는 이유: fallback-chain.ts 를 만들어 놓고 «아무도 안 부르면» F38
// (심은 뚫려 있고 꽂는 사람이 없다)이다. 이 트랙이 그 형태를 세 번 만났다
// (spawnCodexLogin 소비처 0건 · #7579 config 노브 no-op · DocOps 위키 한 장).

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexBackend, decideRuntimeFallback, grokBackend, resolveBackend, resolveDefaultBackend } from './driver.js';

describe('⑴ resolveDefaultBackend — 체인이 실행 경로에 «있다»', () => {
  it('체인이 grok 으로 넘기면 grok 백엔드를 낸다', () => {
    const b = resolveDefaultBackend({ decide: () => ({ action: 'switch-backend', backend: 'grok' }) });
    expect(b.name).toBe('grok');
    expect(b).toBe(grokBackend);
  });

  it('stay 면 codex 그대로 (기본 체인 = 무변경)', () => {
    expect(resolveDefaultBackend({ decide: () => ({ action: 'stay' }) })).toBe(codexBackend);
  });

  it('codex-rotate 는 «백엔드»를 안 바꾼다 — 계정 축이지 백엔드 축이 아니다', () => {
    expect(resolveDefaultBackend({ decide: () => ({ action: 'codex-rotate' }) })).toBe(codexBackend);
  });

  it('모르는 backend 이름으로 넘기려 하면 무시하고 codex — 조용한 오배선 방어', () => {
    expect(resolveDefaultBackend({ decide: () => ({ action: 'switch-backend', backend: 'gemini' }) })).toBe(codexBackend);
  });

  it('⛔ 판정이 «던져도» 백엔드는 뜬다 (체인 때문에 런이 죽지 않는다)', () => {
    expect(resolveDefaultBackend({
      decide: () => { throw new Error('store unreadable'); },
    })).toBe(codexBackend);
  });
});

describe('runtime fallback — 한도 실패만 미시도 다음 칸으로 재판정한다', () => {
  const state = (overrides: Partial<{ attemptedSteps: ReadonlySet<'codex-rotate' | 'grok'>; descents: number; maxDescents: number }> = {}) => ({
    attemptedSteps: new Set<'codex-rotate' | 'grok'>(['codex-rotate']), descents: 0, maxDescents: 1, ...overrides,
  });

  it('회전된 codex 자격의 한도 오류는 새 grok 칸으로 내려간다', () => {
    const calls: unknown[] = [];
    expect(decideRuntimeFallback(new Error('429 rate limit'), 'codex-rotate', state(), (input) => {
      calls.push(input); return { action: 'switch-backend', backend: 'grok' };
    })).toBe(grokBackend);
    expect(calls).toEqual([{ currentStep: 'codex-rotate', currentCredentialRateLimited: true }]);
  });

  it('이미 시도한 칸은 반복 한도 오류에도 다시 고르지 않는다', () => {
    expect(decideRuntimeFallback(new Error('rate limit'), 'grok', state({ attemptedSteps: new Set(['codex-rotate', 'grok']) }), () => ({ action: 'switch-backend', backend: 'grok' }))).toBeNull();
  });

  it('체인 하강 상한에 도달하면 재판정하지 않는다', () => {
    let called = false;
    expect(decideRuntimeFallback(new Error('429'), 'codex-rotate', state({ descents: 1 }), () => { called = true; return { action: 'switch-backend', backend: 'grok' }; })).toBeNull();
    expect(called).toBe(false);
  });

  it('요청·코드 오류는 재판정하거나 이동하지 않는다', () => {
    let called = false;
    expect(decideRuntimeFallback(new Error('invalid request'), 'codex-rotate', state(), () => { called = true; return { action: 'switch-backend', backend: 'grok' }; })).toBeNull();
    expect(called).toBe(false);
  });
});

describe('⑵ resolveBackend — ① 사람이 «명시»하면 체인을 타지 않는다', () => {
  it('이름을 주면 그 백엔드 그대로 (의도가 이긴다)', () => {
    expect(resolveBackend('codex')).toBe(codexBackend);
    expect(resolveBackend('grok')).toBe(grokBackend);
  });

  it('미지정/빈값/공백은 기본 경로로 간다', () => {
    // 실 판정을 타므로 «둘 중 하나»여야 한다 — 기본 체인이면 codex.
    for (const v of [undefined, '', '   ']) {
      const b = resolveBackend(v);
      expect([codexBackend.name, grokBackend.name]).toContain(b.name);
    }
  });

  it('모르는 이름은 «조용히 폴백하지 않고» 던진다 (애그노스틱 계약 유지)', () => {
    expect(() => resolveBackend('nope')).toThrow(/알 수 없는 agent backend/);
  });
});

describe('⑶ 소스 계약 — 배선이 «지워지지» 않게 문다', () => {
  const DRIVER = readFileSync(join(import.meta.dir, 'driver.ts'), 'utf-8');
  const STORE = readFileSync(join(import.meta.dir, '..', 'oauth', 'codex-account-store.ts'), 'utf-8');

  it('driver 의 「미지정」 분기가 resolveDefaultBackend 를 «부른다»', () => {
    expect(DRIVER).toContain('if (!key) return resolveDefaultBackend()');
  });

  it('store 가 판정기를 실제로 소비한다', () => {
    expect(STORE).toContain('decideFallback');
    expect(STORE).toContain('normalizeFallbackChain');
    expect(STORE).toContain('resolveGrokCredential');
  });

  it('전환은 «조용하지 않다» — 관측을 남긴다', () => {
    expect(DRIVER).toContain("'fallback-switch'");
    expect(STORE).toContain("'oauth.fallback-chain'");
  });

  it('⛔ 지연 로드다 — 백엔드 이름 물어보다 디스크를 깨우지 않는다', () => {
    expect(DRIVER).toContain("require('../oauth/codex-account-store.js')");
  });
});
