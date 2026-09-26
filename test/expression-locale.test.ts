import { describe, expect, test } from 'bun:test';
import { detectLocale, isLocale, LOCALES } from '../src/expression/index.js';

describe('expression/locale · detectLocale', () => {
  test('ELANOUS_LANG=ko wins over LANG', () => {
    expect(detectLocale({ ELANOUS_LANG: 'ko', LANG: 'en_US.UTF-8' } as NodeJS.ProcessEnv)).toBe('ko');
  });

  test('ELANOUS_LANG=en wins over Korean LANG', () => {
    expect(detectLocale({ ELANOUS_LANG: 'en', LANG: 'ko_KR.UTF-8' } as NodeJS.ProcessEnv)).toBe('en');
  });

  test('unsupported ELANOUS_LANG falls through to env chain', () => {
    expect(detectLocale({ ELANOUS_LANG: 'fr', LANG: 'ko_KR.UTF-8' } as NodeJS.ProcessEnv)).toBe('ko');
    expect(detectLocale({ ELANOUS_LANG: 'fr', LANG: 'en_US.UTF-8' } as NodeJS.ProcessEnv)).toBe('en');
  });

  test('LC_ALL beats LC_MESSAGES beats LANG', () => {
    expect(detectLocale({ LC_ALL: 'ko_KR', LC_MESSAGES: 'en_US', LANG: 'en_US' } as NodeJS.ProcessEnv)).toBe('ko');
    expect(detectLocale({ LC_MESSAGES: 'ko_KR', LANG: 'en_US' } as NodeJS.ProcessEnv)).toBe('ko');
    expect(detectLocale({ LANG: 'ko_KR' } as NodeJS.ProcessEnv)).toBe('ko');
  });

  test('empty env → en fallback', () => {
    expect(detectLocale({} as NodeJS.ProcessEnv)).toBe('en');
  });

  test('LANG without underscore (e.g. "ko") still resolves', () => {
    expect(detectLocale({ LANG: 'ko' } as NodeJS.ProcessEnv)).toBe('ko');
  });

  test('case-insensitive ELANOUS_LANG match', () => {
    expect(detectLocale({ ELANOUS_LANG: 'KO' } as NodeJS.ProcessEnv)).toBe('ko');
    expect(detectLocale({ ELANOUS_LANG: 'En' } as NodeJS.ProcessEnv)).toBe('en');
    expect(detectLocale({ ELANOUS_LANG: 'JA' } as NodeJS.ProcessEnv)).toBe('ja');
    expect(detectLocale({ ELANOUS_LANG: 'ZH' } as NodeJS.ProcessEnv)).toBe('zh');
  });

  test('whitespace-padded ELANOUS_LANG normalizes', () => {
    expect(detectLocale({ ELANOUS_LANG: '  ko  ' } as NodeJS.ProcessEnv)).toBe('ko');
  });

  test('Japanese LANG variants resolve to ja', () => {
    expect(detectLocale({ LANG: 'ja_JP.UTF-8' } as NodeJS.ProcessEnv)).toBe('ja');
    expect(detectLocale({ LANG: 'ja' } as NodeJS.ProcessEnv)).toBe('ja');
    expect(detectLocale({ ELANOUS_LANG: 'ja' } as NodeJS.ProcessEnv)).toBe('ja');
  });

  test('Chinese LANG variants resolve to zh (Simplified Chinese)', () => {
    expect(detectLocale({ LANG: 'zh_CN.UTF-8' } as NodeJS.ProcessEnv)).toBe('zh');
    expect(detectLocale({ LANG: 'zh_TW.UTF-8' } as NodeJS.ProcessEnv)).toBe('zh');
    expect(detectLocale({ LANG: 'zh' } as NodeJS.ProcessEnv)).toBe('zh');
  });

  test('ELANOUS_LANG variant forms (zh-CN, zh_TW, ja-JP) collapse to base locale', () => {
    expect(detectLocale({ ELANOUS_LANG: 'zh-CN' } as NodeJS.ProcessEnv)).toBe('zh');
    expect(detectLocale({ ELANOUS_LANG: 'zh_TW' } as NodeJS.ProcessEnv)).toBe('zh');
    expect(detectLocale({ ELANOUS_LANG: 'ja-JP' } as NodeJS.ProcessEnv)).toBe('ja');
    expect(detectLocale({ ELANOUS_LANG: 'en-US' } as NodeJS.ProcessEnv)).toBe('en');
  });

  test('LC_ALL precedence honoured for ja/zh too', () => {
    expect(
      detectLocale({ LC_ALL: 'ja_JP', LC_MESSAGES: 'en_US', LANG: 'en_US' } as NodeJS.ProcessEnv),
    ).toBe('ja');
    expect(
      detectLocale({ LC_ALL: 'zh_CN', LC_MESSAGES: 'ko_KR', LANG: 'en_US' } as NodeJS.ProcessEnv),
    ).toBe('zh');
  });
});

describe('expression/locale · isLocale', () => {
  test('positive cases', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ko')).toBe(true);
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('zh')).toBe(true);
  });

  test('negative cases', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('zh-CN')).toBe(false); // variant — caller must collapse first
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(isLocale({})).toBe(false);
  });
});

describe('expression/locale · LOCALES', () => {
  test('exposes en + ko + ja + zh', () => {
    expect(LOCALES).toContain('en');
    expect(LOCALES).toContain('ko');
    expect(LOCALES).toContain('ja');
    expect(LOCALES).toContain('zh');
    expect(LOCALES.length).toBe(4);
  });
});
