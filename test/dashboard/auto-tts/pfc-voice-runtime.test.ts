// ── V1 (Phase 1 Bundle 2) — pfc-voice-runtime tests ──

import { describe, expect, test } from 'bun:test';
import { createPfcVoiceRuntime } from '../../../src/dashboard/auto-tts/pfc-voice-runtime';
import type { PfcReverseFeedbackNotification } from '../../../src/conductor/pfc-reverse-feedback';
import type { AutoTtsController } from '../../../src/dashboard/auto-tts/auto-tts-controller';

function fakeController(): AutoTtsController & {
  pushed: string[];
  commits: number;
} {
  const pushed: string[] = [];
  let commits = 0;
  return {
    pushed,
    get commits() { return commits; },
    isEnabled: () => true,
    isSpeaking: () => false,
    enable() { /* noop */ },
    disable() { /* noop */ },
    toggle() { return true; },
    pushChunk(delta: string) { pushed.push(delta); },
    async commit() { commits += 1; },
    async cancel() { /* noop */ },
  };
}

function notification(opts: Partial<PfcReverseFeedbackNotification> = {}): PfcReverseFeedbackNotification {
  return {
    shellId: opts.shellId ?? 's1',
    summary: opts.summary ?? '🧠 elanous · sh-s1 (exit 1) · AssertionError 발견',
    canApply: opts.canApply ?? true,
    capability: opts.capability ?? {
      canRead: true, canInterrupt: true, canWrite: true, canInspect: true,
    },
    research: opts.research ?? {
      classification: { clazz: 'error-with-trace', exitCode: 1, errorMarker: 'AssertionError', tail: '' },
      candidates: [{ label: 'AssertionError 발견', source: 'heuristic' }],
      elapsedMs: 5,
    },
  };
}

describe('createPfcVoiceRuntime', () => {
  test('disabled by default — no push', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({ getController: () => ctrl });
    rt.onNotification(notification());
    expect(ctrl.pushed).toEqual([]);
  });

  test('enabled push + commit', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({
      getController: () => ctrl,
      initiallyEnabled: true,
    });
    rt.onNotification(notification());
    expect(ctrl.pushed).toHaveLength(1);
    expect(ctrl.pushed[0]).toContain('에러가 발견됐습니다');
  });

  test('toggle flips state', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({ getController: () => ctrl });
    expect(rt.isEnabled()).toBe(false);
    expect(rt.toggle()).toBe(true);
    expect(rt.isEnabled()).toBe(true);
    rt.toggle();
    expect(rt.isEnabled()).toBe(false);
  });

  test('controller missing — graceful skip', () => {
    const rt = createPfcVoiceRuntime({
      getController: () => null,
      initiallyEnabled: true,
    });
    expect(() => rt.onNotification(notification())).not.toThrow();
  });

  test('canApply=false utterance uses V3 capability phrasing (출력만/종료된)', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({
      getController: () => ctrl,
      initiallyEnabled: true,
    });
    // canRead=true → V3 says "출력만 보이는 터미널이라 키보드 입력은 못
    // 가져갑니다." (observe-only)
    rt.onNotification(notification({
      canApply: false,
      capability: { canRead: true, canInterrupt: true, canWrite: false, canInspect: true },
    }));
    expect(ctrl.pushed[0]).toContain('출력만');
  });

  test('canApply=false + canRead=false → V3 says "종료된"', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({
      getController: () => ctrl,
      initiallyEnabled: true,
    });
    rt.onNotification(notification({
      canApply: false,
      capability: { canRead: false, canInterrupt: false, canWrite: false, canInspect: false },
    }));
    expect(ctrl.pushed[0]).toContain('종료');
  });

  test('timeout class produces timeout-specific phrasing', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({
      getController: () => ctrl,
      initiallyEnabled: true,
    });
    rt.onNotification(notification({
      research: {
        classification: { clazz: 'timeout', exitCode: undefined, errorMarker: null, tail: '' },
        candidates: [{ label: 'Timeout', source: 'heuristic' }],
        elapsedMs: 5,
      },
    }));
    expect(ctrl.pushed[0]).toContain('타임아웃');
  });

  test('custom composeUtterance honored', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({
      getController: () => ctrl,
      initiallyEnabled: true,
      composeUtterance: () => 'override sentence',
    });
    rt.onNotification(notification());
    expect(ctrl.pushed[0]).toBe('override sentence');
  });

  test('empty utterance is skipped', () => {
    const ctrl = fakeController();
    const rt = createPfcVoiceRuntime({
      getController: () => ctrl,
      initiallyEnabled: true,
      composeUtterance: () => '   ',
    });
    rt.onNotification(notification());
    expect(ctrl.pushed).toEqual([]);
  });
});
