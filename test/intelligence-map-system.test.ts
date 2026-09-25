// ── PFC-S5 P3: system-monitor ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  DEFAULT_TTL_MS,
  getSystemSnapshot,
  formatSystemLine,
  resetSystemMonitorCacheForTest,
} from '../src/intelligence-map/system-monitor';

describe('PFC-S5 P3 — system-monitor', () => {
  beforeEach(() => { resetSystemMonitorCacheForTest(); });

  test('snapshot shape is valid', () => {
    const snap = getSystemSnapshot();
    expect(snap.cpuCount).toBeGreaterThanOrEqual(1);
    expect(snap.loadAvg1).toBeGreaterThanOrEqual(0);
    expect(snap.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snap.cpuPercent).toBeLessThanOrEqual(100);
    expect(snap.totalMemGb).toBeGreaterThan(0);
    expect(snap.freeMemGb).toBeGreaterThan(0);
    expect(snap.freeMemPercent).toBeGreaterThanOrEqual(0);
    expect(snap.freeMemPercent).toBeLessThanOrEqual(100);
    expect(snap.snapshotAt).toBeGreaterThan(0);
    expect(typeof snap.platform).toBe('string');
    expect(typeof snap.arch).toBe('string');
  });

  test('cache reuse within TTL — same snapshotAt', () => {
    const a = getSystemSnapshot();
    const b = getSystemSnapshot();
    expect(b.snapshotAt).toBe(a.snapshotAt);
  });

  test('cache cleared by resetSystemMonitorCacheForTest', () => {
    const a = getSystemSnapshot();
    resetSystemMonitorCacheForTest();
    const b = getSystemSnapshot();
    // After reset, could be same timestamp only if called synchronously in same ms
    // — accept either equal or greater.
    expect(b.snapshotAt).toBeGreaterThanOrEqual(a.snapshotAt);
    // But object identity differs
    expect(a).not.toBe(b);
  });

  test('explicit now opt bypasses cache', () => {
    const a = getSystemSnapshot({ now: 1_000_000 });
    expect(a.snapshotAt).toBe(1_000_000);
    const b = getSystemSnapshot({ now: 2_000_000 });
    expect(b.snapshotAt).toBe(2_000_000);
  });

  test('DEFAULT_TTL_MS is 5 seconds', () => {
    expect(DEFAULT_TTL_MS).toBe(5000);
  });

  test('formatSystemLine produces human-readable line', () => {
    const line = formatSystemLine({
      cpuCount: 8,
      loadAvg1: 2,
      loadAvg5: 1.5,
      loadAvg15: 1,
      cpuPercent: 25,
      freeMemGb: 8.5,
      totalMemGb: 16,
      freeMemPercent: 53,
      platform: 'darwin',
      arch: 'arm64',
      snapshotAt: 1,
    });
    expect(line).toContain('CPU 25%');
    expect(line).toContain('8 cores');
    expect(line).toContain('8.5/16');
    expect(line).toContain('GB free');
  });
});
