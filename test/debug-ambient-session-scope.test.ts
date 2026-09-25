import { describe, expect, test } from 'bun:test';
import {
  debug,
  getAmbientSessionId,
  setAmbientSessionId,
  withAmbientSessionScope,
} from '../src/debug/log.js';

describe('ambient session execution scope', () => {
  test('overlapping scopes retain their own session identifier until each completes', async () => {
    const previousAmbientSessionId = getAmbientSessionId();
    setAmbientSessionId('repl-fallback');
    try {
      let releaseFirst!: () => void;
      const firstMayFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstStarted!: () => void;
      const firstHasStarted = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });

      const first = withAmbientSessionScope('session-A', async () => {
        const beforeOverlap = getAmbientSessionId();
        firstStarted();
        await firstMayFinish;
        const afterOverlap = getAmbientSessionId();
        return { beforeOverlap, afterOverlap };
      });

      await firstHasStarted;
      const second = withAmbientSessionScope('session-B', async () => {
        const beforeFirstFinishes = getAmbientSessionId();
        releaseFirst();
        const firstResult = await first;
        const afterFirstFinishes = getAmbientSessionId();
        return { beforeFirstFinishes, afterFirstFinishes, firstResult };
      });

      await expect(second).resolves.toEqual({
        beforeFirstFinishes: 'session-B',
        afterFirstFinishes: 'session-B',
        firstResult: {
          beforeOverlap: 'session-A',
          afterOverlap: 'session-A',
        },
      });
    } finally {
      setAmbientSessionId(previousAmbientSessionId);
    }
  });

  test('an exception leaves no scoped session behind and restores the global fallback', async () => {
    const previousAmbientSessionId = getAmbientSessionId();
    setAmbientSessionId('repl-fallback');
    try {
      await expect(withAmbientSessionScope('session-error', async () => {
        expect(getAmbientSessionId()).toBe('session-error');
        throw new Error('expected scoped failure');
      })).rejects.toThrow('expected scoped failure');

      expect(getAmbientSessionId()).toBe('repl-fallback');
    } finally {
      setAmbientSessionId(previousAmbientSessionId);
    }
  });

  test('outside an execution scope, the existing global session remains the fallback', () => {
    const previousAmbientSessionId = getAmbientSessionId();
    setAmbientSessionId('repl-session');
    try {
      expect(getAmbientSessionId()).toBe('repl-session');
    } finally {
      setAmbientSessionId(previousAmbientSessionId);
    }
  });
});

// ⭐⭐⭐ 스코프가 갈아탈 때 **관계를 남긴다**(원장 `MEAS-S14` 근본 수리).
//
// 실측 2026-08-02: 채팅 턴(`604f5635-…`) 안에서 하위 런타임이 자기 세션(`monad-session-hmkr5g`)으로
// 다시 감쌌고, 그 뒤 `capability.resolve/tool-selected` 가 **전부 자식 세션**으로 찍혀
// `--session <채팅>` 조회에서 사라졌다. NL 코퍼스가 위임 턴을 전부 `no-fire` 로 읽은 원인이다.
describe('withAmbientSessionScope — 부모↔자식 간선', () => {
  const captured: { category: string; event: string; data?: Record<string, unknown> }[] = [];
  const install = () => {
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: Record<string, unknown>) => {
      captured.push({ category, event, ...(data ? { data } : {}) });
    }) as typeof debug.log;
    return () => { (debug as { log: typeof debug.log }).log = original; };
  };

  test('부모 스코프가 있고 세션이 다르면 간선을 남긴다 — ⛔ 그 행은 **부모**로 귀속돼야 한다', () => {
    captured.length = 0;
    const restore = install();
    try {
      withAmbientSessionScope('parent-1', () => {
        // ⛔ 간선 로그는 자식 스코프 **밖**(부모 스코프)에서 나야 한다 — 안에서 나면 그 행마저
        //    자식으로 귀속돼 부모 조회에 안 걸리고, 이 수리가 고치려는 결함을 반복한다.
        const ambientWhenLinkEmitted: (string | null)[] = [];
        const originalPush = captured.push.bind(captured);
        (captured as unknown as { push: typeof originalPush }).push = ((entry: never) => {
          ambientWhenLinkEmitted.push(getAmbientSessionId());
          return originalPush(entry);
        }) as typeof originalPush;
        withAmbientSessionScope('child-1', () => undefined);
        (captured as unknown as { push: typeof originalPush }).push = originalPush;
        expect(ambientWhenLinkEmitted).toEqual(['parent-1']);
      });
    } finally { restore(); }
    expect(captured).toEqual([
      { category: 'session.link', event: 'child-scope', data: { parentSessionId: 'parent-1', childSessionId: 'child-1' } },
    ]);
  });

  test('부모가 없으면 간선이 아니다', () => {
    captured.length = 0;
    const previous = getAmbientSessionId();
    setAmbientSessionId(null);
    const restore = install();
    try {
      withAmbientSessionScope('lonely', () => undefined);
    } finally { restore(); setAmbientSessionId(previous); }
    expect(captured).toEqual([]);
  });

  test('같은 세션으로 다시 감싸면 자기 자신을 가리키는 링크를 만들지 않는다', () => {
    captured.length = 0;
    const restore = install();
    try {
      withAmbientSessionScope('same', () => withAmbientSessionScope('same', () => undefined));
    } finally { restore(); }
    expect(captured.filter((e) => e.category === 'session.link')).toEqual([]);
  });
});
