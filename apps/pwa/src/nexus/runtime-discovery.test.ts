// PWA · runtime-discovery tests (Phase N-4 PR ν)

import { describe, test, expect } from 'bun:test';
import { discoverNexusUrl } from './runtime-discovery';

describe('discoverNexusUrl', () => {
  test('env MONAD_NEXUS_URL beats everything', () => {
    const r = discoverNexusUrl({
      envSource: { MONAD_NEXUS_URL: 'http://my-nexus:5000/' },
      readRuntimeFile: () => ({
        pid: 1, startedAt: '', nexusVersion: '0', phase: '', httpPort: 9999,
      }),
    });
    expect(r.url).toBe('http://my-nexus:5000');
    expect(r.source).toBe('env');
  });

  test('runtime-file used when env absent + httpPort present', () => {
    const r = discoverNexusUrl({
      envSource: {},
      readRuntimeFile: () => ({
        pid: 1, startedAt: '', nexusVersion: '0', phase: '',
        httpPort: 31415, httpHost: '127.0.0.1',
      }),
    });
    expect(r.url).toBe('http://127.0.0.1:31415');
    expect(r.source).toBe('runtime-file');
    expect(r.runtime?.httpPort).toBe(31415);
  });

  test('runtime file with httpHost override', () => {
    const r = discoverNexusUrl({
      envSource: {},
      readRuntimeFile: () => ({
        pid: 1, startedAt: '', nexusVersion: '0', phase: '',
        httpPort: 41999, httpHost: 'tailscale-host',
      }),
    });
    expect(r.url).toBe('http://tailscale-host:41999');
  });

  test('fallback when no env + no runtime', () => {
    const r = discoverNexusUrl({
      envSource: {},
      readRuntimeFile: () => null,
    });
    expect(r.url).toBe('http://127.0.0.1:31415');
    expect(r.source).toBe('fallback');
  });

  test('fallback override honored', () => {
    const r = discoverNexusUrl({
      envSource: {},
      readRuntimeFile: () => null,
      fallbackUrl: 'http://custom-fallback:9000',
    });
    expect(r.url).toBe('http://custom-fallback:9000');
  });

  test('runtime missing httpPort → falls through to fallback', () => {
    const r = discoverNexusUrl({
      envSource: {},
      readRuntimeFile: () => ({ pid: 1, startedAt: '', nexusVersion: '0', phase: '' }),
    });
    expect(r.source).toBe('fallback');
  });

  test('trailing slash on env URL is stripped', () => {
    const r = discoverNexusUrl({
      envSource: { MONAD_NEXUS_URL: 'http://x/' },
      readRuntimeFile: () => null,
    });
    expect(r.url).toBe('http://x');
  });
});
