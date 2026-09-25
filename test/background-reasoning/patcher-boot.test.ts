// W9d-FU U5 daemon boot composer — config gates + DI injection.

import { describe, expect, test } from 'bun:test';
import {
  buildPatcherSubstrate,
  stopPatcherSubstrate,
} from '../../src/background-reasoning/patcher-boot';
import { _resetUserIntentLogger } from '../../src/user-intent/logger';
import type { KgsCardStore } from '../../src/background-reasoning/patcher-daemon';
import type { KnowledgeCard } from '../../src/knowledge/kgs/types';

function makeStore(): KgsCardStore & { rows: Map<string, KnowledgeCard> } {
  const rows = new Map<string, KnowledgeCard>();
  return {
    rows,
    writeCard(card) { rows.set(card.id, card); },
    readCard(id) { return rows.get(id) ?? null; },
    cardCount() { return rows.size; },
  };
}

describe('buildPatcherSubstrate · gating', () => {
  test('config disabled → skip with reason + no handle', () => {
    _resetUserIntentLogger();
    const sub = buildPatcherSubstrate({
      configSource: { read: () => 'enabled: false' },
    });
    expect(sub.handle).toBeNull();
    expect(sub.skipReason).toBe('patcher-disabled-in-config');
    expect(sub.detail).toContain('enabled: true');
    expect(sub.config.enabled).toBe(false);
  });

  test('config absent → skip with reason (defaults to disabled)', () => {
    _resetUserIntentLogger();
    const sub = buildPatcherSubstrate({
      configSource: { read: () => null },
    });
    expect(sub.handle).toBeNull();
    expect(sub.skipReason).toBe('patcher-disabled-in-config');
  });

  test('enabled but LLM deps missing → skip with reason', () => {
    _resetUserIntentLogger();
    const sub = buildPatcherSubstrate({
      configSource: { read: () => 'enabled: true' },
    });
    expect(sub.handle).toBeNull();
    expect(sub.skipReason).toBe('patcher-llm-deps-missing');
    expect(sub.detail).toContain('entityExtractorCallable');
    expect(sub.config.enabled).toBe(true);
  });

  test('enabled but only one LLM dep missing → still skipped', () => {
    _resetUserIntentLogger();
    const sub = buildPatcherSubstrate({
      configSource: { read: () => 'enabled: true' },
      entityExtractorCallable: async () => ({ entities: [], relations: [] }),
      // embeddingCallable missing
    });
    expect(sub.skipReason).toBe('patcher-llm-deps-missing');
  });
});

describe('buildPatcherSubstrate · happy path', () => {
  test('enabled + both deps wired → handle returned', () => {
    _resetUserIntentLogger();
    const sub = buildPatcherSubstrate({
      configSource: { read: () => 'enabled: true\ntickIntervalMs: 60000' },
      entityExtractorCallable: async () => ({ entities: [], relations: [] }),
      embeddingCallable: async (texts) => texts.map(() => [0]),
      storeOverride: makeStore(),
    });
    expect(sub.handle).not.toBeNull();
    expect(sub.skipReason).toBeUndefined();
    expect(sub.config.enabled).toBe(true);
    // tickOnce smoke (the daemon was actually composed)
    expect(typeof sub.handle?.tickOnce).toBe('function');
    sub.handle?.stop();
  });

  test('config tickIntervalMs override reaches the daemon', () => {
    _resetUserIntentLogger();
    const sub = buildPatcherSubstrate({
      configSource: { read: () => 'enabled: true\ntickIntervalMs: 5000' },
      entityExtractorCallable: async () => ({ entities: [], relations: [] }),
      embeddingCallable: async (texts) => texts.map(() => [0]),
      storeOverride: makeStore(),
    });
    expect(sub.config.tickIntervalMs).toBe(5000);
    sub.handle?.stop();
  });
});

describe('stopPatcherSubstrate', () => {
  test('null handle is idempotent', () => {
    expect(() => stopPatcherSubstrate(undefined)).not.toThrow();
    expect(() => stopPatcherSubstrate({ handle: null, config: { enabled: false, tickIntervalMs: 0, perTickLimit: 0, embeddingsEnabled: false } })).not.toThrow();
  });

  test('live handle stops + diagnostics reflect running=false', () => {
    _resetUserIntentLogger();
    const sub = buildPatcherSubstrate({
      configSource: { read: () => 'enabled: true' },
      entityExtractorCallable: async () => ({ entities: [], relations: [] }),
      embeddingCallable: async (texts) => texts.map(() => [0]),
      storeOverride: makeStore(),
    });
    expect(sub.handle?.diagnostics().running).toBe(true);
    stopPatcherSubstrate(sub);
    expect(sub.handle?.diagnostics().running).toBe(false);
    // Idempotent on already-stopped handle
    expect(() => stopPatcherSubstrate(sub)).not.toThrow();
  });
});
