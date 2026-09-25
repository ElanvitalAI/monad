import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { NotificationStore } from '../src/notifications/store.js';
import { createPersistence } from '../src/notifications/persistence.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'monad-notif-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* swallow */ }
}

describe('NotificationPersistence (NT-E2)', () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { rmDir(dir); });

  test('append writes one jsonl line per event under dir/<sid>.jsonl', () => {
    const p = createPersistence({ dir });
    const store = new NotificationStore({ persistence: p, now: () => 1_000 });
    store.push({ sessionId: 'term:1', kind: 'status', title: 'working' });
    store.push({ sessionId: 'term:1', kind: 'error',  title: 'parse-error' });
    store.push({ sessionId: 'term:2', kind: 'block',  title: 'block blk:1' });
    const file1 = path.join(dir, 'term_1.jsonl');
    const file2 = path.join(dir, 'term_2.jsonl');
    const lines1 = fs.readFileSync(file1, 'utf8').split('\n').filter(Boolean);
    const lines2 = fs.readFileSync(file2, 'utf8').split('\n').filter(Boolean);
    expect(lines1.length).toBe(2);
    expect(lines2.length).toBe(1);
    const first = JSON.parse(lines1[0]!) as { title: string; kind: string; read: boolean };
    expect(first.title).toBe('working');
    expect(first.kind).toBe('status');
    // Persisted events are stamped read:true so replay doesn't burst unread badges.
    expect(first.read).toBe(true);
  });

  test('replay seeds a fresh store with previous events marked as read', () => {
    const p1 = createPersistence({ dir });
    const s1 = new NotificationStore({ persistence: p1, now: () => 1 });
    s1.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    s1.push({ sessionId: 'term:1', kind: 'status', title: 'b' });
    s1.push({ sessionId: 'term:2', kind: 'error',  title: 'boom' });

    const p2 = createPersistence({ dir });
    const s2 = new NotificationStore({ persistence: p2 });
    const injected = s2.replay();
    expect(injected).toBe(3);
    expect(s2.list('term:1').map(e => e.title)).toEqual(['a', 'b']);
    expect(s2.unreadCount()).toBe(0);    // read:true on replay
    expect(s2.sessions()).toContain('term:1');
    expect(s2.sessions()).toContain('term:2');
  });

  test('replay preserves ts ordering across sessions', () => {
    const p = createPersistence({ dir });
    const s = new NotificationStore({ persistence: p, now: () => 10 });
    s.push({ sessionId: 'term:2', kind: 'status', title: 'first' });
    const s2 = new NotificationStore({ persistence: p, now: () => 20 });
    s2.push({ sessionId: 'term:1', kind: 'status', title: 'second' });

    const replay = new NotificationStore({ persistence: createPersistence({ dir }) });
    replay.replay();
    const titles = replay.list().map(e => e.title);
    expect(titles).toEqual(['first', 'second']);
  });

  test('cap still applies after replay — oldest dropped', () => {
    const p = createPersistence({ dir });
    const s = new NotificationStore({ persistence: p, capPerSession: 10 });
    for (let i = 0; i < 20; i++) {
      s.push({ sessionId: 'term:1', kind: 'status', title: `n${i}` });
    }
    const s2 = new NotificationStore({ persistence: createPersistence({ dir }), capPerSession: 10 });
    s2.replay();
    const titles = s2.list('term:1').map(e => e.title);
    expect(titles.length).toBe(10);
    // Last 10 events survived.
    expect(titles[titles.length - 1]).toBe('n19');
  });

  test('new sequence ids do not collide with replayed ones', () => {
    const p = createPersistence({ dir });
    const s = new NotificationStore({ persistence: p });
    const first = s.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    // `first.id` should be `evt:1`.
    expect(first.id).toBe('evt:1');
    const s2 = new NotificationStore({ persistence: createPersistence({ dir }) });
    s2.replay();
    const next = s2.push({ sessionId: 'term:1', kind: 'status', title: 'b' });
    expect(next.id).not.toBe(first.id);
  });

  test('clear(sid) drops the on-disk jsonl too', () => {
    const p = createPersistence({ dir });
    const s = new NotificationStore({ persistence: p });
    s.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    const file = path.join(dir, 'term_1.jsonl');
    expect(fs.existsSync(file)).toBe(true);
    s.clear('term:1');
    expect(fs.existsSync(file)).toBe(false);
  });

  test('no-op adapter writes nothing + replay is empty', () => {
    const p = createPersistence({ dir: null });
    expect(p.directory()).toBeNull();
    const s = new NotificationStore({ persistence: p });
    s.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    const s2 = new NotificationStore({ persistence: p });
    expect(s2.replay()).toBe(0);
  });

  test('corrupt lines in the jsonl are skipped during replay', () => {
    const p = createPersistence({ dir });
    const s = new NotificationStore({ persistence: p });
    s.push({ sessionId: 'term:1', kind: 'status', title: 'good' });
    const file = path.join(dir, 'term_1.jsonl');
    fs.appendFileSync(file, '{not-json\nthe quick brown fox\n', 'utf8');
    s.push({ sessionId: 'term:1', kind: 'status', title: 'also good' });

    const replay = new NotificationStore({ persistence: createPersistence({ dir }) });
    replay.replay();
    const titles = replay.list('term:1').map(e => e.title);
    expect(titles).toEqual(['good', 'also good']);
  });
});
