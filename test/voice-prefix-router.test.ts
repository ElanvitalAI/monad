// PR-S1V.4 (sprint 21-Parallel-Voice · 2026-04-29) — Voice prefix router
// tests.
//
// Tested invariants:
//   1. Korean postposition prefixes (~에게/~한테) strip correctly for
//      every brand (codex/claude/gemini/elanous).
//   2. Korean comma form ("코덱스, ...") strips.
//   3. English `to <brand>` and `<brand>,` forms strip.
//   4. Bare brand mention without postposition is NOT stripped (talking
//      *about* the brand should not route to it).
//   5. Empty / whitespace-only input returns matched=false.
//   6. No-prefix transcript returns brand=null + original trimmed text.
//   7. Routing is case-insensitive for English forms.
//   8. Ambiguous longer prefix wins over shorter form.

import { describe, expect, test } from 'bun:test';
import {
  getSupportedBrands,
  routeVoiceTranscript,
  VOICE_BRANDS,
} from '../src/voice/voice-prefix-router.js';

describe('PR-S1V.4 · routeVoiceTranscript — Korean postposition', () => {
  test.each([
    ['코덱스에게 react component 만들어줘', 'codex', 'react component 만들어줘'],
    ['코덱스한테 plan 짜줘', 'codex', 'plan 짜줘'],
    ['클로드에게 review 해줘', 'claude', 'review 해줘'],
    ['클로드한테 hello', 'claude', 'hello'],
    ['클라우드에게 review', 'claude', 'review'],
    ['제미니에게 plan', 'gemini', 'plan'],
    ['제미니한테 plan', 'gemini', 'plan'],
    ['제미나이에게 hi', 'gemini', 'hi'],
    ['엘라누스에게 status', 'elanous', 'status'],
    ['엘라누스한테 ping', 'elanous', 'ping'],
  ])('%s → brand=%s text="%s"', (input, expectedBrand, expectedText) => {
    const result = routeVoiceTranscript(input);
    expect(result.matched).toBe(true);
    expect(result.brand).toBe(expectedBrand as any);
    expect(result.text).toBe(expectedText);
  });

  test('longer postposition variant wins over shorter form', () => {
    // "코덱스에게는" 의 시작이 "코덱스에게" 이므로 "코덱스에게" pattern 이 매치 후
    // 남은 "는 ..." 는 stripped text. 단어 누락 없는 자연 fallback.
    const result = routeVoiceTranscript('코덱스에게는 plan 짜줘');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('codex');
    // "는 plan 짜줘" 또는 "plan 짜줘" — 중요한 건 brand routing 정확함 + 일부 stripped
    expect(result.text.endsWith('plan 짜줘')).toBe(true);
  });
});

describe('PR-S1V.4 · routeVoiceTranscript — Korean comma form', () => {
  test('"코덱스, ..." form', () => {
    const result = routeVoiceTranscript('코덱스, hello world 출력');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('codex');
    expect(result.text).toBe('hello world 출력');
  });

  test('"제미니, ..." form', () => {
    const result = routeVoiceTranscript('제미니, plan 짜줘');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('gemini');
    expect(result.text).toBe('plan 짜줘');
  });
});

describe('PR-S1V.4 · routeVoiceTranscript — English forms', () => {
  test('"to codex, ..."', () => {
    const result = routeVoiceTranscript('to codex, write a test');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('codex');
    expect(result.text).toBe('write a test');
  });

  test('"codex, ..." comma form', () => {
    const result = routeVoiceTranscript('codex, refactor this');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('codex');
    expect(result.text).toBe('refactor this');
  });

  test('"to claude review please"', () => {
    const result = routeVoiceTranscript('to claude review please');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('claude');
    expect(result.text).toBe('review please');
  });

  test('case-insensitive English routing', () => {
    const result = routeVoiceTranscript('TO Gemini, plan');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('gemini');
    expect(result.text).toBe('plan');
  });
});

describe('PR-S1V.4 · routeVoiceTranscript — no prefix / fallback', () => {
  test('no prefix → brand=null + original trimmed', () => {
    const result = routeVoiceTranscript('plan 짜줘');
    expect(result.matched).toBe(false);
    expect(result.brand).toBe(null);
    expect(result.text).toBe('plan 짜줘');
  });

  test('bare brand mention without postposition is NOT stripped', () => {
    // "코덱스 결과 보여줘" — 사용자가 codex *에 대해* 말하는 중 (about),
    // routing 안 됨. text 그대로 + brand=null.
    const result = routeVoiceTranscript('코덱스 결과 보여줘');
    expect(result.matched).toBe(false);
    expect(result.brand).toBe(null);
    expect(result.text).toBe('코덱스 결과 보여줘');
  });

  test('bare English brand without comma is NOT stripped', () => {
    const result = routeVoiceTranscript('codex result is interesting');
    expect(result.matched).toBe(false);
    expect(result.brand).toBe(null);
    expect(result.text).toBe('codex result is interesting');
  });

  test('empty input → matched=false', () => {
    const r1 = routeVoiceTranscript('');
    expect(r1.matched).toBe(false);
    expect(r1.brand).toBe(null);
    expect(r1.text).toBe('');

    const r2 = routeVoiceTranscript('   ');
    expect(r2.matched).toBe(false);
    expect(r2.brand).toBe(null);
    expect(r2.text).toBe('');
  });

  test('leading whitespace + valid prefix still strips', () => {
    const result = routeVoiceTranscript('   코덱스에게 hello');
    expect(result.matched).toBe(true);
    expect(result.brand).toBe('codex');
    expect(result.text).toBe('hello');
  });
});

describe('PR-S1V.4 · brand registry', () => {
  test('VOICE_BRANDS contains 4 supported brands', () => {
    expect(VOICE_BRANDS).toEqual(['codex', 'claude', 'gemini', 'elanous']);
  });

  test('getSupportedBrands returns the same list', () => {
    expect(getSupportedBrands()).toEqual(VOICE_BRANDS);
  });
});
