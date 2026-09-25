import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  listTransferTargets,
  findTransferTarget,
  setTransferTargetsPathForTesting,
  _resetTransferTargetsForTesting,
} from '../src/transfer/transfer-targets.js';
import { setSshHostsPathForTesting, _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

beforeEach(() => {
  setSshHostsForTesting(TEST_FLEET);
});

afterEach(() => {
  _resetTransferTargetsForTesting();
  _resetSshHostsForTesting();
});

function withTransferConfig(json: string): string {
  const dir = mkdtempSync(joinPath(tmpdir(), 'monad-xfer-'));
  const path = joinPath(dir, 'transfer-targets.json');
  writeFileSync(path, json, 'utf-8');
  setTransferTargetsPathForTesting(path);
  return path;
}

describe('listTransferTargets', () => {
  test('defaults: one entry per SSH host + iPhone', () => {
    const targets = listTransferTargets();
    const kinds = targets.map(t => t.kind);
    expect(kinds.filter(k => k === 'ssh').length).toBeGreaterThanOrEqual(5);
    expect(kinds).toContain('iphone');
  });

  test('defaults: SSH targets point at ~/Downloads/', () => {
    const targets = listTransferTargets();
    const sshTargets = targets.filter(t => t.kind === 'ssh');
    for (const t of sshTargets) {
      if (t.kind === 'ssh') expect(t.remoteDir).toBe('~/Downloads/');
    }
  });

  test('override file replaces defaults', () => {
    withTransferConfig(JSON.stringify({
      targets: [
        { kind: 'ssh', name: 'backup', host: 'mba', remoteDir: '~/Transfers/' },
        { kind: 'iphone', name: 'work phone', pushcutName: 'monad-work' },
      ],
    }));
    const targets = listTransferTargets();
    expect(targets.length).toBe(2);
    expect(targets[0]!.name).toBe('backup');
    if (targets[0]!.kind === 'ssh') {
      expect(targets[0]!.remoteDir).toBe('~/Transfers/');
      expect(targets[0]!.host.name).toBe('mba');
    }
  });

  test('override: unknown host entries are skipped', () => {
    withTransferConfig(JSON.stringify({
      targets: [
        { kind: 'ssh', name: 'good', host: 'mba', remoteDir: '~/ok/' },
        { kind: 'ssh', name: 'ghost', host: 'noexist', remoteDir: '~/x/' },
      ],
    }));
    const targets = listTransferTargets();
    expect(targets.length).toBe(1);
    expect(targets[0]!.name).toBe('good');
  });

  test('iPhone entry without tailscaleHost AND pushcutName is skipped', () => {
    withTransferConfig(JSON.stringify({
      targets: [
        { kind: 'iphone', name: 'empty' },
        { kind: 'iphone', name: 'via-pushcut', pushcutName: 'n' },
        { kind: 'iphone', name: 'via-tailscale', tailscaleHost: 'h' },
      ],
    }));
    const targets = listTransferTargets();
    expect(targets.map(t => t.name)).toEqual(['via-pushcut', 'via-tailscale']);
  });

  test('falls back to defaults on malformed JSON', () => {
    withTransferConfig('not json');
    const targets = listTransferTargets();
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some(t => t.kind === 'iphone')).toBe(true);
  });
});

describe('findTransferTarget', () => {
  test('case-insensitive lookup', () => {
    const t = findTransferTarget('MBA');
    expect(t?.kind).toBe('ssh');
  });

  test('returns null on unknown', () => {
    expect(findTransferTarget('__missing__')).toBeNull();
  });
});
