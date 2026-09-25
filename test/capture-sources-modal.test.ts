// ── Bundle 6T Phase C — modal-source tests ──

import { describe, expect, test } from 'bun:test';
import {
  resolveModalAnsi,
  createModalSource,
  describeModal,
  ModalSourceNotFoundError,
  type DisplaySurfaceResolver,
} from '../src/capture/index.js';
import {
  createModalIdentityRegistry,
  type ModalIdentityRegistry,
} from '../src/display/modal-identity.js';

function fakeResolver(map: Record<string, () => string>): DisplaySurfaceResolver {
  return {
    getSurface(id) {
      const paint = map[id];
      return paint ? { paint } : undefined;
    },
  };
}

describe('modal-source', () => {
  test('resolveModalAnsi returns surface.paint() string', () => {
    const identity = createModalIdentityRegistry();
    const id = identity.allocate({ kind: 'chat-search', surfaceId: 'csm' });
    identity.notifyPush(id, 'csm', 'picker');
    const resolver = fakeResolver({ csm: () => '\x1b[1mchat search\x1b[0m' });
    const out = resolveModalAnsi({ modalId: id.modalId, identity, surfaceResolver: resolver });
    expect(out).toBe('\x1b[1mchat search\x1b[0m');
  });

  test('unknown modalId → ModalSourceNotFoundError', () => {
    const identity = createModalIdentityRegistry();
    expect(() =>
      resolveModalAnsi({ modalId: 'does-not-exist', identity }),
    ).toThrow(ModalSourceNotFoundError);
  });

  test('identity exists but no surfaceResolver → empty string (graceful)', () => {
    const identity = createModalIdentityRegistry();
    const id = identity.allocate({ kind: 'dialog', surfaceId: 's1' });
    identity.notifyPush(id, 's1');
    expect(resolveModalAnsi({ modalId: id.modalId, identity })).toBe('');
  });

  test('resolver returns undefined surface → empty string', () => {
    const identity = createModalIdentityRegistry();
    const id = identity.allocate({ kind: 'dialog', surfaceId: 's1' });
    identity.notifyPush(id, 's1');
    const resolver = fakeResolver({});   // no surface for 's1'
    expect(resolveModalAnsi({ modalId: id.modalId, identity, surfaceResolver: resolver })).toBe('');
  });

  test('surface.paint throws → empty (isolated)', () => {
    const identity = createModalIdentityRegistry();
    const id = identity.allocate({ kind: 'dialog', surfaceId: 's1' });
    identity.notifyPush(id, 's1');
    const resolver = fakeResolver({ s1: () => { throw new Error('paint error'); } });
    expect(resolveModalAnsi({ modalId: id.modalId, identity, surfaceResolver: resolver })).toBe('');
  });

  test('createModalSource returns a closure resolving on each call', () => {
    const identity = createModalIdentityRegistry();
    const id = identity.allocate({ kind: 'dialog', surfaceId: 's1' });
    identity.notifyPush(id, 's1');
    let counter = 0;
    const resolver = fakeResolver({ s1: () => `frame-${++counter}` });
    const source = createModalSource({ modalId: id.modalId, identity, surfaceResolver: resolver });
    expect(source()).toBe('frame-1');
    expect(source()).toBe('frame-2');
  });

  test('describeModal returns metadata including chain depth', () => {
    const identity = createModalIdentityRegistry();
    const a = identity.allocate({ kind: 'modal' });
    const b = identity.promote(a, { kind: 'popover' });
    const desc = describeModal({ modalId: b.modalId, identity });
    expect(desc).toBeDefined();
    expect(desc!.modalId).toBe(b.modalId);
    expect(desc!.kind).toBe('popover');
    expect(desc!.promoteChainDepth).toBe(1);
    expect(desc!.promotedFromId).toBe(a.modalId);
  });

  test('describeModal returns undefined for unknown modalId', () => {
    const identity = createModalIdentityRegistry();
    expect(describeModal({ modalId: 'ghost', identity })).toBeUndefined();
  });
});
