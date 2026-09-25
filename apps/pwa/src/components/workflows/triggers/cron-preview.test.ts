// Surface-unification ROADMAP §B1 (2026-05-11) — cron preview tests.

import { describe, expect, it } from 'bun:test';
import { CRON_PRESETS, previewCron } from './cron-preview';

describe('previewCron', () => {
  it('summarizes every-N-minute presets', () => {
    expect(previewCron('*/5 * * * *')).toEqual({ text: 'Every 5 minutes', matched: true });
    expect(previewCron('*/1 * * * *')).toEqual({ text: 'Every 1 minute', matched: true });
  });

  it('summarizes every-N-hour presets', () => {
    expect(previewCron('0 */1 * * *')).toEqual({ text: 'Every 1 hour', matched: true });
    expect(previewCron('0 */6 * * *')).toEqual({ text: 'Every 6 hours', matched: true });
  });

  it('summarizes daily at HH:MM', () => {
    expect(previewCron('0 9 * * *')).toEqual({ text: 'Every day at 09:00', matched: true });
    expect(previewCron('30 14 * * *')).toEqual({ text: 'Every day at 14:30', matched: true });
  });

  it('summarizes weekday-only schedules', () => {
    expect(previewCron('0 9 * * 1-5')).toEqual({
      text: 'Every weekday at 09:00',
      matched: true,
    });
  });

  it('summarizes weekly single-day schedules', () => {
    expect(previewCron('0 9 * * 1')).toEqual({ text: 'Every Monday at 09:00', matched: true });
    expect(previewCron('0 18 * * 5')).toEqual({ text: 'Every Friday at 18:00', matched: true });
  });

  it('summarizes monthly day-of-month schedules', () => {
    expect(previewCron('0 9 1 * *')).toEqual({
      text: 'Day 1 of every month at 09:00',
      matched: true,
    });
    expect(previewCron('0 0 15 * *')).toEqual({
      text: 'Day 15 of every month at 00:00',
      matched: true,
    });
  });

  it('falls back to custom for unknown expressions', () => {
    expect(previewCron('15 3 * * 0,6')).toEqual({
      text: 'Custom: 15 3 * * 0,6',
      matched: false,
    });
  });

  it('reports empty expression', () => {
    expect(previewCron('')).toEqual({ text: '(empty expression)', matched: false });
    expect(previewCron('   ')).toEqual({ text: '(empty expression)', matched: false });
  });

  it('CRON_PRESETS all round-trip to a matched preview', () => {
    for (const preset of CRON_PRESETS) {
      const p = previewCron(preset.expression);
      expect(p.matched).toBe(true);
    }
  });
});
