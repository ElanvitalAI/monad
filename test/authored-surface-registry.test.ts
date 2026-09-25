import { beforeEach, describe, expect, test } from 'bun:test';
import {
  __setGlobalAuthoredSurfaceRegistry,
  createAuthoredSurfaceRegistry,
  getAuthoredSurfaceRegistry,
  type AuthoredSurfaceRegistry,
} from '../src/surface/authored-surface-registry.js';

describe('authored-surface-registry', () => {
  let registry: AuthoredSurfaceRegistry;

  beforeEach(() => {
    registry = createAuthoredSurfaceRegistry();
  });

  test('register allocates pending authored surface with metadata', () => {
    const entry = registry.register({
      sourceKind: 'llm-authored',
      targetKind: 'popup',
      authorSessionId: 'sess-1',
      linkedMessageId: 'msg-1',
      persistent: true,
      workspaceId: 'dashboard-main',
      title: 'Plan graph',
      now: () => 10,
    });
    expect(entry.renderState).toBe('pending');
    expect(entry.sourceKind).toBe('llm-authored');
    expect(entry.targetKind).toBe('popup');
    expect(entry.authorSessionId).toBe('sess-1');
    expect(entry.linkedMessageId).toBe('msg-1');
    expect(entry.persistent).toBe(true);
    expect(entry.workspaceId).toBe('dashboard-main');
    expect(entry.title).toBe('Plan graph');
    expect(entry.createdAt).toBe(10);
    expect(entry.updatedAt).toBe(10);
  });

  test('update can attach runtime surface identity and move pending to ready', () => {
    const entry = registry.register({
      authoredSurfaceId: 'auth-1',
      sourceKind: 'delegate-render',
      targetKind: 'modal',
      now: () => 1,
    });
    const next = registry.update({
      authoredSurfaceId: entry.authoredSurfaceId,
      renderState: 'ready',
      surfaceId: 'surface-1',
      workspaceId: 'dashboard-main',
      addr: { kind: 'modal', modalId: 'modal-1' },
      title: 'Mermaid',
      now: () => 2,
    })!;
    expect(next.renderState).toBe('ready');
    expect(next.surfaceId).toBe('surface-1');
    expect(next.workspaceId).toBe('dashboard-main');
    expect(next.addr).toEqual({ kind: 'modal', modalId: 'modal-1' });
    expect(next.title).toBe('Mermaid');
    expect(next.updatedAt).toBe(2);
  });

  test('invalid transition throws', () => {
    const entry = registry.register({
      sourceKind: 'llm-authored',
      targetKind: 'popup',
      renderState: 'ready',
    });
    expect(() => registry.update({
      authoredSurfaceId: entry.authoredSurfaceId,
      renderState: 'pending',
    })).toThrow(/invalid authored surface transition/);
  });

  test('error and cancelled can retry back to pending', () => {
    const failed = registry.register({
      authoredSurfaceId: 'auth-error',
      sourceKind: 'delegate-render',
      targetKind: 'popup',
      renderState: 'error',
    });
    expect(registry.update({
      authoredSurfaceId: failed.authoredSurfaceId,
      renderState: 'pending',
    })?.renderState).toBe('pending');

    const cancelled = registry.register({
      authoredSurfaceId: 'auth-cancel',
      sourceKind: 'delegate-render',
      targetKind: 'popup',
      renderState: 'cancelled',
    });
    expect(registry.update({
      authoredSurfaceId: cancelled.authoredSurfaceId,
      renderState: 'pending',
    })?.renderState).toBe('pending');
  });

  test('release removes active entry and emits cancelled for pending work', () => {
    const seen: string[] = [];
    registry.on('release', (event) => seen.push(event.descriptor.renderState));
    const entry = registry.register({
      authoredSurfaceId: 'auth-release',
      sourceKind: 'llm-authored',
      targetKind: 'popup',
      renderState: 'pending',
    });
    const released = registry.release(entry.authoredSurfaceId, { now: () => 5 })!;
    expect(released.renderState).toBe('cancelled');
    expect(released.updatedAt).toBe(5);
    expect(registry.get(entry.authoredSurfaceId)).toBeUndefined();
    expect(seen).toEqual(['cancelled']);
  });

  test('release preserves terminal ready state', () => {
    const entry = registry.register({
      authoredSurfaceId: 'auth-ready',
      sourceKind: 'user-authored',
      targetKind: 'pane',
      renderState: 'ready',
    });
    const released = registry.release(entry.authoredSurfaceId)!;
    expect(released.renderState).toBe('ready');
  });

  test('listByState and listActive filter as expected', () => {
    registry.register({
      authoredSurfaceId: 'pending',
      sourceKind: 'llm-authored',
      targetKind: 'popup',
    });
    registry.register({
      authoredSurfaceId: 'ready',
      sourceKind: 'llm-authored',
      targetKind: 'pane',
      renderState: 'ready',
    });
    registry.register({
      authoredSurfaceId: 'cancelled',
      sourceKind: 'llm-authored',
      targetKind: 'modal',
      renderState: 'cancelled',
    });
    expect(registry.listByState('ready').map((entry) => entry.authoredSurfaceId)).toEqual(['ready']);
    expect(registry.listActive().map((entry) => entry.authoredSurfaceId)).toEqual(['pending', 'ready']);
  });
});

describe('authored-surface-registry global singleton', () => {
  test('global getter returns singleton', () => {
    const a = getAuthoredSurfaceRegistry();
    const b = getAuthoredSurfaceRegistry();
    expect(a).toBe(b);
  });

  test('__setGlobalAuthoredSurfaceRegistry swaps singleton', () => {
    const fresh = createAuthoredSurfaceRegistry();
    const prev = __setGlobalAuthoredSurfaceRegistry(fresh);
    try {
      expect(getAuthoredSurfaceRegistry()).toBe(fresh);
    } finally {
      __setGlobalAuthoredSurfaceRegistry(prev);
    }
  });
});
