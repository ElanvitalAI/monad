// R-OCR.4.1 — NotesMetricsCollector contract.
//
// Verifies:
//   - empty snapshot shape on a fresh collector
//   - recordOcr: total / byProvider / byPolishMode / failures
//   - recordSave: total / byPolishMode / failures
//   - recordClientEvent: cancel / edit / discard counters
//   - reset() clears all counters
//   - snapshot returns plain objects (Map → Record conversion)
//   - timestamps survive frozen-clock injection
//
// Cross-ref:
//   src/notes/metrics.ts (collector)

import { describe, expect, test } from 'bun:test';

import { createNotesMetricsCollector } from '../src/notes/metrics.js';

describe('createNotesMetricsCollector — empty snapshot', () => {
  test('all counters start at zero', () => {
    const c = createNotesMetricsCollector({ now: () => 0 });
    const s = c.snapshot();
    expect(s.ocr.total).toBe(0);
    expect(s.ocr.failures).toBe(0);
    expect(s.ocr.byProvider).toEqual({});
    expect(s.ocr.byPolishMode).toEqual({});
    expect(s.save.total).toBe(0);
    expect(s.save.failures).toBe(0);
    expect(s.save.byPolishMode).toEqual({});
    expect(s.client).toEqual({ cancel: 0, edit: 0, discard: 0 });
  });

  test('startedAt + ts are ISO strings derived from the now() seam', () => {
    const fixed = Date.UTC(2026, 4, 9, 12, 0, 0);
    const c = createNotesMetricsCollector({ now: () => fixed });
    const s = c.snapshot();
    expect(s.startedAt).toBe(new Date(fixed).toISOString());
    expect(s.ts).toBe(new Date(fixed).toISOString());
  });
});

describe('recordOcr', () => {
  test('total + byProvider + byPolishMode bump on success', () => {
    const c = createNotesMetricsCollector();
    c.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    c.recordOcr({ provider: 'upstage', polishMode: 'enrich', ok: true });
    c.recordOcr({ provider: 'tesseract', polishMode: 'minimal', ok: true });
    const s = c.snapshot();
    expect(s.ocr.total).toBe(3);
    expect(s.ocr.failures).toBe(0);
    expect(s.ocr.byProvider).toEqual({ upstage: 2, tesseract: 1 });
    expect(s.ocr.byPolishMode).toEqual({ minimal: 2, enrich: 1 });
  });

  test('failures bump only the failure counter (not success)', () => {
    const c = createNotesMetricsCollector();
    c.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: false });
    c.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    const s = c.snapshot();
    expect(s.ocr.total).toBe(2);  // both attempts count toward total
    expect(s.ocr.failures).toBe(1);
    expect(s.ocr.byProvider).toEqual({ upstage: 2 });
  });

  test('omitted provider/polishMode does not throw or pollute buckets', () => {
    const c = createNotesMetricsCollector();
    c.recordOcr({ ok: true });
    const s = c.snapshot();
    expect(s.ocr.total).toBe(1);
    expect(s.ocr.byProvider).toEqual({});
    expect(s.ocr.byPolishMode).toEqual({});
  });
});

describe('recordSave', () => {
  test('total + byPolishMode bump on success', () => {
    const c = createNotesMetricsCollector();
    c.recordSave({ polishMode: 'minimal', ok: true });
    c.recordSave({ polishMode: 'enrich', ok: true });
    c.recordSave({ polishMode: 'minimal', ok: true });
    const s = c.snapshot();
    expect(s.save.total).toBe(3);
    expect(s.save.failures).toBe(0);
    expect(s.save.byPolishMode).toEqual({ minimal: 2, enrich: 1 });
  });

  test('failures bump only the failure counter', () => {
    const c = createNotesMetricsCollector();
    c.recordSave({ polishMode: 'minimal', ok: false });
    const s = c.snapshot();
    expect(s.save.total).toBe(1);
    expect(s.save.failures).toBe(1);
  });
});

describe('recordClientEvent', () => {
  test('cancel / edit / discard counters bump independently', () => {
    const c = createNotesMetricsCollector();
    c.recordClientEvent({ type: 'cancel' });
    c.recordClientEvent({ type: 'cancel' });
    c.recordClientEvent({ type: 'edit' });
    c.recordClientEvent({ type: 'discard' });
    const s = c.snapshot();
    expect(s.client).toEqual({ cancel: 2, edit: 1, discard: 1 });
  });
});

describe('reset', () => {
  test('zeroes all counters + restamps startedAt', () => {
    let now = 1_000_000;
    const c = createNotesMetricsCollector({ now: () => now });
    c.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    c.recordSave({ polishMode: 'minimal', ok: true });
    c.recordClientEvent({ type: 'cancel' });
    expect(c.snapshot().ocr.total).toBe(1);

    now = 2_000_000;
    c.reset();
    const s = c.snapshot();
    expect(s.ocr.total).toBe(0);
    expect(s.save.total).toBe(0);
    expect(s.client).toEqual({ cancel: 0, edit: 0, discard: 0 });
    expect(s.startedAt).toBe(new Date(2_000_000).toISOString());
  });
});

describe('snapshot independence', () => {
  test('mutating returned object does not affect later snapshots', () => {
    const c = createNotesMetricsCollector();
    c.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    const s1 = c.snapshot();
    s1.ocr.byProvider.tampered = 999;
    s1.ocr.total = 999;
    s1.client.cancel = 999;
    const s2 = c.snapshot();
    expect(s2.ocr.byProvider).toEqual({ upstage: 1 });
    expect(s2.ocr.total).toBe(1);
    expect(s2.client).toEqual({ cancel: 0, edit: 0, discard: 0 });
  });
});
