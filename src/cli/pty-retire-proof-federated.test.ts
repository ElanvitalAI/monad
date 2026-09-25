import { describe, expect, test } from 'bun:test';
import { runPtyRetire, type PtyTakeoverCommandDeps } from './pty-takeover-cli.js';
import type { PtyManifestRow } from '../pty-shell/pty-manifest.js';

function row(overrides: Partial<PtyManifestRow> = {}): PtyManifestRow {
  return {
    id: 'pty_default', kind: 'pty', cmd: 'bun', ownerPid: 1234, ptyPid: 5678, instance: 'test', startedAt: 10,
    alive: true, exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 0, frame: '', frameAt: 0,
    runId: '', runIdSource: '', spaceId: '', sessionId: '', parentPtyId: '', parentPid: 0, parentKind: '', closedAt: 0, codeSha: '',
    outputBytesTotal: 0,
    ...overrides,
  };
}

function deps(roots: ReadonlyMap<string, readonly PtyManifestRow[]>): PtyTakeoverCommandDeps {
  return {
    getPty: () => undefined,
    requestPtyTakeover: () => false,
    requestRemote: async () => ({ status: 'unknown-pty' }),
    listManifestRows: () => roots.get('/local/manifest.db') ?? [],
    listManifestRowsAt: (dbPath) => roots.get(dbPath) ?? [],
    currentManifestDbPath: () => '/local/manifest.db',
    manifestTargets: () => [
      { name: 'local', dbPath: '/local/manifest.db' },
      { name: 'ghost-test-root', dbPath: '/ghost/manifest.db' },
      { name: 'other-root', dbPath: '/other/manifest.db' },
    ],
    isProcessAlive: () => false,
    now: () => 100_000,
    log: () => {},
  };
}

describe('runPtyRetire federated proof', () => {
  test('prints a foreign-root proof but refuses --yes without removing its manifest row', () => {
    const foreign = row({ id: 'ghost-only', ownerPid: 999, ptyPid: 999, updatedAt: 0 });
    const roots = new Map<string, readonly PtyManifestRow[]>([
      ['/local/manifest.db', []],
      ['/ghost/manifest.db', [foreign]],
      ['/other/manifest.db', []],
    ]);
    const commandDeps = deps(roots);

    const preview = runPtyRetire('ghost-only', commandDeps, false, false, { all: true });
    expect(preview).toMatchObject({ exitCode: 0 });
    expect(preview.message).toContain('pty retire: ghost-only dry-run');
    expect(preview.message).toContain('sourceRoot name=ghost-test-root dbPath=/ghost/manifest.db');
    expect(preview.message).toContain('ownership ownerPid=999');
    expect(preview.message).toContain('inactivity');
    expect(preview.message).toContain('liveness pid=999 alive=false');
    expect(preview.message).toContain('state alive=true');

    const refusal = runPtyRetire('ghost-only', commandDeps, true, false, { all: true });
    expect(refusal).toMatchObject({ exitCode: 1 });
    expect(refusal.message).toContain('removal from a different manifest root is not supported');
    expect(roots.get('/ghost/manifest.db')).toEqual([foreign]);
  });

  test('rejects duplicate references across roots and lists their roots', () => {
    const roots = new Map<string, readonly PtyManifestRow[]>([
      ['/local/manifest.db', []],
      ['/ghost/manifest.db', [row({ id: 'shared-name', ptyPid: 111 })]],
      ['/other/manifest.db', [row({ id: 'shared-name', ptyPid: 222 })]],
    ]);

    const result = runPtyRetire('shared-name', deps(roots), false, false, { all: true });
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.message).toContain('pty retire: shared-name is ambiguous');
    expect(result.message).toContain('shared-name (ghost-test-root)');
    expect(result.message).toContain('shared-name (other-root)');
  });
});
