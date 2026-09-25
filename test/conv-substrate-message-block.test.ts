// PR-CL1 (B.1 · 2026-04-29) — message-block substrate tests.
//
// Core invariants under test (PR #1042 보강):
//  1. Stable merge key generators produce predictable id pattern.
//  2. push() throws on duplicate id; update() throws on unknown id.
//  3. append vs update event 가 명확히 분리 (cross-fire 0).
//  4. id / ts / source 는 update 에 mutated 시 throw.
//  5. snapshot 순서는 append 순서 — update 가 자리 옮기지 않음.
//  6. per-listener errors 가 isolated.
//  7. dispose 후 stream 가 비어 있고 listener 도 정리.

import { describe, expect, test } from 'bun:test';
import {
  createMessageBlockStream,
  makeUserTurnBlockId,
  makeAssistantTurnBlockId,
  makeToolCallBlockId,
  makePlanBlockId,
  makeThoughtBlockId,
  makeSystemBlockId,
  type MessageBlock,
} from '../src/conv-substrate/message-block.js';

// ── helpers ──────────────────────────────────────────────────────────

const userBlock = (id: string, text = 'hi', ts = 1000): MessageBlock => ({
  id,
  ts,
  source: 'user',
  body: { kind: 'user', text },
});

const toolBlock = (id: string, status: string, ts = 2000): MessageBlock => ({
  id,
  ts,
  source: 'tool',
  body: { kind: 'tool-call', toolCallId: 'tc-1', title: 'read_file', status },
});

const assistantBlock = (id: string, text = 'reply', ts = 3000): MessageBlock => ({
  id,
  ts,
  source: 'agent',
  body: { kind: 'assistant', text, markdown: true },
});

// ── stable merge key generators ──────────────────────────────────────

describe('makeBlockId helpers · stable merge key generation', () => {
  test('user turn block id pattern: sessionId:user:turnSeq:blockSeq', () => {
    expect(makeUserTurnBlockId('s1', 0, 0)).toBe('s1:user:0:0');
    expect(makeUserTurnBlockId('sess-abc', 5, 2)).toBe('sess-abc:user:5:2');
  });

  test('assistant turn block id pattern: sessionId:assistant:turnSeq:blockSeq', () => {
    expect(makeAssistantTurnBlockId('s1', 0, 0)).toBe('s1:assistant:0:0');
    expect(makeAssistantTurnBlockId('s1', 12, 7)).toBe('s1:assistant:12:7');
  });

  test('tool-call block id is stable across update events', () => {
    // PR #1042 핵심 — 같은 toolCallId 의 tool_call_update 가 같은 block id
    // 를 사용해야 update 로 처리 가능.
    expect(makeToolCallBlockId('s1', 'tc-xyz')).toBe('s1:tool:tc-xyz');
    expect(makeToolCallBlockId('s1', 'tc-xyz')).toBe('s1:tool:tc-xyz');
  });

  test('plan / thought / system block id patterns', () => {
    expect(makePlanBlockId('s1', 'plan-001')).toBe('s1:plan:plan-001');
    expect(makeThoughtBlockId('s1', 0, 0)).toBe('s1:thought:0:0');
    expect(makeSystemBlockId('s1', 'error', 7)).toBe('s1:sys:error:7');
  });

  test('different sessions produce disjoint block ids', () => {
    expect(makeUserTurnBlockId('s1', 0, 0)).not.toBe(makeUserTurnBlockId('s2', 0, 0));
    expect(makeToolCallBlockId('s1', 'tc-a')).not.toBe(makeToolCallBlockId('s2', 'tc-a'));
  });
});

// ── push · append ─────────────────────────────────────────────────────

describe('createMessageBlockStream · push / append', () => {
  test('push appends to snapshot in order', () => {
    const s = createMessageBlockStream();
    s.push(userBlock('s1:user:0:0', 'one'));
    s.push(userBlock('s1:user:0:1', 'two'));
    s.push(userBlock('s1:user:0:2', 'three'));
    expect(s.snapshot().map((b) => b.id)).toEqual([
      's1:user:0:0',
      's1:user:0:1',
      's1:user:0:2',
    ]);
  });

  test('push throws on duplicate id — caller must use update()', () => {
    const s = createMessageBlockStream();
    s.push(userBlock('s1:user:0:0'));
    expect(() => s.push(userBlock('s1:user:0:0'))).toThrow(
      /already exists — use update/,
    );
  });

  test('push fires append listener with the appended block', () => {
    const s = createMessageBlockStream();
    const seen: MessageBlock[] = [];
    s.on('append', (b) => {
      seen.push(b);
    });
    s.push(userBlock('s1:user:0:0', 'hello'));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe('s1:user:0:0');
    expect((seen[0]!.body as { text: string }).text).toBe('hello');
  });

  test('push does NOT fire update listener', () => {
    // Invariant: append vs update separation
    const s = createMessageBlockStream();
    let updateCount = 0;
    s.on('update', () => {
      updateCount++;
    });
    s.push(userBlock('s1:user:0:0'));
    s.push(userBlock('s1:user:0:1'));
    expect(updateCount).toBe(0);
  });

  test('snapshot returns a defensive copy', () => {
    const s = createMessageBlockStream();
    s.push(userBlock('a'));
    const snap1 = s.snapshot();
    s.push(userBlock('b'));
    expect(snap1.map((b) => b.id)).toEqual(['a']); // earlier snapshot unaffected
    expect(s.snapshot().map((b) => b.id)).toEqual(['a', 'b']);
  });
});

// ── update ────────────────────────────────────────────────────────────

describe('createMessageBlockStream · update', () => {
  test('update mutates existing block + fires update listener', () => {
    const s = createMessageBlockStream();
    s.push(toolBlock('s1:tool:tc-1', 'running'));

    const seen: MessageBlock[] = [];
    s.on('update', (b) => {
      seen.push(b);
    });

    s.update('s1:tool:tc-1', (cur) => {
      // Demonstrate that current block is passed in (read access)
      expect(cur.body.kind).toBe('tool-call');
      return {
        ...cur,
        body: { ...cur.body, status: 'completed' } as MessageBlock['body'],
      };
    });

    expect(seen).toHaveLength(1);
    expect((seen[0]!.body as { status?: string }).status).toBe('completed');

    const snap = s.snapshot();
    expect(snap).toHaveLength(1);
    expect((snap[0]!.body as { status?: string }).status).toBe('completed');
  });

  test('update throws on unknown id — caller must use push()', () => {
    const s = createMessageBlockStream();
    expect(() => s.update('unknown', (b) => b)).toThrow(/not found — use push/);
  });

  test('update enforces id invariant — id mutation throws', () => {
    const s = createMessageBlockStream();
    s.push(toolBlock('s1:tool:tc-1', 'running'));
    expect(() =>
      s.update('s1:tool:tc-1', (cur) => ({ ...cur, id: 'mutated-id' })),
    ).toThrow(/id mutated/);
  });

  test('update enforces ts invariant — ts mutation throws', () => {
    const s = createMessageBlockStream();
    s.push(toolBlock('s1:tool:tc-1', 'running'));
    expect(() =>
      s.update('s1:tool:tc-1', (cur) => ({ ...cur, ts: 9999 })),
    ).toThrow(/ts mutated/);
  });

  test('update enforces source invariant — source mutation throws', () => {
    const s = createMessageBlockStream();
    s.push(toolBlock('s1:tool:tc-1', 'running'));
    expect(() =>
      s.update('s1:tool:tc-1', (cur) => ({ ...cur, source: 'agent' })),
    ).toThrow(/source mutated/);
  });

  test('update does NOT fire append listener (invariant separation)', () => {
    const s = createMessageBlockStream();
    s.push(toolBlock('s1:tool:tc-1', 'running'));

    let appendCount = 0;
    s.on('append', () => {
      appendCount++;
    });

    s.update('s1:tool:tc-1', (cur) => ({
      ...cur,
      body: { ...cur.body, status: 'done' } as MessageBlock['body'],
    }));
    expect(appendCount).toBe(0);
  });

  test('multiple updates of the same block — each fires separate update event', () => {
    const s = createMessageBlockStream();
    s.push(toolBlock('s1:tool:tc-1', 'running'));

    const statuses: string[] = [];
    s.on('update', (b) => {
      statuses.push((b.body as { status?: string }).status ?? '');
    });

    s.update('s1:tool:tc-1', (cur) => ({
      ...cur,
      body: { ...cur.body, status: 'in_progress' } as MessageBlock['body'],
    }));
    s.update('s1:tool:tc-1', (cur) => ({
      ...cur,
      body: { ...cur.body, status: 'completed' } as MessageBlock['body'],
    }));
    expect(statuses).toEqual(['in_progress', 'completed']);
  });
});

// ── subscription lifecycle ────────────────────────────────────────────

describe('createMessageBlockStream · subscription lifecycle', () => {
  test('on returns unsubscribe fn', () => {
    const s = createMessageBlockStream();
    let calls = 0;
    const unsub = s.on('append', () => {
      calls++;
    });
    s.push(userBlock('a'));
    expect(calls).toBe(1);

    unsub();
    s.push(userBlock('b'));
    expect(calls).toBe(1);
  });

  test('per-listener errors are isolated — one throw does not break siblings', () => {
    const s = createMessageBlockStream();
    s.on('append', () => {
      throw new Error('listener-1 boom');
    });
    let listener2Called = false;
    s.on('append', () => {
      listener2Called = true;
    });
    s.push(userBlock('a'));
    expect(listener2Called).toBe(true);
  });

  test('listener errors during update do not break subsequent updates', () => {
    const s = createMessageBlockStream();
    s.push(toolBlock('s1:tool:tc-1', 'running'));
    s.on('update', () => {
      throw new Error('handler boom');
    });
    let goodCalled = false;
    s.on('update', () => {
      goodCalled = true;
    });
    s.update('s1:tool:tc-1', (cur) => ({
      ...cur,
      body: { ...cur.body, status: 'done' } as MessageBlock['body'],
    }));
    expect(goodCalled).toBe(true);
  });
});

// ── dispose ───────────────────────────────────────────────────────────

describe('createMessageBlockStream · dispose', () => {
  test('dispose clears blocks + listeners', () => {
    const s = createMessageBlockStream();
    let calls = 0;
    s.on('append', () => {
      calls++;
    });
    s.push(userBlock('a'));
    expect(calls).toBe(1);
    expect(s.snapshot()).toHaveLength(1);

    s.dispose();
    expect(s.snapshot()).toEqual([]);

    // Re-using the disposed stream — listeners are gone, so subsequent
    // push should not call any callbacks.
    s.push(userBlock('b'));
    expect(calls).toBe(1);
  });
});

// ── invariant: cross-surface consistency ──────────────────────────────

describe('createMessageBlockStream · invariant: append vs update separation (PR #1042 핵심)', () => {
  test('cumulative subscriber that handles both events sees consistent state', () => {
    // pane / widget / log-debug 가 같은 stream 을 구독해도 분해 결과
    // 일치하려면 append/update 가 절대 섞이면 안 된다.
    const s = createMessageBlockStream();
    const log: Array<{ event: string; id: string }> = [];
    s.on('append', (b) => log.push({ event: 'append', id: b.id }));
    s.on('update', (b) => log.push({ event: 'update', id: b.id }));

    s.push(toolBlock('s1:tool:tc-1', 'running'));
    s.update('s1:tool:tc-1', (cur) => ({
      ...cur,
      body: { ...cur.body, status: 'completed' } as MessageBlock['body'],
    }));
    s.push(assistantBlock('s1:assistant:0:0', 'Done.'));

    expect(log).toEqual([
      { event: 'append', id: 's1:tool:tc-1' },
      { event: 'update', id: 's1:tool:tc-1' },
      { event: 'append', id: 's1:assistant:0:0' },
    ]);
  });

  test('snapshot order is append order — update does NOT reorder', () => {
    const s = createMessageBlockStream();
    s.push(userBlock('a', 'first'));
    s.push(toolBlock('b', 'running'));
    s.push(assistantBlock('c', 'reply'));

    s.update('a', (cur) => ({
      ...cur,
      body: { kind: 'user', text: 'first-updated' },
    }));

    expect(s.snapshot().map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  test('two independent subscribers see identical snapshot derivation', () => {
    // 시나리오: pane 과 widget 둘 다 stream 을 구독. event sequence 가
    // 같으므로 양쪽이 누적한 derived state 가 일치해야 함.
    const s = createMessageBlockStream();

    const paneState: MessageBlock[] = [];
    s.on('append', (b) => paneState.push(b));
    s.on('update', (b) => {
      const idx = paneState.findIndex((x) => x.id === b.id);
      if (idx >= 0) paneState[idx] = b;
    });

    const widgetState: MessageBlock[] = [];
    s.on('append', (b) => widgetState.push(b));
    s.on('update', (b) => {
      const idx = widgetState.findIndex((x) => x.id === b.id);
      if (idx >= 0) widgetState[idx] = b;
    });

    s.push(toolBlock('tc', 'running'));
    s.push(assistantBlock('asst'));
    s.update('tc', (cur) => ({
      ...cur,
      body: { ...cur.body, status: 'completed' } as MessageBlock['body'],
    }));

    expect(paneState.map((b) => b.id)).toEqual(widgetState.map((b) => b.id));
    expect(
      paneState.map((b) => (b.body as { status?: string }).status ?? '-'),
    ).toEqual(
      widgetState.map((b) => (b.body as { status?: string }).status ?? '-'),
    );
  });
});
