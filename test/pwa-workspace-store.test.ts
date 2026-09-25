// PR #1 — workspace reducer unit tests.
//
// Pure reducer · no localStorage / DOM. Covers every action + invariant
// (single-instance collapse · activeId fallback on close · activate
// auto-unfreeze · order/frozen 정합 유지).

import { describe, expect, test } from 'bun:test';
import {
  initialWorkspaceState,
  workspaceReducer,
  makeChatTab,
  makeSingleTab,
  tabsInOrder,
  findTabByKind,
} from '../apps/pwa/src/lib/workspace/store.js';
import type { WorkspaceState } from '../apps/pwa/src/lib/workspace/types.js';

const T0 = 1_700_000_000_000;

function chatTab(id: string, sessionId = `s-${id}`, t = T0): ReturnType<typeof makeChatTab> {
  return makeChatTab({ id, sessionId, createdAt: t });
}

function termTab(id: string, t = T0): ReturnType<typeof makeSingleTab> {
  return makeSingleTab({ id, kind: 'term', createdAt: t });
}

describe('workspaceReducer · addTab', () => {
  test('첫 탭 추가 → activeId 자동 설정', () => {
    const tab = chatTab('a');
    const next = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab });
    expect(next.tabs).toHaveLength(1);
    expect(next.order).toEqual(['a']);
    expect(next.activeId).toBe('a');
  });

  test('두 번째 chat 탭 — multi-instance 허용', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    expect(s.tabs).toHaveLength(2);
    expect(s.order).toEqual(['a', 'b']);
    expect(s.activeId).toBe('b');
  });

  test('term 탭 두 번 add → single-instance collapse · 두 번째는 기존 활성', () => {
    let s = workspaceReducer(initialWorkspaceState, {
      type: 'addTab',
      tab: termTab('term-1'),
    });
    s = workspaceReducer(s, { type: 'addTab', tab: termTab('term-2') });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).toBe('term-1');
    expect(s.activeId).toBe('term-1');
  });

  test('activate:false 옵션 — 활성 변화 없음', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    const before = s.activeId;
    s = workspaceReducer(s, {
      type: 'addTab',
      tab: chatTab('b'),
      activate: false,
    });
    expect(s.activeId).toBe(before);
    expect(s.tabs).toHaveLength(2);
  });

  test('중복 id add — pure no-op (활성만 변경)', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    expect(s.activeId).toBe('b');
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('a') });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe('a');
  });
});

describe('workspaceReducer · closeTab', () => {
  function setup3(): WorkspaceState {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('c') });
    return s;
  }

  test('현재 active 닫기 → 직전 인접 활성', () => {
    let s = setup3();
    expect(s.activeId).toBe('c');
    s = workspaceReducer(s, { type: 'closeTab', id: 'c' });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe('b');
  });

  test('첫 탭 active 시 닫기 → 다음 활성', () => {
    let s = setup3();
    s = workspaceReducer(s, { type: 'activateTab', id: 'a' });
    s = workspaceReducer(s, { type: 'closeTab', id: 'a' });
    expect(s.activeId).toBe('b');
  });

  test('비활성 탭 닫기 → activeId 보존', () => {
    let s = setup3();
    s = workspaceReducer(s, { type: 'closeTab', id: 'a' });
    expect(s.activeId).toBe('c');
    expect(s.order).toEqual(['b', 'c']);
  });

  test('마지막 탭 닫기 → activeId null', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'closeTab', id: 'a' });
    expect(s.tabs).toHaveLength(0);
    expect(s.activeId).toBeNull();
  });

  test('frozen list 도 정리됨', () => {
    let s = setup3();
    s = workspaceReducer(s, { type: 'freezeTab', id: 'a' });
    expect(s.frozenIds).toContain('a');
    s = workspaceReducer(s, { type: 'closeTab', id: 'a' });
    expect(s.frozenIds).not.toContain('a');
  });

  test('미존재 id 닫기 → 변화 없음', () => {
    const s = setup3();
    const next = workspaceReducer(s, { type: 'closeTab', id: 'zzz' });
    expect(next).toBe(s);
  });
});

describe('workspaceReducer · activateTab', () => {
  test('activate 시 frozen 자동 unfreeze', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    s = workspaceReducer(s, { type: 'freezeTab', id: 'a' });
    expect(s.frozenIds).toContain('a');
    s = workspaceReducer(s, { type: 'activateTab', id: 'a' });
    expect(s.activeId).toBe('a');
    expect(s.frozenIds).not.toContain('a');
  });

  test('미존재 id 활성 → 변화 없음', () => {
    const s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    const next = workspaceReducer(s, { type: 'activateTab', id: 'zzz' });
    expect(next).toBe(s);
  });

  test('이미 활성 → 변화 없음', () => {
    const s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    const next = workspaceReducer(s, { type: 'activateTab', id: 'a' });
    expect(next).toBe(s);
  });
});

describe('workspaceReducer · reorderTab', () => {
  function abc(): WorkspaceState {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('c') });
    return s;
  }

  test('a 를 끝으로 이동', () => {
    let s = abc();
    s = workspaceReducer(s, { type: 'reorderTab', id: 'a', toIndex: 2 });
    expect(s.order).toEqual(['b', 'c', 'a']);
  });

  test('c 를 처음으로 이동', () => {
    let s = abc();
    s = workspaceReducer(s, { type: 'reorderTab', id: 'c', toIndex: 0 });
    expect(s.order).toEqual(['c', 'a', 'b']);
  });

  test('toIndex out of range → clamp', () => {
    let s = abc();
    s = workspaceReducer(s, { type: 'reorderTab', id: 'a', toIndex: 99 });
    expect(s.order).toEqual(['b', 'c', 'a']);
  });

  test('동일 위치 → 변화 없음', () => {
    const s = abc();
    const next = workspaceReducer(s, { type: 'reorderTab', id: 'a', toIndex: 0 });
    expect(next).toBe(s);
  });
});

describe('workspaceReducer · updateTab', () => {
  test('chat 탭 sessionId 변경', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a', 's-old') });
    s = workspaceReducer(s, {
      type: 'updateTab',
      id: 'a',
      patch: { sessionId: 's-new' },
    });
    const updated = s.tabs[0];
    expect(updated.kind).toBe('chat');
    if (updated.kind === 'chat') {
      expect(updated.sessionId).toBe('s-new');
    }
  });

  test('chat 탭 title 설정', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'updateTab', id: 'a', patch: { title: 'hello' } });
    const t = s.tabs[0];
    if (t.kind === 'chat') {
      expect(t.title).toBe('hello');
    }
  });

  test('term 탭 update 시도 → 변화 없음 (chat 만 patch 받음)', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: termTab('t-1') });
    const before = s;
    s = workspaceReducer(s, {
      type: 'updateTab',
      id: 't-1',
      patch: { sessionId: 'foo' } as never,
    });
    expect(s).toBe(before);
  });
});

describe('workspaceReducer · freeze/unfreeze', () => {
  test('active 탭 freeze 거부', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'freezeTab', id: 'a' });
    expect(s.frozenIds).toEqual([]);
  });

  test('비활성 탭 freeze → frozenIds 에 추가', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    s = workspaceReducer(s, { type: 'freezeTab', id: 'a' });
    expect(s.frozenIds).toEqual(['a']);
  });

  test('중복 freeze → idempotent', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    s = workspaceReducer(s, { type: 'freezeTab', id: 'a' });
    const before = s.frozenIds.length;
    s = workspaceReducer(s, { type: 'freezeTab', id: 'a' });
    expect(s.frozenIds.length).toBe(before);
  });

  test('unfreeze 미존재 id → 변화 없음', () => {
    const s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    const next = workspaceReducer(s, { type: 'unfreezeTab', id: 'a' });
    expect(next).toBe(s);
  });
});

describe('workspaceReducer · replace', () => {
  test('전체 state 치환 (hydrate 용)', () => {
    const replacement: WorkspaceState = {
      tabs: [chatTab('z')],
      order: ['z'],
      activeId: 'z',
      frozenIds: [],
    };
    const s = workspaceReducer(initialWorkspaceState, {
      type: 'replace',
      state: replacement,
    });
    expect(s).toBe(replacement);
  });
});

describe('helpers', () => {
  test('tabsInOrder 가 order 순서대로 tab 객체 반환', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: chatTab('b') });
    s = workspaceReducer(s, { type: 'reorderTab', id: 'a', toIndex: 1 });
    const ordered = tabsInOrder(s);
    expect(ordered.map((t) => t.id)).toEqual(['b', 'a']);
  });

  test('findTabByKind 첫 매치 반환', () => {
    let s = workspaceReducer(initialWorkspaceState, { type: 'addTab', tab: chatTab('a') });
    s = workspaceReducer(s, { type: 'addTab', tab: termTab('t-1') });
    const term = findTabByKind(s, 'term');
    expect(term?.id).toBe('t-1');
  });
});
