// ── X7 (Phase 1 Bundle 3) — vision-query parser additions tests ──

import { describe, expect, test } from 'bun:test';
import { parseVoiceSurfaceIntent } from '../../../src/voice/intent-router/voice-to-surface-intent';

describe('parseVoiceSurfaceIntent — X7 vision-query KO patterns', () => {
  test('"이 화면 무슨 일이야"', () => {
    const r = parseVoiceSurfaceIntent('이 화면 무슨 일이야');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('screen-vision-query');
    expect(r!.lane).toBe('ko');
  });

  test('"이 화면 무슨 일이야?"', () => {
    const r = parseVoiceSurfaceIntent('이 화면 무슨 일이야?');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"지금 화면 어떻게 됐어"', () => {
    const r = parseVoiceSurfaceIntent('지금 화면 어떻게 됐어');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"이 pane 분석해줘"', () => {
    const r = parseVoiceSurfaceIntent('이 pane 분석해줘');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"현재 화면 보여줘"', () => {
    const r = parseVoiceSurfaceIntent('현재 화면 보여줘');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"이 화면 상태"', () => {
    const r = parseVoiceSurfaceIntent('이 화면 상태');
    expect(r!.kind).toBe('screen-vision-query');
  });
});

describe('parseVoiceSurfaceIntent — X7 vision-query EN patterns', () => {
  test('"what\'s on screen"', () => {
    const r = parseVoiceSurfaceIntent("what's on screen");
    expect(r!.kind).toBe('screen-vision-query');
    expect(r!.lane).toBe('en');
  });

  test('"what is happening on the terminal"', () => {
    const r = parseVoiceSurfaceIntent('what is happening on the terminal');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"describe this pane"', () => {
    const r = parseVoiceSurfaceIntent('describe this pane');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"analyze the screen"', () => {
    const r = parseVoiceSurfaceIntent('analyze the screen');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"read this output"', () => {
    const r = parseVoiceSurfaceIntent('read this output');
    expect(r!.kind).toBe('screen-vision-query');
  });

  test('"what\'s wrong with the screen"', () => {
    const r = parseVoiceSurfaceIntent("what's wrong with the screen");
    expect(r!.kind).toBe('screen-vision-query');
  });
});

describe('parseVoiceSurfaceIntent — vision-query negative cases', () => {
  test('mentions "screen" but not as query → null', () => {
    expect(parseVoiceSurfaceIntent('the screen is')).toBeNull();
  });

  test('vision-query precedence over word-select when both possible', () => {
    // "이 화면 무슨 단어들" — vision query wins because it matches the
    // more specific pattern first (prefixed by "이 화면 무슨").
    const r = parseVoiceSurfaceIntent('이 화면 무슨 단어들');
    expect(r!.kind).toBe('screen-vision-query');
  });
});
