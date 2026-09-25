// Unit tests for the stale-session pruning logic. Pure function
// over an array of records — no I/O for the default rules. The
// `missing-cwd` rule does touch the filesystem (existsSync), so we
// drive it via tmp dirs that do/don't exist.

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pruneStaleRecords,
  classifyRecord,
  defaultKnownBackends,
} from '../src/acp/session-store-prune';
import type { AcpSessionRecord } from '../src/acp/session-store.js';

function rec(over: Partial<AcpSessionRecord>): AcpSessionRecord {
  return {
    chatId: 'chat-1',
    backendId: 'claude',
    sessionId: 'sess-x',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...over,
  };
}

describe('classifyRecord · default rules', () => {
  test('keeps records for backends in the live registry', () => {
    expect(classifyRecord(rec({ backendId: 'claude' })).drop).toBe(false);
    expect(classifyRecord(rec({ backendId: 'codex-app-server' })).drop).toBe(false);
  });

  test('drops records for backends not in the registry', () => {
    // codex-native was removed sprint 5B (2026-04-28).
    const d = classifyRecord(rec({ backendId: 'codex-native' }));
    expect(d.drop).toBe(true);
    expect(d.reason).toBe('unknown-backend');
  });

  test('drops bare `codex` (legacy alias, replaced by codex-app-server)', () => {
    const d = classifyRecord(rec({ backendId: 'codex' }));
    expect(d.drop).toBe(true);
    expect(d.reason).toBe('unknown-backend');
  });

  test('drops ephemeral backends (gemini · loadSession=false at runtime)', () => {
    const d = classifyRecord(rec({ backendId: 'gemini' }));
    expect(d.drop).toBe(true);
    expect(d.reason).toBe('ephemeral-backend');
  });
});

describe('classifyRecord · optional rules', () => {
  test('missingCwd: dropped when dashboard:<path> doesn\'t exist', () => {
    const d = classifyRecord(
      rec({ chatId: 'dashboard:/no/such/path/abc-xyz', backendId: 'claude' }),
      { missingCwd: true },
    );
    expect(d.drop).toBe(true);
    expect(d.reason).toBe('missing-cwd');
  });

  test('missingCwd: kept when dashboard:<path> exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-test-'));
    try {
      const d = classifyRecord(
        rec({ chatId: `dashboard:${dir}`, backendId: 'claude' }),
        { missingCwd: true },
      );
      expect(d.drop).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missingCwd: messenger ids (non-dashboard) are unaffected', () => {
    // Telegram numeric ids and Discord snowflakes don't encode paths.
    const d = classifyRecord(
      rec({ chatId: '1301607555', backendId: 'claude' }),
      { missingCwd: true },
    );
    expect(d.drop).toBe(false);
  });

  test('olderThanDays: dropped when updatedAt is past threshold', () => {
    const now = new Date('2026-05-02T00:00:00.000Z');
    const d = classifyRecord(
      rec({ updatedAt: '2026-04-01T00:00:00.000Z', backendId: 'claude' }),
      { olderThanDays: 14, now },
    );
    expect(d.drop).toBe(true);
    expect(d.reason).toBe('older-than-threshold');
  });

  test('olderThanDays: kept when within threshold', () => {
    const now = new Date('2026-05-02T00:00:00.000Z');
    const d = classifyRecord(
      rec({ updatedAt: '2026-04-25T00:00:00.000Z', backendId: 'claude' }),
      { olderThanDays: 14, now },
    );
    expect(d.drop).toBe(false);
  });

  test('olderThanDays: malformed timestamp is preserved (no false drop)', () => {
    const d = classifyRecord(
      rec({ updatedAt: 'not-a-date', backendId: 'claude' }),
      { olderThanDays: 14 },
    );
    expect(d.drop).toBe(false);
  });
});

describe('pruneStaleRecords · aggregation', () => {
  test('separates kept vs dropped + counts by reason', () => {
    const result = pruneStaleRecords([
      rec({ backendId: 'claude', sessionId: 's1' }),                 // kept
      rec({ backendId: 'codex-native', sessionId: 's2' }),           // unknown
      rec({ backendId: 'gemini', sessionId: 's3' }),                 // ephemeral
      rec({ backendId: 'codex-app-server', sessionId: 's4' }),       // kept
      rec({ backendId: 'codex', sessionId: 's5' }),                  // unknown
    ]);
    expect(result.kept.map(r => r.sessionId)).toEqual(['s1', 's4']);
    expect(result.dropped.length).toBe(3);
    expect(result.countsByReason['unknown-backend']).toBe(2);
    expect(result.countsByReason['ephemeral-backend']).toBe(1);
    expect(result.countsByReason['missing-cwd']).toBe(0);
    expect(result.countsByReason['older-than-threshold']).toBe(0);
  });

  test('priority: unknown-backend wins over ephemeral when both apply', () => {
    // A backend that's both unknown AND would be in the ephemeral
    // set surfaces as unknown. The ephemeral check is irrelevant if
    // we don't even know what backend it is.
    const result = pruneStaleRecords(
      [rec({ backendId: 'phantom', sessionId: 's1' })],
      {
        knownBackends: new Set(['claude']),
        ephemeralBackends: new Set(['phantom']),
      },
    );
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0]!.reason).toBe('unknown-backend');
  });

  test('empty input → empty output', () => {
    const result = pruneStaleRecords([]);
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});

describe('defaultKnownBackends', () => {
  test('contains the current registry ids', () => {
    const known = defaultKnownBackends();
    expect(known.has('claude')).toBe(true);
    expect(known.has('codex-app-server')).toBe(true);
    expect(known.has('gemini')).toBe(true);
    // Removed legacy ids must not be present.
    expect(known.has('codex-native')).toBe(false);
    expect(known.has('codex')).toBe(false);
  });
});
