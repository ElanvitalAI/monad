// ── X7 (Phase 1 Bundle 3) — vision-screen-query orchestrator tests ──

import { describe, expect, test } from 'bun:test';
import { runVisionScreenQuery } from '../../src/voice/vision-screen-query';

describe('runVisionScreenQuery', () => {
  test('full happy path → spoken outcome', async () => {
    const spoken: string[] = [];
    const out = await runVisionScreenQuery({ transcript: '이 화면 무슨 일이야' }, {
      resolveFocusedSurface: () => ({
        args: { paneId: 'p1' },
        surfaceLabel: 'vw:3/runner',
      }),
      dispatchScreenshot: async () => ({ bodyBase64: 'AAA==', bytes: 100 }),
      visionProvider: async () => '빨간색 에러 메시지가 보입니다.',
      speak: async (sentence) => { spoken.push(sentence); },
    });
    expect(out.outcome).toBe('spoken');
    expect(out.utterance).toBe('빨간색 에러 메시지가 보입니다.');
    expect(out.screenshotLabel).toBe('vw:3/runner');
    expect(spoken).toEqual(['빨간색 에러 메시지가 보입니다.']);
  });

  test('no focused surface → graceful skip with utterance', async () => {
    const spoken: string[] = [];
    const out = await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => null,
      dispatchScreenshot: async () => ({ bodyBase64: 'AAA' }),
      visionProvider: async () => 'should not be called',
      speak: async (s) => { spoken.push(s); },
    });
    expect(out.outcome).toBe('no-focused-surface');
    expect(spoken[0]).toContain('포커스');
  });

  test('screenshot returns no body → screenshot-failed', async () => {
    const out = await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'p' }),
      dispatchScreenshot: async () => ({ bytes: 0 }),
      visionProvider: async () => 'irrelevant',
      speak: async () => {},
    });
    expect(out.outcome).toBe('screenshot-failed');
  });

  test('screenshot exceeds budget → screenshot-failed', async () => {
    const out = await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'p' }),
      dispatchScreenshot: () => new Promise((r) => setTimeout(() => r({ bodyBase64: 'A' }), 200)),
      visionProvider: async () => 'irrelevant',
      speak: async () => {},
      screenshotBudgetMs: 50,
    });
    expect(out.outcome).toBe('screenshot-failed');
  });

  test('vision provider returns null → vision-failed', async () => {
    const out = await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'p' }),
      dispatchScreenshot: async () => ({ bodyBase64: 'A' }),
      visionProvider: async () => null,
      speak: async () => {},
    });
    expect(out.outcome).toBe('vision-failed');
  });

  test('vision provider throws → vision-failed (graceful)', async () => {
    const out = await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'p' }),
      dispatchScreenshot: async () => ({ bodyBase64: 'A' }),
      visionProvider: async () => { throw new Error('rate limit'); },
      speak: async () => {},
    });
    expect(out.outcome).toBe('vision-failed');
  });

  test('vision exceeds budget → vision-failed', async () => {
    const out = await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'p' }),
      dispatchScreenshot: async () => ({ bodyBase64: 'A' }),
      visionProvider: () => new Promise((r) => setTimeout(() => r('late'), 200)),
      speak: async () => {},
      visionBudgetMs: 50,
    });
    expect(out.outcome).toBe('vision-failed');
  });

  test('speak throws → tts-failed but utterance returned', async () => {
    const out = await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'p' }),
      dispatchScreenshot: async () => ({ bodyBase64: 'A' }),
      visionProvider: async () => 'a description',
      speak: async () => { throw new Error('audio dead'); },
    });
    expect(out.outcome).toBe('tts-failed');
    expect(out.utterance).toBe('a description');
  });

  test('vision sentence with whitespace is trimmed', async () => {
    const spoken: string[] = [];
    await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'p' }),
      dispatchScreenshot: async () => ({ bodyBase64: 'A' }),
      visionProvider: async () => '   trimmed sentence   ',
      speak: async (s) => { spoken.push(s); },
    });
    expect(spoken[0]).toBe('trimmed sentence');
  });

  test('screenshot args include format=png', async () => {
    let captured: Record<string, unknown> | null = null;
    await runVisionScreenQuery({ transcript: 'q' }, {
      resolveFocusedSurface: () => ({ args: { paneId: 'p1' }, surfaceLabel: 'p' }),
      dispatchScreenshot: async (args) => {
        captured = args;
        return { bodyBase64: 'A' };
      },
      visionProvider: async () => 'ok',
      speak: async () => {},
    });
    expect(captured).toEqual({ paneId: 'p1', format: 'png' });
  });

  test('vision provider receives full transcript + screenshot payload', async () => {
    let receivedTranscript = '';
    let receivedScreenshot: { bodyBase64: string; mimeType: string; bytes: number; surfaceLabel?: string } | null = null;
    await runVisionScreenQuery({ transcript: 'what about this pane' }, {
      resolveFocusedSurface: () => ({ args: {}, surfaceLabel: 'preview' }),
      dispatchScreenshot: async () => ({ bodyBase64: 'AAAB', bytes: 4 }),
      visionProvider: async ({ transcript, screenshot }) => {
        receivedTranscript = transcript;
        receivedScreenshot = screenshot;
        return 'ok';
      },
      speak: async () => {},
    });
    expect(receivedTranscript).toBe('what about this pane');
    expect(receivedScreenshot!.bodyBase64).toBe('AAAB');
    expect(receivedScreenshot!.mimeType).toBe('image/png');
    expect(receivedScreenshot!.surfaceLabel).toBe('preview');
  });
});
