// M2-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Preset catalog invariants + lookup.

import { describe, expect, test } from 'bun:test';
import {
  PRESETS,
  PRESET_IDS,
  getPreset,
  isPresetId,
} from '../../src/model-tier/preset-catalog.js';

describe('M2-3 · PRESETS invariants', () => {
  test('5 presets registered in canonical order', () => {
    expect(PRESET_IDS).toHaveLength(5);
    expect(PRESET_IDS).toEqual([
      'casual_chat',
      'meeting',
      'medical_dictation',
      'live_caption',
      'sleep_mode',
    ]);
  });

  test('every preset has id label icon description tiers', () => {
    for (const id of PRESET_IDS) {
      const spec = PRESETS[id];
      expect(spec.id).toBe(id);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.icon.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
      // At least one tier slot set (preset must change *something*).
      const tierKeys = Object.keys(spec.tiers);
      expect(tierKeys.length).toBeGreaterThan(0);
    }
  });

  test('medical_dictation routes to loaded/best across all surfaces', () => {
    const m = PRESETS.medical_dictation;
    expect(m.tiers.stt).toBe('loaded');
    expect(m.tiers.llm).toBe('best');
    expect(m.tiers.tts).toBe('best');
    expect(m.monthlyUsdCap).toBe(20);
  });

  test('sleep_mode caps spending at $0', () => {
    expect(PRESETS.sleep_mode.monthlyUsdCap).toBe(0);
  });

  test('meeting preset has $5/mo cap', () => {
    expect(PRESETS.meeting.monthlyUsdCap).toBe(5);
  });

  test('casual_chat has no budget cap (no notify)', () => {
    expect(PRESETS.casual_chat.monthlyUsdCap).toBeUndefined();
  });
});

describe('M2-3 · isPresetId + getPreset', () => {
  test('isPresetId accepts every id', () => {
    for (const id of PRESET_IDS) expect(isPresetId(id)).toBe(true);
  });

  test('isPresetId rejects strings outside the catalog', () => {
    expect(isPresetId('typing_practice')).toBe(false);
    expect(isPresetId('')).toBe(false);
    expect(isPresetId(42)).toBe(false);
    expect(isPresetId(null)).toBe(false);
  });

  test('getPreset returns the spec', () => {
    expect(getPreset('meeting')).toBe(PRESETS.meeting);
  });
});
