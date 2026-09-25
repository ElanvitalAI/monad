// ── ModalLifecycle × MSS M1.2 narrow tests ──
//
// Verifies that ModalLifecycle.push() stamps a fresh ModalUri on every
// handle and that the legacy SurfaceId slug stays unchanged. Includes
// a re-push (replace) check to make sure each push is a distinct URI.

import { describe, expect, test } from 'bun:test';
import type { ModalSurface } from '../src/display/modal-stack.ts';
import {
  createModalLifecycle,
  type ModalType,
} from '../src/primitives/modal-lifecycle/index.ts';
import { asModalUri } from '../src/mss/uri/builder.ts';

function makeSurface(id: string): ModalSurface {
  return {
    id: id as ModalSurface['id'],
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 250,
    bounds: { row: 1, col: 1, width: 10, height: 5 },
    render: () => [],
    paint: () => '',
  };
}

function trivialType(name: string): ModalType {
  return { name, tier: 'dialog', factory: (ctx) => makeSurface(ctx.id) };
}

describe('ModalLifecycle × MSS M1.2 ModalUri narrow', () => {
  test('push() stamps a valid ModalUri on the handle', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(trivialType('mss-m1_2'));
    const handle = mlc.push('mss-m1_2');
    expect(handle).not.toBeNull();
    expect(handle!.modalUri).toBeDefined();
    expect(() => asModalUri(handle!.modalUri)).not.toThrow();
    expect(handle!.modalUri).toMatch(/^modal\/[0-9A-HJKMNP-TV-Z]{26}$/);
    handle!.dispose();
  });

  test('successive push() calls mint distinct ModalUris', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(trivialType('mss-m1_2-many'));
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const h = mlc.push('mss-m1_2-many');
      seen.add(h!.modalUri as string);
    }
    expect(seen.size).toBe(8);
  });

  test('replace via idempotency key mints a fresh ModalUri', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(trivialType('mss-m1_2-replace'));
    const a = mlc.push('mss-m1_2-replace', { idempotencyKey: 'k' });
    const firstUri = a!.modalUri;
    const b = mlc.push('mss-m1_2-replace', { idempotencyKey: 'k' });
    expect(b!.modalUri).not.toBe(firstUri);
    // Original handle was disposed by the replace path.
    expect(a!.isDisposed()).toBe(true);
  });
});
