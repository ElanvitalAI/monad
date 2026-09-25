import { describe, expect, it } from 'bun:test';

import {
  __INTERNAL_RESHOW_MS,
  detectPlatform,
  shouldShow,
} from './install-banner-state';

describe('detectPlatform', () => {
  it('returns beforeInstallPromptCapable when the event handle is present', () => {
    expect(detectPlatform('Mozilla/5.0 …', true)).toBe('beforeInstallPromptCapable');
  });

  it('returns iosSafari for iPhone Safari', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1';
    expect(detectPlatform(ua, false)).toBe('iosSafari');
  });

  it('returns iosSafari for iPad Safari', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1';
    expect(detectPlatform(ua, false)).toBe('iosSafari');
  });

  it('does not classify Chrome-on-iOS as iosSafari (no manual install path)', () => {
    const ua = 'Mozilla/5.0 (iPhone; …) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';
    expect(detectPlatform(ua, false)).toBe('unsupported');
  });

  it('returns unsupported for desktop Chrome without beforeinstallprompt', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537 Chrome/120 Safari/537';
    expect(detectPlatform(ua, false)).toBe('unsupported');
  });

  it('returns unsupported on missing/empty UA', () => {
    expect(detectPlatform(undefined, false)).toBe('unsupported');
    expect(detectPlatform('', false)).toBe('unsupported');
  });
});

describe('shouldShow', () => {
  const now = 1_700_000_000_000;

  it('shows when not standalone, supported, never dismissed', () => {
    expect(shouldShow({
      now,
      standalone: false,
      platform: 'iosSafari',
      dismissedAt: null,
    })).toEqual({ show: true, reason: 'show' });
  });

  it('hides when standalone — already installed', () => {
    expect(shouldShow({
      now,
      standalone: true,
      platform: 'iosSafari',
      dismissedAt: null,
    })).toEqual({ show: false, reason: 'standalone' });
  });

  it('hides when platform is unsupported', () => {
    expect(shouldShow({
      now,
      standalone: false,
      platform: 'unsupported',
      dismissedAt: null,
    })).toEqual({ show: false, reason: 'unsupported' });
  });

  it('hides when dismissed within the reshow window', () => {
    expect(shouldShow({
      now,
      standalone: false,
      platform: 'beforeInstallPromptCapable',
      dismissedAt: now - 1000,
    })).toEqual({ show: false, reason: 'recently-dismissed' });
  });

  it('reshows once the dismiss is older than 7 days', () => {
    expect(shouldShow({
      now,
      standalone: false,
      platform: 'beforeInstallPromptCapable',
      dismissedAt: now - __INTERNAL_RESHOW_MS - 1,
    })).toEqual({ show: true, reason: 'show' });
  });

  it('treats dismiss exactly at the window boundary as still dismissed', () => {
    expect(shouldShow({
      now,
      standalone: false,
      platform: 'iosSafari',
      dismissedAt: now - __INTERNAL_RESHOW_MS + 1,
    })).toEqual({ show: false, reason: 'recently-dismissed' });
  });
});
