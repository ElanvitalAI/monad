// T4.C — monad no-arg default remote resolve.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  resolveRemoteAttach,
  stripRemoteFlags,
  bookmarkToMonadRemote,
} from '../src/cli/remote-resolve.js';
import { RemotesStore, type RemoteEntry } from '../src/cli/remotes.js';

function mkStore() {
  const root = mkdtempSync(joinPath(tmpdir(), 'monad-resolve-'));
  const store = new RemotesStore({
    remotesFilePath: joinPath(root, 'remotes.json'),
    tokensDir: joinPath(root, 'remotes'),
  });
  return { store, cleanup: () => rmSync(root, { recursive: true }) };
}

function entry(name: string): RemoteEntry {
  return {
    host: name,
    acp_url: `ws://${name}:31415/v1/acp`,
    token_file: '',
    addedAt: 'now',
  };
}

describe('T4.C · stripRemoteFlags', () => {
  test('strips --local + --remote <name> only', () => {
    expect(stripRemoteFlags(['--debug', '--local', 'rest'])).toEqual(['--debug', 'rest']);
    expect(stripRemoteFlags(['--remote', 'mbp', '--debug'])).toEqual(['--debug']);
    expect(stripRemoteFlags([])).toEqual([]);
    expect(stripRemoteFlags(['--debug'])).toEqual(['--debug']);
  });
});

describe('T4.C · bookmarkToMonadRemote', () => {
  test('returns ws-url verbatim', () => {
    expect(bookmarkToMonadRemote(entry('mbp'))).toBe('ws://mbp:31415/v1/acp');
  });
});

describe('T4.C · resolveRemoteAttach precedence', () => {
  test('--local always wins (even with default bookmark)', () => {
    const { store, cleanup } = mkStore();
    const tokFile = store.saveToken('mbp', 'token');
    store.addRemote('mbp', { ...entry('mbp'), token_file: tokFile });
    const r = resolveRemoteAttach({
      rawArgs: ['--local'],
      store,
      envRemote: undefined,
    });
    expect(r.kind).toBe('local');
    if (r.kind === 'local') expect(r.reason).toBe('flag');
    cleanup();
  });

  test('--remote <name> picks the named bookmark', () => {
    const { store, cleanup } = mkStore();
    const tok = store.saveToken('a', 'tokA');
    store.addRemote('a', { ...entry('a'), token_file: tok });
    const r = resolveRemoteAttach({
      rawArgs: ['--remote', 'a'],
      store,
      envRemote: undefined,
    });
    expect(r.kind).toBe('remote');
    if (r.kind === 'remote') {
      expect(r.name).toBe('a');
      expect(r.token).toBe('tokA');
      expect(r.reason).toBe('flag');
    }
    cleanup();
  });

  test('--remote unknown → throws', () => {
    const { store, cleanup } = mkStore();
    expect(() =>
      resolveRemoteAttach({ rawArgs: ['--remote', 'nope'], store, envRemote: undefined }),
    ).toThrow(/unknown bookmark/);
    cleanup();
  });

  test('--remote with empty value → throws', () => {
    const { store, cleanup } = mkStore();
    expect(() =>
      resolveRemoteAttach({ rawArgs: ['--remote'], store, envRemote: undefined }),
    ).toThrow(/requires a bookmark/);
    cleanup();
  });

  test('MONAD_REMOTE env present → kind=env (legacy compat path)', () => {
    const { store, cleanup } = mkStore();
    const tok = store.saveToken('a', 'tokA');
    store.addRemote('a', { ...entry('a'), token_file: tok });
    const r = resolveRemoteAttach({
      rawArgs: [],
      store,
      envRemote: 'mbp.tailnet',
    });
    expect(r.kind).toBe('env');
    cleanup();
  });

  test('default bookmark wins when no flag + no env', () => {
    const { store, cleanup } = mkStore();
    const tok = store.saveToken('mbp', 'tokMBP');
    store.addRemote('mbp', { ...entry('mbp'), token_file: tok });
    const r = resolveRemoteAttach({
      rawArgs: [],
      store,
      envRemote: undefined,
    });
    expect(r.kind).toBe('remote');
    if (r.kind === 'remote') {
      expect(r.name).toBe('mbp');
      expect(r.token).toBe('tokMBP');
      expect(r.reason).toBe('default-bookmark');
    }
    cleanup();
  });

  test('no flag · no env · no bookmark → local with reason=no-default', () => {
    const { store, cleanup } = mkStore();
    const r = resolveRemoteAttach({
      rawArgs: [],
      store,
      envRemote: undefined,
    });
    expect(r.kind).toBe('local');
    if (r.kind === 'local') expect(r.reason).toBe('no-default');
    cleanup();
  });

  test('default bookmark with empty token file → token undefined', () => {
    const { store, cleanup } = mkStore();
    // Create an entry pointing to a non-existent token file path
    store.addRemote('mbp', { ...entry('mbp'), token_file: '/nonexistent/path' });
    const r = resolveRemoteAttach({
      rawArgs: [],
      store,
      envRemote: undefined,
    });
    expect(r.kind).toBe('remote');
    if (r.kind === 'remote') expect(r.token).toBeUndefined();
    cleanup();
  });
});
