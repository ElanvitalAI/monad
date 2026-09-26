import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readAuditTail,
  isInputAuditEntry,
  formatAuditEntry,
  parseDuration,
  type AuditEntry,
} from '../src/input-core/audit-tail.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `elanous-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
});
afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

function writeDay(dayKey: string, entries: AuditEntry[]): void {
  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(tmpRoot, `control-${dayKey}.ndjson`), lines);
}

// A fixed "now" makes yesterday/today keys deterministic.
const FIXED_NOW = Date.parse('2026-04-18T12:00:00Z');
const now = () => FIXED_NOW;
const TODAY_KEY = '2026-04-18';
const YESTERDAY_KEY = '2026-04-17';

describe('audit-tail — read + filter', () => {
  test('no audit file → empty result, filesScanned empty', () => {
    const r = readAuditTail({ root: tmpRoot, now });
    expect(r.entries).toHaveLength(0);
    expect(r.filesScanned).toHaveLength(0);
    expect(r.truncated).toBe(false);
  });

  test('today only — entries returned oldest → newest', () => {
    writeDay(TODAY_KEY, [
      { ts: '2026-04-18T08:00:00Z', action: 'input_set_mode', subject: 'sync', ok: true },
      { ts: '2026-04-18T09:30:00Z', action: 'input_set_binding', subject: 'mode.enter.sync', ok: true,
        detail: { keys: ['alt+s'] } },
      { ts: '2026-04-18T10:00:00Z', action: 'input_set_binding', subject: 'app.interrupt', ok: false,
        detail: { violation: { kind: 'reserved-action', value: 'app.interrupt' } } },
    ]);
    const r = readAuditTail({ root: tmpRoot, now });
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]!.action).toBe('input_set_mode');
    expect(r.entries[2]!.ok).toBe(false);
  });

  test('yesterday + today merged by ts', () => {
    writeDay(YESTERDAY_KEY, [
      { ts: '2026-04-17T23:00:00Z', action: 'input_set_mode', subject: 'control', ok: true },
    ]);
    writeDay(TODAY_KEY, [
      { ts: '2026-04-18T00:30:00Z', action: 'input_set_mode', subject: 'general', ok: true },
    ]);
    const r = readAuditTail({ root: tmpRoot, now });
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]!.ts).toBe('2026-04-17T23:00:00Z');
  });

  test('tail clamps to N', () => {
    const many: AuditEntry[] = [];
    for (let i = 0; i < 30; i++) {
      many.push({ ts: `2026-04-18T${String(i).padStart(2, '0')}:00:00Z`,
                  action: 'input_set_mode', subject: String(i), ok: true });
    }
    writeDay(TODAY_KEY, many);
    const r = readAuditTail({ root: tmpRoot, now, tail: 5 });
    expect(r.entries).toHaveLength(5);
    expect(r.truncated).toBe(true);
    // Tail is newest 5 — hours 25..29 not present because only 00..29 are 30 entries
    expect(r.entries[0]!.subject).toBe('25');
    expect(r.entries[4]!.subject).toBe('29');
  });

  test('match predicate filters', () => {
    writeDay(TODAY_KEY, [
      { ts: '2026-04-18T08:00:00Z', action: 'input_set_mode', subject: 'sync', ok: true },
      { ts: '2026-04-18T09:00:00Z', action: 'window_resize', subject: 'win:3', ok: true },
      { ts: '2026-04-18T10:00:00Z', action: 'input_clear_binding', subject: 'x', ok: true },
    ]);
    const r = readAuditTail({ root: tmpRoot, now, match: isInputAuditEntry });
    expect(r.entries).toHaveLength(2);
    expect(r.entries.every(e => e.action.startsWith('input_'))).toBe(true);
  });

  test('sinceMs filters out old entries', () => {
    writeDay(TODAY_KEY, [
      { ts: '2026-04-18T06:00:00Z', action: 'input_set_mode', subject: 'sync', ok: true },    // 6h ago
      { ts: '2026-04-18T11:30:00Z', action: 'input_set_mode', subject: 'general', ok: true }, // 30m ago
    ]);
    // sinceMs = 1h → only the 30m-ago entry survives.
    const r = readAuditTail({ root: tmpRoot, now, sinceMs: 60 * 60 * 1000 });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.subject).toBe('general');
  });

  test('malformed lines skipped silently', () => {
    const lines = [
      JSON.stringify({ ts: '2026-04-18T08:00:00Z', action: 'input_set_mode', ok: true }),
      '{ this is broken',
      JSON.stringify({ ts: '2026-04-18T09:00:00Z', action: 'input_set_mode', ok: true }),
      '',
    ].join('\n');
    writeFileSync(join(tmpRoot, `control-${TODAY_KEY}.ndjson`), lines);
    const r = readAuditTail({ root: tmpRoot, now });
    expect(r.entries).toHaveLength(2);
  });
});

describe('formatAuditEntry', () => {
  test('OK entry renders HH:MM:SS + action + subject + detail', () => {
    const s = formatAuditEntry({
      ts: '2026-04-18T12:34:56Z',
      action: 'input_set_mode',
      subject: 'sync',
      ok: true,
      detail: { previousMode: 'general' },
    });
    expect(s).toContain('12:34:56');
    expect(s).toContain('[ok ]');
    expect(s).toContain('input_set_mode');
    expect(s).toContain('sync');
    expect(s).toContain('previousMode');
  });

  test('FAIL entry labelled FAIL', () => {
    const s = formatAuditEntry({
      ts: '2026-04-18T12:34:56Z',
      action: 'input_set_binding',
      subject: 'app.interrupt',
      ok: false,
      detail: { violation: { kind: 'reserved-action' } },
    });
    expect(s).toContain('[FAIL]');
  });
});

describe('parseDuration', () => {
  test.each([
    ['30s', 30_000],
    ['30', 30_000],        // default unit = seconds
    ['2m', 120_000],
    ['1h', 3_600_000],
    ['1d', 86_400_000],
    ['500ms', 500],
  ])('%s → %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  test.each(['abc', '10x', '-5s', ''])('invalid %p → null', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});
