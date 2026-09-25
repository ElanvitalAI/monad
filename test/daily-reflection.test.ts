// R6.1 — buildDailyReflection contract.
// + dayBounds + dateKey unit tests.

import { describe, expect, test } from 'bun:test';

import {
  buildDailyReflection,
  dateKey,
  dayBounds,
} from '../src/notes/daily-reflection.js';
import { createNotesMetricsCollector } from '../src/notes/metrics.js';
import type { DaemonSessionSummary } from '../src/boot/daemon-runtime.js';

const NOW = Date.UTC(2026, 4, 9, 14, 0, 0);  // 2026-05-09 14:00 UTC

const stubHistory = (sessions: DaemonSessionSummary[]) => ({
  summary: () => sessions,
});

describe('dayBounds', () => {
  test('valid YYYY-MM-DD → start + end UTC ms', () => {
    const b = dayBounds('2026-05-09');
    expect(b).not.toBeNull();
    expect(b!.startMs).toBe(Date.UTC(2026, 4, 9));
    expect(b!.endMs).toBe(Date.UTC(2026, 4, 10));
  });

  test('invalid shape → null', () => {
    expect(dayBounds('2026/05/09')).toBeNull();
    expect(dayBounds('not-a-date')).toBeNull();
    expect(dayBounds('')).toBeNull();
  });
});

describe('dateKey', () => {
  test('formats UTC YYYY-MM-DD', () => {
    expect(dateKey(Date.UTC(2026, 4, 9, 23, 59))).toBe('2026-05-09');
    expect(dateKey(Date.UTC(2026, 4, 10, 0, 1))).toBe('2026-05-10');
  });
});

describe('buildDailyReflection · empty inputs', () => {
  test('all-zero snapshot when nothing wired', () => {
    const r = buildDailyReflection({ date: '2026-05-09', now: () => NOW });
    expect(r.notesSaved).toBe(0);
    expect(r.ocrRuns).toBe(0);
    expect(r.sessionsToday).toBe(0);
    expect(r.topSessions).toEqual([]);
    expect(r.date).toBe('2026-05-09');
    expect(r.generatedAt).toBe(new Date(NOW).toISOString());
  });
});

describe('buildDailyReflection · notes counters', () => {
  test('lifetime totals reported when date is today', () => {
    const m = createNotesMetricsCollector();
    m.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    m.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    m.recordSave({ polishMode: 'minimal', ok: true });
    m.recordSave({ polishMode: 'minimal', ok: true });
    m.recordSave({ polishMode: 'enrich', ok: false });
    const r = buildDailyReflection({ date: '2026-05-09', metrics: m, now: () => NOW });
    expect(r.ocrRuns).toBe(2);
    expect(r.notesSaved).toBe(2);  // failures excluded
  });

  test('past date → counters zero (no historical buckets in v1)', () => {
    const m = createNotesMetricsCollector();
    m.recordSave({ polishMode: 'minimal', ok: true });
    const r = buildDailyReflection({ date: '2026-05-08', metrics: m, now: () => NOW });
    expect(r.notesSaved).toBe(0);
    expect(r.ocrRuns).toBe(0);
  });
});

describe('buildDailyReflection · sessions', () => {
  const today = '2026-05-09';
  const inDay1 = new Date(Date.UTC(2026, 4, 9, 9, 30)).toISOString();
  const inDay2 = new Date(Date.UTC(2026, 4, 9, 13, 0)).toISOString();
  const inDay3 = new Date(Date.UTC(2026, 4, 9, 11, 0)).toISOString();
  const yesterday = new Date(Date.UTC(2026, 4, 8, 22, 0)).toISOString();

  test('filters sessions by date window', () => {
    const r = buildDailyReflection({
      date: today,
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 3, lastTurnAt: inDay1 },
        { id: 's2', msgCount: 5, lastTurnAt: inDay2 },
        { id: 's3', msgCount: 1, lastTurnAt: yesterday },
      ]),
    });
    expect(r.sessionsToday).toBe(2);
    expect(r.topSessions).toHaveLength(2);
    expect(r.topSessions.map((t) => t.id)).toEqual(['s2', 's1']); // by msgCount desc
  });

  test('top sessions cap at 3', () => {
    const r = buildDailyReflection({
      date: today,
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 1, lastTurnAt: inDay1 },
        { id: 's2', msgCount: 2, lastTurnAt: inDay2 },
        { id: 's3', msgCount: 3, lastTurnAt: inDay3 },
        { id: 's4', msgCount: 4, lastTurnAt: inDay1 },
        { id: 's5', msgCount: 5, lastTurnAt: inDay2 },
      ]),
    });
    expect(r.sessionsToday).toBe(5);
    expect(r.topSessions).toHaveLength(3);
    expect(r.topSessions.map((t) => t.id)).toEqual(['s5', 's4', 's3']);
  });

  test('tie-break by lastTurnAt (most recent first)', () => {
    const r = buildDailyReflection({
      date: today,
      now: () => NOW,
      history: stubHistory([
        { id: 's-old', msgCount: 5, lastTurnAt: inDay1 },
        { id: 's-new', msgCount: 5, lastTurnAt: inDay2 },
      ]),
    });
    expect(r.topSessions[0]!.id).toBe('s-new');
  });

  test('preview passed through when present', () => {
    const r = buildDailyReflection({
      date: today,
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 1, lastTurnAt: inDay1, lastMsgPreview: 'hello' },
      ]),
    });
    expect(r.topSessions[0]!.lastMsgPreview).toBe('hello');
  });

  test('invalid lastTurnAt → filtered out', () => {
    const r = buildDailyReflection({
      date: today,
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 1, lastTurnAt: 'bad-date' },
      ]),
    });
    expect(r.sessionsToday).toBe(0);
  });
});

describe('buildDailyReflection · invalid date', () => {
  test('bad date string → bounds null → 0 sessions', () => {
    const r = buildDailyReflection({
      date: 'not-a-date',
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 1, lastTurnAt: new Date(NOW).toISOString() },
      ]),
    });
    expect(r.sessionsToday).toBe(0);
    expect(r.date).toBe('not-a-date');
  });
});
