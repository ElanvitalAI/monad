// ── PX-6 P2: peer-compat decision logic ──

import { describe, test, expect } from 'bun:test';
import { checkPeerCompat } from '../src/plugins/core/multi-active';
import type { PluginManifest } from '../src/plugins/core/manifest';

function mf(id: string, fields: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id, name: id, version: '0.1.0',
    main: './plugin.ts',
    activationEvents: ['onStartup'],
    contributes: {}, capabilities: [],
    ...fields,
  };
}

describe('PX-6 P2 — checkPeerCompat', () => {
  test('no peers → ok (first plugin)', () => {
    const d = checkPeerCompat(mf('a'), []);
    expect(d.ok).toBe(true);
    expect(d.status).toBe('ok');
  });

  test('candidate allowMultiActive=false with peers → rejected', () => {
    const d = checkPeerCompat(mf('a'), [mf('b', { allowMultiActive: true })]);
    expect(d.ok).toBe(false);
    expect(d.status).toBe('self-single-active');
  });

  test('peer allowMultiActive=false blocks activation', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true }),
      [mf('b')],   // allowMultiActive omitted → treated false
    );
    expect(d.ok).toBe(false);
    expect(d.status).toBe('peer-single-active');
    expect(d.blockedBy).toBe('b');
  });

  test('both allowMultiActive=true → ok when no explicit lists', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true }),
      [mf('b', { allowMultiActive: true })],
    );
    expect(d.ok).toBe(true);
  });

  test('candidate deny blocks peer', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true, activePeerCompat: { deny: ['b'] } }),
      [mf('b', { allowMultiActive: true })],
    );
    expect(d.ok).toBe(false);
    expect(d.status).toBe('deny-explicit');
    expect(d.blockedBy).toBe('b');
  });

  test('peer deny blocks candidate', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true }),
      [mf('b', { allowMultiActive: true, activePeerCompat: { deny: ['a'] } })],
    );
    expect(d.ok).toBe(false);
    expect(d.status).toBe('deny-explicit');
  });

  test('candidate allow-list must contain peer', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true, activePeerCompat: { allow: ['c'] } }),
      [mf('b', { allowMultiActive: true })],
    );
    expect(d.ok).toBe(false);
    expect(d.status).toBe('allow-list-mismatch');
  });

  test('candidate allow-list includes peer → ok', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true, activePeerCompat: { allow: ['b'] } }),
      [mf('b', { allowMultiActive: true })],
    );
    expect(d.ok).toBe(true);
  });

  test('peer allow-list must contain candidate', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true }),
      [mf('b', { allowMultiActive: true, activePeerCompat: { allow: ['c'] } })],
    );
    expect(d.ok).toBe(false);
    expect(d.status).toBe('allow-list-mismatch');
  });

  test('walks through multiple peers — any block wins', () => {
    const d = checkPeerCompat(
      mf('a', { allowMultiActive: true }),
      [
        mf('b', { allowMultiActive: true }),
        mf('c', { allowMultiActive: true, activePeerCompat: { deny: ['a'] } }),
      ],
    );
    expect(d.ok).toBe(false);
    expect(d.blockedBy).toBe('c');
  });
});
