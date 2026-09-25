// 라이브 세션 cross-process 워처 — 순수 분류 단위테스트(fs.watch 타이밍 무관).
import { describe, test, expect } from 'bun:test';
import { makeSessionWatchState, classifyWatchEvent } from './session-dir-watch.js';

describe('classifyWatchEvent', () => {
  test('.jsonl 아니면 무시', () => {
    const s = makeSessionWatchState();
    expect(classifyWatchEvent(s, 'index.json', 1000)).toBeNull();
    expect(classifyWatchEvent(s, null, 1000)).toBeNull();
    expect(classifyWatchEvent(s, 'foo.txt', 1000)).toBeNull();
  });

  test('미관측 id → session.created(등록·이후 update 억제)', () => {
    const s = makeSessionWatchState();
    const e = classifyWatchEvent(s, 'abc123.jsonl', 1000);
    expect(e).toEqual({ kind: 'session.created', sessionId: 'abc123' });
    expect(s.known.has('abc123')).toBe(true);
    // 생성 직후 즉시 변경은 스로틀로 억제(중복 방지)
    expect(classifyWatchEvent(s, 'abc123.jsonl', 1500)).toBeNull();
  });

  test('관측 id → session.updated(스로틀 경과 후만)', () => {
    const s = makeSessionWatchState(['sess']);
    // 첫 변경(과거 발행 기록 없음) → updated
    expect(classifyWatchEvent(s, 'sess.jsonl', 5000)).toEqual({ kind: 'session.updated', sessionId: 'sess' });
    // 스로틀(2000ms) 내 → 억제
    expect(classifyWatchEvent(s, 'sess.jsonl', 6000)).toBeNull();
    // 스로틀 경과 → 재발행
    expect(classifyWatchEvent(s, 'sess.jsonl', 7001)).toEqual({ kind: 'session.updated', sessionId: 'sess' });
  });

  test('seed 된 id 는 created 안 나옴(부팅 시 기존 세션 재발행 방지)', () => {
    const s = makeSessionWatchState(['old1', 'old2']);
    const e = classifyWatchEvent(s, 'old1.jsonl', 1000);
    expect(e?.kind).toBe('session.updated'); // created 아님
  });

  test('여러 세션 독립 스로틀', () => {
    const s = makeSessionWatchState(['a', 'b']);
    expect(classifyWatchEvent(s, 'a.jsonl', 1000)?.kind).toBe('session.updated');
    expect(classifyWatchEvent(s, 'b.jsonl', 1000)?.kind).toBe('session.updated'); // a 스로틀과 무관
    expect(classifyWatchEvent(s, 'a.jsonl', 1500)).toBeNull(); // a 스로틀 내
  });
});
