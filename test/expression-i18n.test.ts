import { describe, expect, test } from 'bun:test';
import {
  getMessages,
  formatMessage,
  messagesEn,
  messagesKo,
  messagesJa,
  messagesZh,
  type Messages,
} from '../src/expression/index.js';

describe('expression/i18n · getMessages', () => {
  test('explicit locale "en" returns the English bundle', () => {
    expect(getMessages('en')).toBe(messagesEn);
  });

  test('explicit locale "ko" returns the Korean bundle', () => {
    expect(getMessages('ko')).toBe(messagesKo);
  });

  test('explicit locale "ja" returns the Japanese bundle', () => {
    expect(getMessages('ja')).toBe(messagesJa);
  });

  test('explicit locale "zh" returns the Simplified Chinese bundle', () => {
    expect(getMessages('zh')).toBe(messagesZh);
  });

  test('omitting locale defaults via env detection (returns one of the bundles)', () => {
    const m = getMessages();
    expect(
      m === messagesEn || m === messagesKo || m === messagesJa || m === messagesZh,
    ).toBe(true);
  });
});

describe('expression/i18n · format', () => {
  test('replaces single placeholder', () => {
    expect(formatMessage('Hello, {name}!', { name: 'world' })).toBe('Hello, world!');
  });

  test('replaces multiple placeholders', () => {
    expect(formatMessage('{n} of {total}', { n: 3, total: 7 })).toBe('3 of 7');
  });

  test('numeric values are coerced to string', () => {
    expect(formatMessage('count={n}', { n: 42 })).toBe('count=42');
  });

  test('missing key renders as empty string (silent)', () => {
    expect(formatMessage('Hi {name}', {})).toBe('Hi ');
  });

  test('null/undefined values render as empty string', () => {
    expect(
      formatMessage('a={a}b={b}', { a: null as unknown as string, b: undefined as unknown as string }),
    ).toBe('a=b=');
  });

  test('no-args call returns the template unchanged when there are no placeholders', () => {
    expect(formatMessage('plain string')).toBe('plain string');
  });

  test('repeated placeholders all get replaced', () => {
    expect(formatMessage('{x}-{x}-{x}', { x: 'a' })).toBe('a-a-a');
  });
});

describe('expression/i18n · bundle invariants', () => {
  const ALL_BUNDLES: ReadonlyArray<readonly [string, Messages]> = [
    ['en', messagesEn],
    ['ko', messagesKo],
    ['ja', messagesJa],
    ['zh', messagesZh],
  ];

  test('all 4 bundles share the same key set', () => {
    const enKeys = Object.keys(messagesEn).sort();
    for (const [name, bundle] of ALL_BUNDLES) {
      const keys = Object.keys(bundle).sort();
      expect({ locale: name, keys }).toEqual({ locale: name, keys: enKeys });
    }
  });

  test('every value in every bundle is a non-empty string', () => {
    for (const [name, bundle] of ALL_BUNDLES) {
      for (const key of Object.keys(bundle) as Array<keyof Messages>) {
        const v = bundle[key];
        expect(typeof v).toBe('string');
        expect({ locale: name, key, len: (v as string).length }).toEqual({
          locale: name,
          key,
          len: (v as string).length,
        });
        expect((v as string).length).toBeGreaterThan(0);
      }
    }
  });

  test('templated keys preserve {placeholder} markers across all locales', () => {
    const TEMPLATED: ReadonlyArray<keyof Messages> = [
      'stepLabel',
      'rangeError',
      'patternError',
      'retryingIn',
      'pressKeyToAction',
      'ariaProgress',
      'ariaSpinner',
      'ariaTable',
      'ariaPicker',
    ];
    for (const [, bundle] of ALL_BUNDLES) {
      for (const key of TEMPLATED) {
        expect(bundle[key]).toMatch(/\{[a-zA-Z]+\}/);
      }
    }
  });

  test('format applied to templated bundle entries fills placeholders', () => {
    expect(formatMessage(messagesEn.stepLabel, { n: 2, total: 5 })).toBe('Step 2 of 5');
    expect(formatMessage(messagesKo.stepLabel, { n: 2, total: 5 })).toBe('5 단계 중 2번째');
    expect(formatMessage(messagesJa.stepLabel, { n: 2, total: 5 })).toBe('ステップ 2 / 5');
    expect(formatMessage(messagesZh.stepLabel, { n: 2, total: 5 })).toBe(
      '第 2 步 / 共 5 步',
    );
  });
});
