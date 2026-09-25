// 2026-05-07 dogfood feedback — SessionPill 의 ID 분리 + Copy 기능
// 테스트. 컴포넌트 자체는 React DOM + DaemonProvider 의존이 있어 PWA
// bun test 환경에서 직접 render 하기 어렵지만, 두 핵심 helper
// (`shortSessionId` · `copyToClipboard`) 는 pure 함수로 단위 검증
// 가능. 사용자가 ID 식별 / 복사 둘 다 안 됐다는 회귀가 다시 들어오지
// 않게 lock.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { copyToClipboard, shortSessionId } from './SessionPill';

describe('shortSessionId — pill display 의 short ID + 단축 cue', () => {
  it('full UUID 의 첫 8자 + ellipsis 반환 (단축 visual cue)', () => {
    expect(shortSessionId('8a7c3f2b-9d4e-4f1a-b2c3-1234567890ab'))
      .toBe('8a7c3f2b…');
  });

  it('정확히 8자 ID 는 ellipsis 없이 그대로 (전체 = 표시값)', () => {
    expect(shortSessionId('abcd1234')).toBe('abcd1234');
  });

  it('8자 미만 짧은 ID 그대로 반환', () => {
    expect(shortSessionId('abc')).toBe('abc');
    expect(shortSessionId('s-1')).toBe('s-1');
  });

  it('9자 이상 ID 는 8자 + ellipsis (단축 표시 명시)', () => {
    expect(shortSessionId('abcdefghi')).toBe('abcdefgh…');
    expect(shortSessionId('s-1a2b3c4d-fallback'))
      .toBe('s-1a2b3c…');
  });

  it('null / undefined / empty 시 placeholder "—" 반환', () => {
    expect(shortSessionId(null)).toBe('—');
    expect(shortSessionId(undefined)).toBe('—');
    expect(shortSessionId('')).toBe('—');
  });
});

describe('copyToClipboard — clipboard API wrapper', () => {
  let originalNavigator: unknown;

  beforeEach(() => {
    originalNavigator = (globalThis as { navigator?: unknown }).navigator;
  });

  afterEach(() => {
    (globalThis as { navigator?: unknown }).navigator = originalNavigator;
  });

  it('빈 value 는 false 반환 (no-op · 호출 안 됨)', async () => {
    let called = false;
    (globalThis as unknown as { navigator: unknown }).navigator = {
      clipboard: { writeText: async () => { called = true; } },
    };
    expect(await copyToClipboard('')).toBe(false);
    expect(called).toBe(false);
  });

  it('clipboard API 미지원 (navigator.clipboard undefined) 시 false', async () => {
    (globalThis as unknown as { navigator: unknown }).navigator = {};
    expect(await copyToClipboard('abc')).toBe(false);
  });

  it('clipboard.writeText resolve 시 true + 정확한 value 전달', async () => {
    const written: string[] = [];
    (globalThis as unknown as { navigator: unknown }).navigator = {
      clipboard: {
        writeText: async (s: string) => { written.push(s); },
      },
    };
    expect(await copyToClipboard('sess-xyz')).toBe(true);
    expect(written).toEqual(['sess-xyz']);
  });

  it('clipboard.writeText reject 시 false (silent · throw 안 함)', async () => {
    (globalThis as unknown as { navigator: unknown }).navigator = {
      clipboard: {
        writeText: async () => { throw new Error('insecure context'); },
      },
    };
    expect(await copyToClipboard('sess-xyz')).toBe(false);
  });
});
