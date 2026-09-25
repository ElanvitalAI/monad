// W9c U5 · patcher-config parser + source.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PATCHER_CONFIG,
  loadPatcherConfig,
  parsePatcherConfig,
} from '../../src/background-reasoning/patcher-config';

describe('parsePatcherConfig', () => {
  test('parses key:value lines, ignores comments + blanks', () => {
    const out = parsePatcherConfig([
      '# enable the patcher',
      'enabled: true',
      '',
      'tickIntervalMs: 30000',
      'embeddingsEnabled: false',
    ].join('\n'));
    expect(out.enabled).toBe(true);
    expect(out.tickIntervalMs).toBe(30_000);
    expect(out.embeddingsEnabled).toBe(false);
  });

  test('boolean accepts true/yes/1', () => {
    expect(parsePatcherConfig('enabled: yes').enabled).toBe(true);
    expect(parsePatcherConfig('enabled: 1').enabled).toBe(true);
    expect(parsePatcherConfig('enabled: True').enabled).toBe(true);
    expect(parsePatcherConfig('enabled: false').enabled).toBe(false);
  });

  test('integers fall back to default on invalid input', () => {
    expect(parsePatcherConfig('tickIntervalMs: abc').tickIntervalMs).toBe(DEFAULT_PATCHER_CONFIG.tickIntervalMs);
    expect(parsePatcherConfig('tickIntervalMs: -1').tickIntervalMs).toBe(DEFAULT_PATCHER_CONFIG.tickIntervalMs);
  });

  test('unknown keys are ignored', () => {
    const out = parsePatcherConfig('foo: bar\nenabled: true');
    expect(out.enabled).toBe(true);
    expect(Object.keys(out)).toEqual(['enabled']);
  });
});

describe('loadPatcherConfig', () => {
  test('null source returns defaults', () => {
    const cfg = loadPatcherConfig({ read: () => null });
    expect(cfg).toEqual(DEFAULT_PATCHER_CONFIG);
  });

  test('source provides partial override; defaults fill the rest', () => {
    const cfg = loadPatcherConfig({ read: () => 'enabled: true' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.tickIntervalMs).toBe(DEFAULT_PATCHER_CONFIG.tickIntervalMs);
    expect(cfg.embeddingsEnabled).toBe(DEFAULT_PATCHER_CONFIG.embeddingsEnabled);
  });
});
