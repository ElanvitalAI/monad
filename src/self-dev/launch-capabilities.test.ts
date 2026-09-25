import { describe, expect, test } from 'bun:test';
import { launchCapabilityObservation, resolveLaunchCapabilities } from './launch-capabilities.js';

describe('resolveLaunchCapabilities — 결정 자리 «한 곳»', () => {
  test('명시 self-mission 무지정은 기존 dev CLI 자율 기본값을 resolver default로 낸다', () => {
    expect(resolveLaunchCapabilities({ defaultProfile: 'self-mission' })).toEqual({
      completion: { value: 'auto-merge', source: 'default' },
      autoReview: { value: true, source: 'default' },
    });
  });

  test('profile 없는 직접 호출은 안전 기본을 유지한다', () => {
    expect(resolveLaunchCapabilities()).toEqual({
      completion: { value: 'worktree-only', source: 'default' },
      autoReview: { value: false, source: 'default' },
    });
  });

  test('plan-staged 무지정도 기존 auto-merge를 resolver default로 보존한다', () => {
    expect(resolveLaunchCapabilities({ defaultProfile: 'plan-staged' })).toEqual({
      completion: { value: 'auto-merge', source: 'default' },
      autoReview: { value: false, source: 'default' },
    });
  });

  test('안전 표면도 resolver 안에서만 자기 무지정 기본값을 낸다', () => {
    expect(resolveLaunchCapabilities({ defaultProfile: 'safe' })).toEqual({
      completion: { value: 'worktree-only', source: 'default' },
      autoReview: { value: false, source: 'default' },
    });
  });

  test('명시하면 그 값 ⊕ source=request', () => {
    expect(resolveLaunchCapabilities({ completion: 'pr', autoReview: true })).toEqual({
      completion: { value: 'pr', source: 'request' },
      autoReview: { value: true, source: 'request' },
    });
  });

  test('⛔ `false` 는 「말하지 않았다」가 «아니다» — 명시적 끄기다', () => {
    // 🔑 이 창이 오늘 밟은 형태: --no-* 로 «끈» 것을 「안 줬다」로 세면 기본값이 이겨 버린다.
    const r = resolveLaunchCapabilities({ autoReview: false });
    expect(r.autoReview).toEqual({ value: false, source: 'request' });
    expect(r.autoReview.source).not.toBe('default');
  });

  test('호출자가 «출처를 알면» 그것이 이긴다 — 재라우팅이 원래 출처를 잃지 않는다', () => {
    const r = resolveLaunchCapabilities({ completion: 'pr', completionSource: 'config' });
    expect(r.completion).toEqual({ value: 'pr', source: 'config' });
  });

  test('⛔ 축은 «서로 독립»이다 — 하나를 줬다고 다른 하나가 request 가 되지 않는다', () => {
    const r = resolveLaunchCapabilities({ completion: 'pr' });
    expect(r.completion.source).toBe('request');
    expect(r.autoReview.source).toBe('default');
  });
});

describe('launchCapabilityObservation — 값 «옆»에 출처', () => {
  test('축·값·출처를 그대로 낸다', () => {
    expect(launchCapabilityObservation('completion', { value: 'pr', source: 'request' }))
      .toEqual({ axis: 'completion', effectiveValue: 'pr', source: 'request' });
  });

  test('⛔ 「안 준 것」을 채우지 않는다 — 칸이 셋뿐이다', () => {
    const observed = launchCapabilityObservation('autoReview', { value: false, source: 'default' });
    expect(Object.keys(observed).sort()).toEqual(['axis', 'effectiveValue', 'source']);
    // ⛔ 「같은 것의 두 이름」을 만들지 않는다 — value 라는 별칭을 «안 낸다».
    expect(Object.hasOwn(observed, 'value')).toBe(false);
  });
});
