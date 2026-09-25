// ── IUL Phase M — wiring helper tests ──
//
// Verifies that `composeIdentityHooks` auto-allocates identities for
// modal-kind surfaces routed through DisplayHooks, fans out to base
// hooks, and tolerates non-modal surface mounts.

import { describe, expect, test } from 'bun:test';
import {
  composeIdentityHooks,
} from '../src/display/modal-identity-wiring.js';
import {
  createModalIdentityRegistry,
  type ModalLifecycleEvent,
} from '../src/display/modal-identity.js';
import type { DisplaySurface, DisplayHooks } from '../src/display/types.js';

function makeModal(id: string, tier?: string): DisplaySurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 100,
    ...(tier !== undefined ? { tier: tier as never } : {}),
    render: () => [],
  };
}

function makePane(id: string): DisplaySurface {
  return {
    id,
    kind: 'pane',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
  };
}

describe('modal-identity wiring', () => {
  test('mounting a modal allocates and pushes an identity', () => {
    const registry = createModalIdentityRegistry();
    const pushes: ModalLifecycleEvent[] = [];
    registry.onPush(e => pushes.push(e));

    const hooks = composeIdentityHooks({}, { registry });
    hooks.onSurfaceMounted!(makeModal('chat-search-modal', 'picker'));

    expect(pushes.length).toBe(1);
    expect(pushes[0]!.surfaceId).toBe('chat-search-modal');
    expect(pushes[0]!.identity.kind).toBe('picker');
    expect(pushes[0]!.tier).toBe('picker');
  });

  test('non-modal surface mount is ignored (no identity allocated)', () => {
    const registry = createModalIdentityRegistry();
    const pushes: ModalLifecycleEvent[] = [];
    registry.onPush(e => pushes.push(e));

    const hooks = composeIdentityHooks({}, { registry });
    hooks.onSurfaceMounted!(makePane('terminal-pane-1'));

    expect(pushes.length).toBe(0);
    expect(registry.list().length).toBe(0);
  });

  test('disposing a mounted modal pops + releases the identity', () => {
    const registry = createModalIdentityRegistry();
    const pops: ModalLifecycleEvent[] = [];
    registry.onPop(e => pops.push(e));

    const hooks = composeIdentityHooks({}, { registry });
    const surface = makeModal('dialog-1', 'dialog');
    hooks.onSurfaceMounted!(surface);
    hooks.onSurfaceDisposed!(surface);

    expect(pops.length).toBe(1);
    expect(registry.listOpen().length).toBe(0);
    expect(registry.listClosed().length).toBe(1);
  });

  test('identityFor() resolves the active identity by surface id', () => {
    const registry = createModalIdentityRegistry();
    const hooks = composeIdentityHooks({}, { registry });
    hooks.onSurfaceMounted!(makeModal('popup-1', 'popup'));
    const ident = hooks.identityFor('popup-1');
    expect(ident).toBeDefined();
    expect(ident!.kind).toBe('popup');
  });

  test('re-mounting the same surface id allocates a fresh identity', () => {
    const registry = createModalIdentityRegistry();
    const hooks = composeIdentityHooks({}, { registry });
    const surface = makeModal('chat-search-modal', 'picker');

    hooks.onSurfaceMounted!(surface);
    const first = hooks.identityFor('chat-search-modal')!;
    hooks.onSurfaceDisposed!(surface);
    hooks.onSurfaceMounted!(surface);
    const second = hooks.identityFor('chat-search-modal')!;

    expect(first.modalId).not.toBe(second.modalId);
    // No automatic promotedFrom — caller is responsible for chaining.
    expect(second.promotedFrom).toBeUndefined();
  });

  test('base hooks fire in addition to identity wiring', () => {
    const registry = createModalIdentityRegistry();
    const baseMounts: string[] = [];
    const baseDisposes: string[] = [];
    const base: DisplayHooks = {
      onSurfaceMounted: s => baseMounts.push(s.id),
      onSurfaceDisposed: s => baseDisposes.push(s.id),
    };
    const hooks = composeIdentityHooks(base, { registry });
    const surface = makeModal('m1', 'dialog');

    hooks.onSurfaceMounted!(surface);
    hooks.onSurfaceDisposed!(surface);

    expect(baseMounts).toEqual(['m1']);
    expect(baseDisposes).toEqual(['m1']);
  });

  test('dispose() detaches: future mounts no longer push', () => {
    const registry = createModalIdentityRegistry();
    const pushes: ModalLifecycleEvent[] = [];
    registry.onPush(e => pushes.push(e));

    const hooks = composeIdentityHooks({}, { registry });
    hooks.onSurfaceMounted!(makeModal('m1', 'dialog'));
    hooks.dispose();
    hooks.onSurfaceMounted!(makeModal('m2', 'dialog'));

    expect(pushes.length).toBe(1);
    expect(pushes[0]!.surfaceId).toBe('m1');
  });

  test('custom kindOf() override is respected', () => {
    const registry = createModalIdentityRegistry();
    const pushes: ModalLifecycleEvent[] = [];
    registry.onPush(e => pushes.push(e));

    const hooks = composeIdentityHooks({}, {
      registry,
      kindOf: s => `custom-${s.id}`,
    });
    hooks.onSurfaceMounted!(makeModal('chat-x', 'picker'));
    expect(pushes[0]!.identity.kind).toBe('custom-chat-x');
  });
});
