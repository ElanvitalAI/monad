// ── IUL Phase S·a — modal-surface adapter integration tests ──

import { describe, expect, test } from 'bun:test';
import {
  wireModalSurfaceAdapter,
  createSurfaceRegistry,
  type SurfaceRegistry,
} from '../src/surface/index.js';
import {
  createModalIdentityRegistry,
  type ModalIdentityRegistry,
} from '../src/display/modal-identity.js';

function freshPair(): { registry: SurfaceRegistry; identity: ModalIdentityRegistry } {
  return {
    registry: createSurfaceRegistry(),
    identity: createModalIdentityRegistry(),
  };
}

describe('modal-surface adapter', () => {
  test('identity push registers a modal entry in the registry', () => {
    const { registry, identity } = freshPair();
    wireModalSurfaceAdapter({ registry, identity });

    const id = identity.allocate({ kind: 'chat-search', surfaceId: 'chat-search-modal' });
    identity.notifyPush(id, 'chat-search-modal', 'picker');

    const desc = registry.get({ kind: 'modal', modalId: id.modalId });
    expect(desc).toBeDefined();
    expect(desc!.kindTag).toBe('chat-search');
    expect(desc!.surfaceId).toBe('chat-search-modal');
    expect(desc!.tier).toBe('picker');
    expect(desc!.title).toBe('chat-search');
    expect(desc!.visible).toBe(true);
  });

  test('identity pop unregisters the matching modal entry', () => {
    const { registry, identity } = freshPair();
    wireModalSurfaceAdapter({ registry, identity });

    const id = identity.allocate({ kind: 'dialog' });
    identity.notifyPush(id, 's-1', 'dialog');
    identity.notifyPop(id, 's-1', 'dialog');

    expect(registry.get({ kind: 'modal', modalId: id.modalId })).toBeUndefined();
  });

  test('promote produces a separate registry entry (no auto-unregister of from)', () => {
    const { registry, identity } = freshPair();
    wireModalSurfaceAdapter({ registry, identity });

    const a = identity.allocate({ kind: 'modal' });
    identity.notifyPush(a, 's-1', 'dialog');
    const b = identity.promote(a, { kind: 'popover' });
    identity.notifyPush(b, 's-1', 'popup');

    expect(registry.list().length).toBe(2);
    expect(registry.get({ kind: 'modal', modalId: a.modalId })).toBeDefined();
    expect(registry.get({ kind: 'modal', modalId: b.modalId })).toBeDefined();
  });

  test('dispose detaches from identity events', () => {
    const { registry, identity } = freshPair();
    const handle = wireModalSurfaceAdapter({ registry, identity });
    handle.dispose();
    const id = identity.allocate({ kind: 'dialog' });
    identity.notifyPush(id, 's-1');
    expect(registry.list().length).toBe(0);
  });

  test('custom titleOf is respected', () => {
    const { registry, identity } = freshPair();
    wireModalSurfaceAdapter({
      registry, identity,
      titleOf: id => `Modal[${id.kind}]@${id.surfaceId ?? '?'}`,
    });
    const id = identity.allocate({ kind: 'dialog', surfaceId: 's-99' });
    identity.notifyPush(id, 's-99');
    const desc = registry.get({ kind: 'modal', modalId: id.modalId });
    expect(desc!.title).toBe('Modal[dialog]@s-99');
  });

  test('multiple stacked modals each get their own entry', () => {
    const { registry, identity } = freshPair();
    wireModalSurfaceAdapter({ registry, identity });

    const a = identity.allocate({ kind: 'dialog' });
    const b = identity.allocate({ kind: 'popup' });
    identity.notifyPush(a, 's-a', 'dialog');
    identity.notifyPush(b, 's-b', 'popup');
    expect(registry.listByKind('modal').length).toBe(2);

    identity.notifyPop(a, 's-a');
    expect(registry.listByKind('modal').length).toBe(1);
    expect(registry.get({ kind: 'modal', modalId: b.modalId })).toBeDefined();
  });
});
