import { describe, expect, mock, test } from 'bun:test';

import {
  bootDashboardVoiceHost,
  reportDashboardVoiceBootError,
} from '../src/dashboard/voice-host-boot.js';

interface CapturedDetectorDeps {
  onPressFirst: () => void;
  onLongPress: () => void;
  onLongRelease: () => void;
  onTap: () => void;
}

function captureDetectorDeps(): {
  capture: (deps: CapturedDetectorDeps) => void;
  read: () => CapturedDetectorDeps;
} {
  let captured: CapturedDetectorDeps | null = null;
  return {
    capture: (deps) => { captured = deps; },
    read: () => {
      if (!captured) throw new Error('detector deps not captured yet');
      return captured;
    },
  };
}

describe('bootDashboardVoiceHost', () => {
  test('boots host, subscribes indicator, and wires longpress callbacks', async () => {
    const onIndicatorChange = mock((_label: string | null) => {});
    const requestRender = mock(() => {});
    const startDictation = mock(() => true);
    const stopDictation = mock(async () => {});
    const notePending = mock(() => {});
    const clearPending = mock(() => {});
    const detectorDeps = captureDetectorDeps();

    const result = await bootDashboardVoiceHost({
      voiceRuntime: {
        resolveSession: () => null,
        submitToSession: async () => {},
        dictateTranscript: () => true,
      },
      createSttProvider: async () => ({ id: 'openai-whisper' } as never),
      createVoiceInputHost: () => ({
        startDictation,
        stopDictation,
        notePending,
        clearPending,
        onIndicatorChange: (cb) => {
          cb({ visible: true, label: '🎙 Voice mode' });
          return () => {};
        },
      } as never),
      createLongPressDetector: (deps) => {
        detectorDeps.capture(deps);
        return { dispose: () => {} } as never;
      },
      onIndicatorChange,
      requestRender,
    });

    expect(onIndicatorChange).toHaveBeenCalledWith('🎙 Voice mode');
    expect(requestRender).toHaveBeenCalled();
    expect(result.host).toBeTruthy();
    expect(result.detector).toBeTruthy();

    // PR-S1V.D5+ smoothness — detector now has 4 callbacks. Verify the
    // wiring routes each one to the correct host method:
    //   onPressFirst   → host.notePending() (pending HUD indicator)
    //   onLongPress    → host.startDictation()
    //   onLongRelease  → onLongReleasePreShiftFocus (if provided) +
    //                    host.stopDictation()
    //   onTap          → host.clearPending() (cancel pending HUD)
    const wired = detectorDeps.read();
    wired.onPressFirst();
    expect(notePending).toHaveBeenCalledTimes(1);
    wired.onLongPress();
    expect(startDictation).toHaveBeenCalledTimes(1);
    wired.onLongRelease();
    expect(stopDictation).toHaveBeenCalledTimes(1);
    wired.onTap();
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  test('onLongReleasePreShiftFocus closure fires before stopDictation', async () => {
    const calls: string[] = [];
    const startDictation = mock(() => true);
    const stopDictation = mock(async () => { calls.push('stopDictation'); });
    const detectorDeps = captureDetectorDeps();

    await bootDashboardVoiceHost({
      voiceRuntime: {
        resolveSession: () => null,
        submitToSession: async () => {},
        dictateTranscript: () => true,
      },
      createSttProvider: async () => ({ id: 'openai-whisper' } as never),
      createVoiceInputHost: () => ({
        startDictation,
        stopDictation,
        notePending: () => {},
        clearPending: () => {},
        onIndicatorChange: () => () => {},
      } as never),
      createLongPressDetector: (deps) => {
        detectorDeps.capture(deps);
        return { dispose: () => {} } as never;
      },
      onIndicatorChange: () => {},
      requestRender: () => {},
      onLongReleasePreShiftFocus: () => { calls.push('preShiftFocus'); },
    });

    detectorDeps.read().onLongRelease();
    // Allow the void promise from stopDictation to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['preShiftFocus', 'stopDictation']);
  });

  test('formats boot errors into warning strings', () => {
    expect(reportDashboardVoiceBootError(new Error('boom'))).toBe(
      '  voice mode disabled — STTProvider boot failed: boom',
    );
  });
});
