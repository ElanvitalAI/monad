// ── Option α.1 · ModalTier context-key typed enum ──
//
// `ContextKeys.modalTopTier` upgraded from `string | null` to
// `ModalTier | null` (the 8-kind union from `src/display/types.ts`).
// Runtime 값 변동 0 · publisher (`src/ui/modal-adapter.ts`) 는 이미
// `spec.tier` (ModalTier) 전달 · 소비자 타입만 빡빡해짐.
//
// These tests pin the typed contract + verify backward compat with
// INITIAL_CONTEXT_KEYS + equality-skip preservation.

import { describe, expect, test } from 'bun:test';
import {
  createContextKeyService,
  INITIAL_CONTEXT_KEYS,
  type ContextKeys,
} from '../src/input-core/index.js';
import { MODAL_TIER, type ModalTier } from '../src/display/types.js';

// ── §1 Initial + accepted values ─────────────────────────

describe('α.1 · modalTopTier ModalTier | null', () => {
  test('INITIAL_CONTEXT_KEYS.modalTopTier is null', () => {
    expect(INITIAL_CONTEXT_KEYS.modalTopTier).toBeNull();
  });

  test('every MODAL_TIER value is assignable · runtime round-trip', () => {
    const cks = createContextKeyService();
    for (const tier of Object.values(MODAL_TIER) as ModalTier[]) {
      cks.update({ modalTopTier: tier });
      expect(cks.keys.modalTopTier).toBe(tier);
    }
  });

  test('null clears tier · round-trip', () => {
    const cks = createContextKeyService();
    cks.update({ modalTopTier: 'dialog' });
    expect(cks.keys.modalTopTier).toBe('dialog');
    cks.update({ modalTopTier: null });
    expect(cks.keys.modalTopTier).toBeNull();
  });
});

// ── §2 Subscriber equality-skip preserved ─────────────────

describe('α.1 · subscriber equality-skip under ModalTier type', () => {
  test('two consecutive same-tier updates → 1 fire (prime + 1)', () => {
    const cks = createContextKeyService();
    let fireCount = 0;
    cks.subscribe(() => { fireCount++; });
    expect(fireCount).toBe(1); // prime

    cks.update({ modalTopTier: 'dialog' });
    expect(fireCount).toBe(2);

    cks.update({ modalTopTier: 'dialog' });
    expect(fireCount).toBe(2); // skipped
  });

  test('tier → different tier → null · 2 additional fires', () => {
    const cks = createContextKeyService();
    let fireCount = 0;
    cks.subscribe(() => { fireCount++; });
    expect(fireCount).toBe(1);

    cks.update({ modalTopTier: 'popup' });
    expect(fireCount).toBe(2);

    cks.update({ modalTopTier: 'tooltip' });
    expect(fireCount).toBe(3);

    cks.update({ modalTopTier: null });
    expect(fireCount).toBe(4);
  });
});

// ── §3 Type-level pin (compile-time protection) ──────────

describe('α.1 · type shape', () => {
  test('ModalTier assignment compiles · union members available', () => {
    const tiers: ModalTier[] = [
      'vw', 'execution', 'terminal', 'dialog',
      'popup', 'menu', 'picker', 'tooltip',
    ];
    expect(tiers.length).toBe(8);
  });

  test('snapshot type exposes modalTopTier as ModalTier | null', () => {
    const cks = createContextKeyService();
    cks.update({ modalTopTier: 'menu' });
    // Type-narrowing proof: assignment to a ModalTier-typed const
    // compiles when the narrowed value is non-null.
    const snapshot: Readonly<ContextKeys> = cks.keys;
    if (snapshot.modalTopTier !== null) {
      const narrowed: ModalTier = snapshot.modalTopTier;
      expect(narrowed).toBe('menu');
    }
  });
});

// ── §4 INITIAL_CONTEXT_KEYS key presence (typo pin) ──────

describe('α.1 · INITIAL_CONTEXT_KEYS typo pin', () => {
  test('modalTopTier is present · value null · type null | ModalTier', () => {
    expect('modalTopTier' in INITIAL_CONTEXT_KEYS).toBe(true);
    expect(INITIAL_CONTEXT_KEYS.modalTopTier).toBeNull();
  });
});
