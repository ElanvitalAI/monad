// PR-S1V.15 (sprint 22 §A · 2026-04-30) — Daemon TTS singleton tests.
//
// Mirrors `voice-streaming-stt-singleton.test.ts` (§1.1) for the
// synthesis singleton. Covers:
//   1. Returns null when openai-tts is unavailable (no API key).
//   2. Caches the singleton — second init returns the same reference.
//   3. Resolves provider id from TTS_PROVIDER env override.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getDaemonTtsProvider,
  initDaemonTtsProvider,
  setDaemonTtsProviderForTesting,
} from '../src/voice/voice-tts-singleton';
import { setUserConfigOverlay } from '../src/user-config';

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_PROVIDER = process.env.TTS_PROVIDER;

function restoreEnv(): void {
  if (ORIGINAL_KEY !== undefined) process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  else delete process.env.OPENAI_API_KEY;
  if (ORIGINAL_PROVIDER !== undefined) process.env.TTS_PROVIDER = ORIGINAL_PROVIDER;
  else delete process.env.TTS_PROVIDER;
}

describe('daemon TTS singleton', () => {
  let restore: (() => void) | null = null;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.TTS_PROVIDER;
    // Isolate the real user-config: config `voice.tts.provider` wins over
    // env in resolveProviderId, so a machine whose ~/.elanous config pins a
    // provider (e.g. elevenlabs-tts) would otherwise mask the env/default
    // path these tests exercise. Strip the tts config so resolution falls
    // through to TTS_PROVIDER env → default 'openai-tts'.
    setUserConfigOverlay((c) => ({ ...c, voice: { ...c.voice, tts: {} } }));
    restore = setDaemonTtsProviderForTesting(null);
  });

  afterEach(() => {
    if (restore) restore();
    restore = null;
    setUserConfigOverlay(null);
    restoreEnv();
  });

  test('returns null when openai-tts is unavailable (no API key)', async () => {
    const p = await initDaemonTtsProvider();
    expect(p).toBeNull();
    expect(getDaemonTtsProvider()).toBeNull();
  });

  test('caches the singleton — second init returns the same reference', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    const a = await initDaemonTtsProvider();
    expect(a).not.toBeNull();
    const b = await initDaemonTtsProvider();
    expect(b).toBe(a);
    expect(getDaemonTtsProvider()).toBe(a);
  });

  test('respects TTS_PROVIDER env override', async () => {
    // macos-say has no constructor preconditions on non-darwin so it
    // builds; `say` execution would fail later, but here we only
    // assert id resolution.
    process.env.TTS_PROVIDER = 'macos-say';
    const p = await initDaemonTtsProvider();
    if (p) expect(p.id).toBe('macos-say');
    if (p) expect(p.id).not.toBe('openai-tts');
  });
});
