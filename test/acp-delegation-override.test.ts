// Explicit surface intent overrides active-delegation auto-continue — a
// stated "self / 모나드가 직접" must NOT be hijacked to the last ACP backend
// (the reported bug: "sub 함수도 self로 추가해줘" ran on codex).

import { describe, test, expect } from 'bun:test';
import { classifyDelegationOverride } from '../src/acp/active-delegation';

describe('classifyDelegationOverride', () => {
  test('self intent → self (self / 브레인 / 직접)', () => {
    expect(classifyDelegationOverride('sub 함수도 self로 추가해줘')).toBe('self');
    expect(classifyDelegationOverride('이건 브레인으로 해줘')).toBe('self');
    expect(classifyDelegationOverride('그냥 직접 고쳐줘')).toBe('self');
  });

  test('monad-as-actor → self (모나드가 직접 / 모나드로 / monad가)', () => {
    expect(classifyDelegationOverride('모나드가 직접 추가해')).toBe('self');
    expect(classifyDelegationOverride('모나드로 해줘')).toBe('self');
    expect(classifyDelegationOverride('monad가 처리해')).toBe('self');
  });

  test('self wins even when another backend is mentioned', () => {
    expect(classifyDelegationOverride('codex가 만든 걸 self로 고쳐')).toBe('self');
  });

  test('explicit backend switch', () => {
    expect(classifyDelegationOverride('claude로 이거 리팩터해줘')).toBe('claude');
    expect(classifyDelegationOverride('cdx로 계속')).toBe('codex');
    expect(classifyDelegationOverride('gemini로 봐줘')).toBe('gemini');
  });

  test('no signal → null (continue active backend)', () => {
    expect(classifyDelegationOverride('그것도 고쳐줘')).toBeNull();
    expect(classifyDelegationOverride('sub 함수도 추가해줘')).toBeNull();
  });

  test('a bare "monad-agent" path mention is NOT self intent', () => {
    expect(classifyDelegationOverride('monad-agent 레포에서 실행해줘')).toBeNull();
  });
});
