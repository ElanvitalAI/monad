import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { createSshPickerModal } from '../src/ssh/ssh-picker-modal.js';
import {
  _resetSshHostsForTesting,
  setSshHostsPathForTesting,
  type SshHost,
} from '../src/ssh/ssh-hosts.js';

const HOSTS: SshHost[] = [
  { name: 'mba', host: 'mba.local', description: 'MacBook Air' },
  { name: 'mbp', host: 'mbp.local', description: 'MacBook Pro' },
];

afterEach(() => {
  _resetSshHostsForTesting();
});

function withHosts(hosts: readonly SshHost[]): void {
  const dir = mkdtempSync(joinPath(tmpdir(), 'elanous-ssh-picker-'));
  const path = joinPath(dir, 'ssh-hosts.json');
  writeFileSync(path, JSON.stringify({ hosts }), 'utf-8');
  setSshHostsPathForTesting(path);
}

describe('createSshPickerModal', () => {
  test('small host lists skip filtering', () => {
    withHosts(HOSTS);
    const picker = createSshPickerModal({
      bounds: { row: 3, col: 2, width: 72, height: 10 },
      width: 72,
      onAccept: () => {},
      now: () => 1_700_000_000_000,
    });
    picker.type('m');
    picker.type('b');
    expect(picker.state().query).toBe('mb');
    expect(picker.state().items).toHaveLength(2);
  });
});
