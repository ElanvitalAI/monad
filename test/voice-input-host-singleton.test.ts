// Sprint 22 follow-up (2026-04-30) — voice-input-host singleton tests.
//
// Mirrors the streaming STT singleton tests pattern. Covers:
//   1. Default (unset) returns null.
//   2. set + get round-trip.
//   3. set(null) clears.
//   4. setForTesting restore handle reverts to prior state.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  getDaemonInputHost,
  setDaemonInputHost,
  setDaemonInputHostForTesting,
} from '../src/voice/daemon-input-host-singleton';

describe('voice-input-host-singleton', () => {
  afterEach(() => {
    setDaemonInputHost(null);
  });

  test('default state is null', () => {
    setDaemonInputHost(null);
    expect(getDaemonInputHost()).toBeNull();
  });

  test('set then get round-trip', () => {
    const handle = { dictateTranscript: (_text: string) => true };
    setDaemonInputHost(handle);
    expect(getDaemonInputHost()).toBe(handle);
  });

  test('set(null) clears the cache', () => {
    setDaemonInputHost({ dictateTranscript: () => true });
    expect(getDaemonInputHost()).not.toBeNull();
    setDaemonInputHost(null);
    expect(getDaemonInputHost()).toBeNull();
  });

  test('setForTesting restore reverts to prior state', () => {
    const original = { dictateTranscript: () => true };
    setDaemonInputHost(original);
    const restore = setDaemonInputHostForTesting({
      dictateTranscript: () => false,
    });
    expect(getDaemonInputHost()).not.toBe(original);
    restore();
    expect(getDaemonInputHost()).toBe(original);
  });
});
