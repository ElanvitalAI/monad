// Service Worker Phase 3 — push subscription store tests.
//
// File-backed registry — tests use a tmp dir so production
// `~/.elanous/push-subs.json` is never touched.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addSubscription,
  removeSubscription,
  listSubscriptions,
  _setPushSubsPathForTest,
} from '../src/web-push/subscriptions';

let tmpDir: string;
let tmpPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'web-push-subs-'));
  tmpPath = join(tmpDir, 'push-subs.json');
  _setPushSubsPathForTest(tmpPath);
});

afterEach(() => {
  _setPushSubsPathForTest(null);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const SAMPLE_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/AAAA',
  keys: { p256dh: 'pub-key', auth: 'auth-secret' },
};

describe('subscriptions store', () => {
  test('add → list returns the record', () => {
    const r = addSubscription({ subscription: SAMPLE_SUB, label: 'iPhone' });
    expect(r.id).toMatch(/^push-/);
    expect(r.subscription.endpoint).toBe(SAMPLE_SUB.endpoint);
    const all = listSubscriptions();
    expect(all).toHaveLength(1);
    expect(all[0]!.label).toBe('iPhone');
  });

  test('add with same endpoint replaces in place + preserves id', () => {
    const first = addSubscription({ subscription: SAMPLE_SUB, label: 'old' });
    const second = addSubscription({
      subscription: SAMPLE_SUB,
      label: 'new label',
    });
    expect(second.id).toBe(first.id);
    expect(second.label).toBe('new label');
    expect(listSubscriptions()).toHaveLength(1);
  });

  test('add with different endpoint produces a new entry', () => {
    addSubscription({ subscription: SAMPLE_SUB });
    addSubscription({
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/BBBB',
        keys: { p256dh: 'p2', auth: 'a2' },
      },
    });
    expect(listSubscriptions()).toHaveLength(2);
  });

  test('remove returns true on hit, false on miss', () => {
    const r = addSubscription({ subscription: SAMPLE_SUB });
    expect(removeSubscription(r.id)).toBe(true);
    expect(removeSubscription(r.id)).toBe(false);
    expect(listSubscriptions()).toHaveLength(0);
  });

  test('list returns empty array when file does not exist yet', () => {
    expect(listSubscriptions()).toEqual([]);
  });

  test('file mode is 0o600 on first write', () => {
    addSubscription({ subscription: SAMPLE_SUB });
    const s = statSync(tmpPath);
    // POSIX permission bits — 0o600 = -rw-------
    // (s.mode & 0o777) gives the permission portion only.
    expect(s.mode & 0o777).toBe(0o600);
  });

  test('label is omitted from record when not provided', () => {
    const r = addSubscription({ subscription: SAMPLE_SUB });
    expect(r.label).toBeUndefined();
  });

  test('createdAt + id stable across replace-in-place', () => {
    const first = addSubscription({
      subscription: SAMPLE_SUB,
      now: () => 1000,
    });
    const second = addSubscription({
      subscription: SAMPLE_SUB,
      label: 'updated',
      now: () => 9999,
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.id).toBe(first.id);
  });
});
