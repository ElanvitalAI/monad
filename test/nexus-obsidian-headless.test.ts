// PLAN-ipad-notes-obsidian-typora §9 Phase O.S (2026-05-17) —
// Tests for the daemon-side obsidian-headless wrapper. We stub the `ob`
// CLI with shell scripts that print predictable output so the runner's
// state machine can be exercised without a real Obsidian Sync account.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObsidianHeadlessRunner } from '../src/nexus/sync/obsidian-headless';

let stagingDir = '';

beforeEach(() => {
  stagingDir = mkdtempSync(join(tmpdir(), 'monad-ob-test-'));
});

afterEach(() => {
  rmSync(stagingDir, { recursive: true, force: true });
});

function writeStubBinary(name: string, body: string): string {
  const path = join(stagingDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('ObsidianHeadlessRunner · cli detection', () => {
  test('which-resolved path → resolveCli returns the path', async () => {
    const fakeOb = writeStubBinary('ob', 'echo "fake"');
    const fakeWhich = writeStubBinary('which', `echo "${fakeOb}"`);
    const runner = new ObsidianHeadlessRunner({ whichBin: fakeWhich });
    const cli = await runner.resolveCli();
    expect(cli).toBe(fakeOb);
  });

  test('explicit obBin overrides which', async () => {
    const explicit = writeStubBinary('ob', 'true');
    const runner = new ObsidianHeadlessRunner({ obBin: explicit });
    expect(await runner.resolveCli()).toBe(explicit);
  });

  test('missing CLI → null + cli-not-installed status', async () => {
    const fakeWhich = writeStubBinary('which', 'exit 1');
    const runner = new ObsidianHeadlessRunner({ whichBin: fakeWhich });
    expect(await runner.resolveCli()).toBeNull();
    const status = await runner.getStatus();
    expect(status.state).toBe('cli-not-installed');
  });

  test('which lookup is cached', async () => {
    const fakeOb = writeStubBinary('ob', 'true');
    // First call uses our stub, second `whichBin` is broken — would fail
    // if cache didn't kick in.
    const fakeWhich = writeStubBinary('which', `echo "${fakeOb}"`);
    const runner = new ObsidianHeadlessRunner({ whichBin: fakeWhich });
    expect(await runner.resolveCli()).toBe(fakeOb);
    // Now point whichBin somewhere broken — should still return cached.
    (runner as unknown as { opts: { whichBin: string } }).opts.whichBin = '/nope';
    expect(await runner.resolveCli()).toBe(fakeOb);
  });
});

describe('ObsidianHeadlessRunner · syncOnce state machine', () => {
  test('success → idle + lastSyncAt populated', async () => {
    const fakeOb = writeStubBinary('ob', 'exit 0');
    const nowSeed = 1716_000_000_000;
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb, now: () => nowSeed });
    const status = await runner.syncOnce('/tmp/vault-x');
    expect(status.state).toBe('idle');
    expect(status.vaultPath).toBe('/tmp/vault-x');
    expect(status.lastSyncAt).toBe(new Date(nowSeed).toISOString());
  });

  test('non-zero exit → error + stderr captured', async () => {
    const fakeOb = writeStubBinary('ob', 'echo "vault corrupted" >&2; exit 2');
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb });
    const status = await runner.syncOnce('/tmp/vault-y');
    expect(status.state).toBe('error');
    expect(status.errorMessage).toContain('vault corrupted');
  });

  test('logged-out heuristic → logged-out state', async () => {
    const fakeOb = writeStubBinary('ob', 'echo "Not logged in. Please run \\`ob login\\`" >&2; exit 1');
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb });
    const status = await runner.syncOnce('/tmp/vault-z');
    expect(status.state).toBe('logged-out');
  });

  test('missing vault path → error · vault-path-required', async () => {
    const fakeOb = writeStubBinary('ob', 'exit 0');
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb });
    const status = await runner.syncOnce();
    expect(status.state).toBe('error');
    expect(status.errorMessage).toBe('vault-path-required');
  });

  test('configure() stashes vault path · subsequent syncOnce() uses it', async () => {
    const fakeOb = writeStubBinary('ob', 'exit 0');
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb });
    runner.configure('/tmp/vault-q');
    const status = await runner.syncOnce();
    expect(status.state).toBe('idle');
    expect(status.vaultPath).toBe('/tmp/vault-q');
  });

  test('CLI missing at sync time → cli-not-installed (no throw)', async () => {
    const fakeWhich = writeStubBinary('which', 'exit 1');
    const runner = new ObsidianHeadlessRunner({ whichBin: fakeWhich });
    const status = await runner.syncOnce('/tmp/v');
    expect(status.state).toBe('cli-not-installed');
  });

  test('concurrent syncOnce calls share the in-flight Promise', async () => {
    // Stub takes ~50ms — two parallel calls should resolve to the same
    // status (single underlying `ob sync` invocation).
    const fakeOb = writeStubBinary('ob', 'sleep 0.05; exit 0');
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb });
    const [a, b] = await Promise.all([
      runner.syncOnce('/tmp/v'),
      runner.syncOnce('/tmp/v'),
    ]);
    expect(a.state).toBe('idle');
    expect(b.state).toBe('idle');
    expect(a.lastSyncAt).toBe(b.lastSyncAt); // same in-flight result
  });
});

describe('ObsidianHeadlessRunner · status snapshot', () => {
  test('getStatus shows vault path even before sync', async () => {
    const fakeOb = writeStubBinary('ob', 'true');
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb });
    runner.configure('/tmp/conf-vault');
    const status = await runner.getStatus();
    expect(status.vaultPath).toBe('/tmp/conf-vault');
  });

  test('cliPath surfaced on healthy status', async () => {
    const fakeOb = writeStubBinary('ob', 'exit 0');
    const runner = new ObsidianHeadlessRunner({ obBin: fakeOb });
    const status = await runner.getStatus();
    expect(status.cliPath).toBe(fakeOb);
  });
});
