// PR-S1V.7 (sprint 22 Phase 2) — boot helper + slash command tests.

import { afterEach, describe, expect, it } from 'bun:test';
import {
  bootDashboardAutoTts,
  handleAutoTtsSlash,
} from '../src/dashboard/auto-tts/auto-tts-host-boot.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

describe('bootDashboardAutoTts — env reading', () => {
  it('starts disabled when ELANOUS_AUTO_TTS unset', () => {
    delete process.env.ELANOUS_AUTO_TTS;
    const { controller } = bootDashboardAutoTts();
    expect(controller.isEnabled()).toBe(false);
  });

  it('honors ELANOUS_AUTO_TTS=1 / true / on / yes', () => {
    for (const v of ['1', 'true', 'on', 'yes', 'TRUE', 'On']) {
      process.env.ELANOUS_AUTO_TTS = v;
      const { controller } = bootDashboardAutoTts();
      expect(controller.isEnabled()).toBe(true);
    }
  });

  it('treats ELANOUS_AUTO_TTS=0 / false / off as disabled', () => {
    for (const v of ['0', 'false', 'off', 'no', '']) {
      process.env.ELANOUS_AUTO_TTS = v;
      const { controller } = bootDashboardAutoTts();
      expect(controller.isEnabled()).toBe(false);
    }
  });

  it('explicit opts.initiallyEnabled overrides env', () => {
    process.env.ELANOUS_AUTO_TTS = '1';
    const { controller } = bootDashboardAutoTts({ initiallyEnabled: false });
    expect(controller.isEnabled()).toBe(false);
  });

  it('resolves provider id from TTS_PROVIDER env, default openai-tts', () => {
    delete process.env.TTS_PROVIDER;
    expect(bootDashboardAutoTts().providerId).toBe('openai-tts');
    process.env.TTS_PROVIDER = 'edge-tts';
    expect(bootDashboardAutoTts().providerId).toBe('edge-tts');
    process.env.TTS_PROVIDER = 'macos-say';
    expect(bootDashboardAutoTts().providerId).toBe('macos-say');
  });

  it('hooks object provides pushChunk/commit/cancel bound to controller', async () => {
    const { hooks, controller } = bootDashboardAutoTts({ initiallyEnabled: false });
    // Smoke: calling hooks while disabled does nothing harmful.
    hooks.pushChunk('hi');
    await hooks.commit();
    await hooks.cancel();
    expect(controller.isSpeaking()).toBe(false);
  });
});

describe('handleAutoTtsSlash', () => {
  function makeController() {
    return bootDashboardAutoTts({ initiallyEnabled: false }).controller;
  }

  it('default subcommand reports status', () => {
    const c = makeController();
    expect(handleAutoTtsSlash(c, 'openai-tts', [])).toContain('off');
    expect(handleAutoTtsSlash(c, 'openai-tts', [])).toContain('openai-tts');
  });

  it('on/enable enables', () => {
    const c = makeController();
    handleAutoTtsSlash(c, 'openai-tts', ['on']);
    expect(c.isEnabled()).toBe(true);
    c.disable();
    handleAutoTtsSlash(c, 'openai-tts', ['enable']);
    expect(c.isEnabled()).toBe(true);
  });

  it('off/disable disables', () => {
    const c = makeController();
    c.enable();
    handleAutoTtsSlash(c, 'openai-tts', ['off']);
    expect(c.isEnabled()).toBe(false);
    c.enable();
    handleAutoTtsSlash(c, 'openai-tts', ['disable']);
    expect(c.isEnabled()).toBe(false);
  });

  it('toggle flips state', () => {
    const c = makeController();
    expect(c.isEnabled()).toBe(false);
    handleAutoTtsSlash(c, 'openai-tts', ['toggle']);
    expect(c.isEnabled()).toBe(true);
    handleAutoTtsSlash(c, 'openai-tts', ['toggle']);
    expect(c.isEnabled()).toBe(false);
  });

  it('unknown subcommand returns help message', () => {
    const c = makeController();
    const msg = handleAutoTtsSlash(c, 'openai-tts', ['bogus']);
    expect(msg).toContain('unknown');
    expect(msg).toContain('on/off/toggle/status');
  });

  it('reports the provider id in on/toggle/status', () => {
    const c = makeController();
    expect(handleAutoTtsSlash(c, 'edge-tts', ['on'])).toContain('edge-tts');
    expect(handleAutoTtsSlash(c, 'edge-tts', ['status'])).toContain('edge-tts');
  });
});
