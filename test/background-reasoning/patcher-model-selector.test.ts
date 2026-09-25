// W5 Y3 · model selector — task kind → spec.

import { describe, expect, test } from 'bun:test';
import { PatcherModelSelector } from '../../src/background-reasoning/patcher-model-selector';

describe('PatcherModelSelector', () => {
  test('log_normalize + embedding → local light', () => {
    const s = new PatcherModelSelector({ localAvailable: () => true });
    expect(s.select('log_normalize').provider).toBe('local');
    expect(s.select('log_normalize').model).toContain('7b');
    expect(s.select('embedding').provider).toBe('local');
  });

  test('entity_extract + local available → local mid', () => {
    const s = new PatcherModelSelector({ localAvailable: () => true });
    const spec = s.select('entity_extract');
    expect(spec.provider).toBe('local');
    expect(spec.model).toContain('14b');
  });

  test('entity_extract + local saturated → cloud cheap', () => {
    const s = new PatcherModelSelector({ localAvailable: () => false });
    const spec = s.select('pattern_detect');
    expect(spec.provider).toBe('cloud');
    expect(spec.model).toBe('gemini-flash');
  });

  test('retrospective_synth → delegate to thinker', () => {
    const s = new PatcherModelSelector({ localAvailable: () => true });
    const spec = s.select('retrospective_synth');
    expect(spec.provider).toBe('delegate');
    expect(spec.delegate).toBe('thinker');
  });

  test('unknown falls back to local light', () => {
    const s = new PatcherModelSelector({ localAvailable: () => true });
    expect(s.select('unknown').provider).toBe('local');
  });

  test('pins override defaults', () => {
    const s = new PatcherModelSelector({
      localAvailable: () => true,
      pins: { localLight: 'custom-light', cloudCheap: 'custom-cloud' },
    });
    expect(s.select('log_normalize').model).toBe('custom-light');
    const sat = new PatcherModelSelector({
      localAvailable: () => false,
      pins: { cloudCheap: 'custom-cloud' },
    });
    expect(sat.select('entity_extract').model).toBe('custom-cloud');
  });
});
