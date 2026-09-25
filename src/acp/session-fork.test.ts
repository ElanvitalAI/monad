// Session fork(codex ForkSnapshot 이식) 단위테스트 — 순수 + tmp fs.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  userMessagePositions, truncateBeforeNthUser, forkInterrupted, forkSession,
  persistFork, loadFork, type SessionMessage,
} from './session-fork.js';

const convo: SessionMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'u1' },
  { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'u2' },
  { role: 'assistant', content: 'a2' },
  { role: 'user', content: 'u3' },
];

describe('userMessagePositions', () => {
  test('사용자 메시지 index', () => {
    expect(userMessagePositions(convo)).toEqual([1, 3, 5]);
  });
});

describe('truncateBeforeNthUser (codex 동형)', () => {
  test('n=1 → 첫 사용자 이전(빈·fresh)', () => {
    const r = truncateBeforeNthUser(convo, 1);
    expect(r.boundary).toBe(1);
    expect(r.items).toEqual([{ role: 'system', content: 'sys' }]); // system 만(user 이전)
  });
  test('n=2 → 첫 사용자 턴까지', () => {
    const r = truncateBeforeNthUser(convo, 2);
    expect(r.items.map(m => m.content)).toEqual(['sys', 'u1', 'a1']);
  });
  test('n 초과 → 전체 유지', () => {
    expect(truncateBeforeNthUser(convo, 99).items.length).toBe(convo.length);
  });
  test('n<=0 → 완전 비움', () => {
    expect(truncateBeforeNthUser(convo, 0).items.length).toBe(0);
  });
});

describe('forkInterrupted', () => {
  test('mid-turn(assistant 끝) → aborted 마커', () => {
    const items: SessionMessage[] = [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'partial' }];
    const r = forkInterrupted(items);
    expect(r.items.length).toBe(3);
    expect(r.items[2]!.content).toContain('aborted');
  });
  test('user 끝 → 마커 없음', () => {
    const items: SessionMessage[] = [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'u' }];
    expect(forkInterrupted(items).items.length).toBe(2);
  });
});

describe('forkSession + lineage', () => {
  test('truncate 모드 fork', () => {
    const f = forkSession('parent-1', convo, { kind: 'truncate-before-nth-user', n: 2 });
    expect(f.parentId).toBe('parent-1');
    expect(f.forkedFromIndex).toBe(3);
    expect(f.items.map(m => m.content)).toEqual(['sys', 'u1', 'a1']);
    expect(f.id).toBeTruthy();
  });

  test('nested fork drops to first message (codex 테스트 동형)', () => {
    const f1 = forkSession('p', convo, { kind: 'truncate-before-nth-user', n: 2 });
    const f2 = forkSession(f1.id, f1.items, { kind: 'truncate-before-nth-user', n: 1 });
    expect(f2.items.map(m => m.content)).toEqual(['sys']); // 첫 user 이전만
    expect(f2.parentId).toBe(f1.id);
  });
});

describe('persist/load JSONL', () => {
  test('왕복', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fork-'));
    const path = join(dir, 'fork.jsonl');
    const f = forkSession('p', convo, { kind: 'interrupted' });
    persistFork(path, f);
    const loaded = loadFork(path);
    expect(loaded.id).toBe(f.id);
    expect(loaded.parentId).toBe('p');
    expect(loaded.items.length).toBe(f.items.length);
    expect(loaded.items[1]!.content).toBe('u1');
    rmSync(dir, { recursive: true, force: true });
  });
});
