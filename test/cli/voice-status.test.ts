// M1-4 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// `monad voice status` report builder + formatter. Both are pure
// functions so the test injects a UserConfig and a temp eventPath.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildVoiceStatusReport, formatVoiceStatusReport } from '../../src/cli/voice-status.js';
import { buildUserConfig } from '../../src/user-config.js';

const MS_PER_DAY = 86_400_000;
const REF_NOW = Date.parse('2026-05-12T12:00:00Z');

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'voice-status-'));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

function writeUserConfig(dir: string, body: unknown): string {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

function writeEvents(dir: string, lines: Array<Record<string, unknown>>): string {
  const path = join(dir, 'voice-cost-events.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'));
  return path;
}

describe('M1-4 · buildVoiceStatusReport', () => {
  test('default user-config → Balanced · source=default', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, {});
      const cfg = buildUserConfig(cfgPath);
      const report = buildVoiceStatusReport({ cfg, eventPath: join(dir, 'no-events.jsonl'), now: REF_NOW });
      expect(report.tier).toBe('balanced');
      expect(report.source).toBe('default');
      expect(report.model).toBe('gpt-4o-mini-transcribe');
      expect(report.ratePerMin).toBeCloseTo(0.003, 6);
      expect(report.audioMinPerDay).toBe(0);
      expect(report.sttSampleCount).toBe(0);
      expect(report.projectedMonthlyUsd).toBe(0);
      expect(report.monthlyCapUsd).toBeNull();
    });
  });

  test('user-config voice.stt override → tier reflects + source=user-config-surface', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, { modelTier: { voice: { stt: 'best' } } });
      const cfg = buildUserConfig(cfgPath);
      const report = buildVoiceStatusReport({ cfg, eventPath: join(dir, 'no-events.jsonl'), now: REF_NOW });
      expect(report.tier).toBe('best');
      expect(report.source).toBe('user-config-surface');
      expect(report.model).toBe('gpt-realtime-whisper');
      expect(report.ratePerMin).toBeCloseTo(0.017, 6);
    });
  });

  test('budget.monthlyUsdCap surfaces as monthlyCapUsd', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, { budget: { monthlyUsdCap: 50 } });
      const cfg = buildUserConfig(cfgPath);
      const report = buildVoiceStatusReport({ cfg, eventPath: join(dir, 'no-events.jsonl'), now: REF_NOW });
      expect(report.monthlyCapUsd).toBe(50);
    });
  });

  test('recent STT events drive audioMinPerDay + projection', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, {});
      const cfg = buildUserConfig(cfgPath);
      // 10 events × 600_000 ms (10 min) = 100 audio min in 14-day window
      const eventPath = writeEvents(dir, Array.from({ length: 10 }, (_, i) => ({
        kind: 'stt',
        ts: REF_NOW - (i + 1) * MS_PER_DAY,
        providerId: 'gpt-4o-mini-transcribe',
        durationMs: 10 * 60_000,
        usd: 0.03,
      })));
      const report = buildVoiceStatusReport({ cfg, eventPath, now: REF_NOW });
      expect(report.sttSampleCount).toBe(10);
      expect(report.audioMinPerDay).toBeCloseTo(100 / 14, 6);
      // balanced × 100/14 min/day × 30 days × $0.003/min
      expect(report.projectedMonthlyUsd).toBeCloseTo((100 / 14) * 30 * 0.003, 6);
    });
  });

  test('events older than 14 days excluded from rolling average', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, {});
      const cfg = buildUserConfig(cfgPath);
      const eventPath = writeEvents(dir, [
        { kind: 'stt', ts: REF_NOW - 2 * MS_PER_DAY, providerId: 'gpt-4o-mini-transcribe', durationMs: 60_000, usd: 0.003 },
        { kind: 'stt', ts: REF_NOW - 25 * MS_PER_DAY, providerId: 'gpt-4o-mini-transcribe', durationMs: 60_000, usd: 0.003 },
      ]);
      const report = buildVoiceStatusReport({ cfg, eventPath, now: REF_NOW });
      expect(report.sttSampleCount).toBe(1);
      expect(report.audioMinPerDay).toBeCloseTo(1 / 14, 6);
    });
  });

  test('monthSoFarUsd sums STT+TTS within current month', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, {});
      const cfg = buildUserConfig(cfgPath);
      // 3 events this month, 1 last month
      const eventPath = writeEvents(dir, [
        { kind: 'stt', ts: Date.parse('2026-05-01T10:00:00Z'), durationMs: 60_000, usd: 0.10 },
        { kind: 'stt', ts: Date.parse('2026-05-05T10:00:00Z'), durationMs: 60_000, usd: 0.20 },
        { kind: 'tts', ts: Date.parse('2026-05-07T10:00:00Z'), charCount: 100, usd: 0.30 },
        { kind: 'stt', ts: Date.parse('2026-04-30T10:00:00Z'), durationMs: 60_000, usd: 9.99 },
      ]);
      const report = buildVoiceStatusReport({ cfg, eventPath, now: REF_NOW });
      expect(report.monthSoFarUsd).toBeCloseTo(0.60, 6);
    });
  });

  test('all five tier projections returned', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, {});
      const cfg = buildUserConfig(cfgPath);
      const eventPath = writeEvents(dir, [
        { kind: 'stt', ts: REF_NOW - MS_PER_DAY, providerId: 'gpt-4o-mini-transcribe', durationMs: 60 * 60_000, usd: 0.18 },
      ]);
      const report = buildVoiceStatusReport({ cfg, eventPath, now: REF_NOW });
      expect(Object.keys(report.allTierProjections).sort()).toEqual(
        ['balanced', 'best', 'better', 'budget', 'loaded'].sort(),
      );
      expect(report.allTierProjections.budget).toBe(0);
      expect(report.allTierProjections.best).toBeGreaterThan(report.allTierProjections.balanced);
    });
  });
});

describe('M1-4 · formatVoiceStatusReport', () => {
  test('default · no usage data · prints zero-config baseline', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, {});
      const cfg = buildUserConfig(cfgPath);
      const report = buildVoiceStatusReport({ cfg, eventPath: join(dir, 'no.jsonl'), now: REF_NOW });
      const text = formatVoiceStatusReport(report);
      expect(text).toContain('✓ Smart defaults active');
      expect(text).toContain('STT: Balanced');
      expect(text).toContain('gpt-4o-mini-transcribe');
      expect(text).toContain('source = default');
      expect(text).toContain('no usage data yet');
      expect(text).toContain('no cap');
    });
  });

  test('custom tier · prints ⚙ header + user-config-surface source', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, { modelTier: { voice: { stt: 'best' } } });
      const cfg = buildUserConfig(cfgPath);
      const report = buildVoiceStatusReport({ cfg, eventPath: join(dir, 'no.jsonl'), now: REF_NOW });
      const text = formatVoiceStatusReport(report);
      expect(text).toContain('⚙ Custom voice tier');
      expect(text).toContain('STT: Best');
      expect(text).toContain('source = user-config-surface');
    });
  });

  test('with usage · shows monthly projection + alternative tier hint', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, {});
      const cfg = buildUserConfig(cfgPath);
      const eventPath = writeEvents(dir, Array.from({ length: 14 }, (_, i) => ({
        kind: 'stt',
        ts: REF_NOW - (i + 1) * MS_PER_DAY,
        durationMs: 10 * 60_000,
        usd: 0.03,
      })));
      const report = buildVoiceStatusReport({ cfg, eventPath, now: REF_NOW });
      const text = formatVoiceStatusReport(report);
      expect(text).toContain('Usage:');
      expect(text).toContain('14-day rolling');
      // default-source casual user gets a "Best tier would cost..." hint
      expect(text).toContain('Best tier would cost');
    });
  });

  test('budget cap rendered when set', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, { budget: { monthlyUsdCap: 50 } });
      const cfg = buildUserConfig(cfgPath);
      const report = buildVoiceStatusReport({ cfg, eventPath: join(dir, 'no.jsonl'), now: REF_NOW });
      const text = formatVoiceStatusReport(report);
      // formatter uses one-decimal precision in the $10-$100 band
      expect(text).toMatch(/\$50(\.0+)? cap/);
    });
  });

  test('budget tier WIP status surfaces install hint', () => {
    withTmp((dir) => {
      const cfgPath = writeUserConfig(dir, { modelTier: { voice: { stt: 'budget' } } });
      const cfg = buildUserConfig(cfgPath);
      const report = buildVoiceStatusReport({ cfg, eventPath: join(dir, 'no.jsonl'), now: REF_NOW });
      const text = formatVoiceStatusReport(report);
      expect(text).toContain('WIP');
      expect(text).toContain('install local binary');
    });
  });
});
