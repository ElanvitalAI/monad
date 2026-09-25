// ── V4 (Phase 1 Bundle 2) — voice-to-surface-intent parser tests ──

import { describe, expect, test } from 'bun:test';
import {
  parseVoiceSurfaceIntent,
  envelopeVoiceSurfaceIntent,
} from '../../../src/voice/intent-router/voice-to-surface-intent';

describe('parseVoiceSurfaceIntent — Korean lane', () => {
  test('"line 42 의 단어들 받아 적어줘"', () => {
    const r = parseVoiceSurfaceIntent('line 42 의 단어들 받아 적어줘');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('word-select-line');
    expect(r!.line).toBe(42);
    expect(r!.lane).toBe('ko');
  });

  test('"라인 12 단어"', () => {
    const r = parseVoiceSurfaceIntent('라인 12 단어');
    expect(r!.kind).toBe('word-select-line');
    expect(r!.line).toBe(12);
  });

  test('"line 5 받아 적어줘" (no 단어 keyword) → range-select-line', () => {
    const r = parseVoiceSurfaceIntent('line 5 받아 적어줘');
    expect(r!.kind).toBe('range-select-line');
    expect(r!.line).toBe(5);
  });

  test('"line 42 의 3 번째 단어"', () => {
    const r = parseVoiceSurfaceIntent('line 42 의 3 번째 단어');
    expect(r!.kind).toBe('word-select-token');
    expect(r!.line).toBe(42);
    expect(r!.column).toBe(3);
  });

  test('"이 줄 단어들" → line=0 sentinel', () => {
    const r = parseVoiceSurfaceIntent('이 줄 단어들 가져와');
    expect(r!.kind).toBe('word-select-line');
    expect(r!.line).toBe(0);
  });
});

describe('parseVoiceSurfaceIntent — English lane', () => {
  test('"select line 42 words"', () => {
    const r = parseVoiceSurfaceIntent('select line 42 words');
    expect(r!.kind).toBe('word-select-line');
    expect(r!.line).toBe(42);
    expect(r!.lane).toBe('en');
  });

  test('"select line 42" → range-select-line', () => {
    const r = parseVoiceSurfaceIntent('select line 42');
    expect(r!.kind).toBe('range-select-line');
    expect(r!.line).toBe(42);
  });

  test('"word at line 7 column 3"', () => {
    const r = parseVoiceSurfaceIntent('word at line 7 column 3');
    expect(r!.kind).toBe('word-select-token');
    expect(r!.line).toBe(7);
    expect(r!.column).toBe(3);
  });

  test('"grab line 99 words"', () => {
    const r = parseVoiceSurfaceIntent('grab line 99 words');
    expect(r!.kind).toBe('word-select-line');
    expect(r!.line).toBe(99);
  });
});

describe('parseVoiceSurfaceIntent — non-matches', () => {
  test('empty string → null', () => {
    expect(parseVoiceSurfaceIntent('')).toBeNull();
    expect(parseVoiceSurfaceIntent('   ')).toBeNull();
  });

  test('unrelated phrase → null', () => {
    expect(parseVoiceSurfaceIntent('what is the weather')).toBeNull();
    expect(parseVoiceSurfaceIntent('자세히 설명해줘')).toBeNull();
  });

  test('non-string → null', () => {
    expect(parseVoiceSurfaceIntent(undefined as unknown as string)).toBeNull();
  });
});

describe('envelopeVoiceSurfaceIntent', () => {
  const exposure = { userExposure: 'user-interactive' as const, agentInteractive: true };

  test('word-select-line → SerializableSurfaceIntent kind=word-select with row=line-1', () => {
    const voice = parseVoiceSurfaceIntent('line 42 의 단어들')!;
    const env = envelopeVoiceSurfaceIntent({
      voice, surfaceId: 's1', paneKind: 'preview-terminal', exposure,
    });
    expect(env.kind).toBe('word-select');
    expect(env.row).toBe(41);
    expect(env.col).toBe(0);
    expect(env.surfaceId).toBe('s1');
    expect(env.exposure).toEqual(exposure);
    expect(env.capability.canInspect).toBe(true);
  });

  test('word-select-token → row+col converted from 1-based', () => {
    const voice = parseVoiceSurfaceIntent('line 5 의 3 번째 단어')!;
    const env = envelopeVoiceSurfaceIntent({
      voice, surfaceId: 's1', paneKind: 'preview-terminal', exposure,
    });
    expect(env.row).toBe(4);
    expect(env.col).toBe(2);
  });

  test('range-select-line → range-select-end with col=MAX_SAFE_INTEGER', () => {
    const voice = parseVoiceSurfaceIntent('select line 7')!;
    const env = envelopeVoiceSurfaceIntent({
      voice, surfaceId: 's1', paneKind: 'preview-terminal', exposure,
    });
    expect(env.kind).toBe('range-select-end');
    expect(env.row).toBe(6);
    expect(env.col).toBe(Number.MAX_SAFE_INTEGER);
  });

  test('line=0 sentinel resolved via resolveCaretLine', () => {
    const voice = parseVoiceSurfaceIntent('이 줄 단어들 가져와')!;
    expect(voice.line).toBe(0);
    const env = envelopeVoiceSurfaceIntent({
      voice, surfaceId: 's1', paneKind: 'preview-terminal', exposure,
      resolveCaretLine: () => 12,
    });
    expect(env.row).toBe(11);
  });

  test('line=0 with no resolver → row=0', () => {
    const voice = parseVoiceSurfaceIntent('이 줄 단어들 가져와')!;
    const env = envelopeVoiceSurfaceIntent({
      voice, surfaceId: 's1', paneKind: 'preview-terminal', exposure,
    });
    expect(env.row).toBe(0);
  });

  test('observe-only exposure → canWrite=false in envelope', () => {
    const voice = parseVoiceSurfaceIntent('line 1 단어들')!;
    const env = envelopeVoiceSurfaceIntent({
      voice, surfaceId: 's1', paneKind: 'preview-terminal',
      exposure: { userExposure: 'observe-only', agentInteractive: true },
    });
    expect(env.capability.canWrite).toBe(false);
    expect(env.capability.canInspect).toBe(true);
  });
});
