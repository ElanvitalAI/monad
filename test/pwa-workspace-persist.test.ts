// PR #1 — workspace persist tests.
//
// localStorage round-trip · schema version guard · 깨진 storage fallback ·
// normalize (order/active/frozen 정합).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_STORAGE_KEY,
  clearWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
} from '../apps/pwa/src/lib/workspace/persist.js';
import {
  initialWorkspaceState,
  makeChatTab,
} from '../apps/pwa/src/lib/workspace/store.js';
import type { WorkspaceState } from '../apps/pwa/src/lib/workspace/types.js';

// 가벼운 in-memory localStorage shim — bun 의 nodejs-only 환경에서
// window.localStorage 가 없으므로 테스트 시작 시 polyfill.
class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    localStorage: new MemStorage(),
  };
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('persist · empty', () => {
  test('storage 비어있을 때 → initialWorkspaceState', () => {
    expect(loadWorkspaceState()).toEqual(initialWorkspaceState);
  });
});

describe('persist · round-trip', () => {
  test('save 후 load 로 동일 state 회복', () => {
    const s: WorkspaceState = {
      tabs: [makeChatTab({ id: 'a', sessionId: 's-a', createdAt: 1 })],
      order: ['a'],
      activeId: 'a',
      frozenIds: [],
    };
    saveWorkspaceState(s);
    const loaded = loadWorkspaceState();
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.activeId).toBe('a');
    expect(loaded.order).toEqual(['a']);
  });
});

describe('persist · schema version guard', () => {
  test('version 불일치 → fallback to initial', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 999, state: initialWorkspaceState }),
    );
    expect(loadWorkspaceState()).toEqual(initialWorkspaceState);
  });

  test('현재 version 매치 + 정상 state → load 성공', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    const payload = {
      version: WORKSPACE_SCHEMA_VERSION,
      state: {
        tabs: [makeChatTab({ id: 'a', sessionId: 's-a', createdAt: 1 })],
        order: ['a'],
        activeId: 'a',
        frozenIds: [],
      },
    };
    w.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
    expect(loadWorkspaceState().tabs).toHaveLength(1);
  });
});

describe('persist · 깨진 storage fallback', () => {
  test('JSON 파싱 실패 → initial', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(WORKSPACE_STORAGE_KEY, '{ not json');
    expect(loadWorkspaceState()).toEqual(initialWorkspaceState);
  });

  test('top-level shape 잘못됨 → initial', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify('plain string'));
    expect(loadWorkspaceState()).toEqual(initialWorkspaceState);
  });

  test('tab 한 개라도 깨졌으면 fallback', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: WORKSPACE_SCHEMA_VERSION,
        state: {
          tabs: [{ id: 'bad', kind: 'unknown-kind', createdAt: 1 }],
          order: ['bad'],
          activeId: 'bad',
          frozenIds: [],
        },
      }),
    );
    expect(loadWorkspaceState()).toEqual(initialWorkspaceState);
  });

  test('chat 탭에 sessionId 없음 → fallback', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: WORKSPACE_SCHEMA_VERSION,
        state: {
          tabs: [{ id: 'a', kind: 'chat', createdAt: 1 }],
          order: ['a'],
          activeId: 'a',
          frozenIds: [],
        },
      }),
    );
    expect(loadWorkspaceState()).toEqual(initialWorkspaceState);
  });
});

describe('persist · normalize', () => {
  test('order 에 미존재 id 가 섞이면 drop', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: WORKSPACE_SCHEMA_VERSION,
        state: {
          tabs: [makeChatTab({ id: 'a', sessionId: 's-a', createdAt: 1 })],
          order: ['ghost', 'a'],
          activeId: 'a',
          frozenIds: [],
        },
      }),
    );
    const loaded = loadWorkspaceState();
    expect(loaded.order).toEqual(['a']);
  });

  test('activeId 가 미존재 id → 첫 order 로 fallback', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: WORKSPACE_SCHEMA_VERSION,
        state: {
          tabs: [makeChatTab({ id: 'a', sessionId: 's-a', createdAt: 1 })],
          order: ['a'],
          activeId: 'ghost',
          frozenIds: [],
        },
      }),
    );
    const loaded = loadWorkspaceState();
    expect(loaded.activeId).toBe('a');
  });

  test('frozenIds 미존재 → drop', () => {
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: WORKSPACE_SCHEMA_VERSION,
        state: {
          tabs: [makeChatTab({ id: 'a', sessionId: 's-a', createdAt: 1 })],
          order: ['a'],
          activeId: 'a',
          frozenIds: ['ghost'],
        },
      }),
    );
    const loaded = loadWorkspaceState();
    expect(loaded.frozenIds).toEqual([]);
  });
});

describe('persist · clear', () => {
  test('clearWorkspaceState 후 load → initial', () => {
    saveWorkspaceState({
      tabs: [makeChatTab({ id: 'a', sessionId: 's-a', createdAt: 1 })],
      order: ['a'],
      activeId: 'a',
      frozenIds: [],
    });
    clearWorkspaceState();
    expect(loadWorkspaceState()).toEqual(initialWorkspaceState);
  });
});
