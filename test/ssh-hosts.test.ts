import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  DEFAULT_HOSTS,
  listSshHosts,
  findSshHost,
  touchSshHost,
  listSshHostsByRecency,
  setSshHostsPathForTesting,
  _resetSshHostsForTesting,
  setSshHostsForTesting,
  sshHostsWithRole,
  mediaSshHost,
} from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

beforeEach(() => {
  setSshHostsForTesting(TEST_FLEET);
});

afterEach(() => {
  _resetSshHostsForTesting();
  delete process.env.ELANOUS_MEDIA_HOST;
});

function withConfig(json: string): string {
  const dir = mkdtempSync(joinPath(tmpdir(), 'elanous-ssh-hosts-'));
  const path = joinPath(dir, 'ssh-hosts.json');
  writeFileSync(path, json, 'utf-8');
  setSshHostsPathForTesting(path);
  return path;
}

describe('DEFAULT_HOSTS', () => {
  // 2026-09-25: fleet 은 설정이다 — 코드에 누군가의 실제 기계를 박지 않는다.
  test('is empty — a new install reaches no one else\'s machines', () => {
    expect(DEFAULT_HOSTS).toEqual([]);
  });

  test('with no file and no test fleet the list is empty', () => {
    setSshHostsForTesting(null);
    const dir = mkdtempSync(joinPath(tmpdir(), 'elanous-ssh-none-'));
    setSshHostsPathForTesting(joinPath(dir, 'ssh-hosts.json'));
    expect(listSshHosts()).toEqual([]);
  });
});

describe('roles', () => {
  test('parses roles from JSON and filters by role', () => {
    withConfig(JSON.stringify({ hosts: [
      { name: 'a', host: 'a', roles: ['llm'] },
      { name: 'b', host: 'b.example', roles: ['media', 'llm', '', 3] },
      { name: 'c', host: 'c' },
    ] }));
    expect(sshHostsWithRole('llm').map(h => h.name)).toEqual(['a', 'b']);
    expect(listSshHosts()[1]!.roles).toEqual(['media', 'llm']);
    expect(listSshHosts()[2]!.roles).toBeUndefined();
    expect(mediaSshHost()).toBe('b.example');
  });

  test('ELANOUS_MEDIA_HOST wins; no media host is null', () => {
    withConfig(JSON.stringify({ hosts: [{ name: 'c', host: 'c' }] }));
    expect(mediaSshHost()).toBeNull();
    process.env.ELANOUS_MEDIA_HOST = 'studio';
    expect(mediaSshHost()).toBe('studio');
  });
});

describe('listSshHosts', () => {
  test('returns the fallback fleet when config file is absent', () => {
    const dir = mkdtempSync(joinPath(tmpdir(), 'elanous-ssh-empty-'));
    setSshHostsPathForTesting(joinPath(dir, 'ssh-hosts.json'));
    expect(listSshHosts()).toEqual([...TEST_FLEET]);
  });

  test('reads overrides from JSON', () => {
    withConfig(JSON.stringify({
      hosts: [
        { name: 'prod', host: 'prod.example.com', user: 'ops', description: 'Production' },
        { name: 'dev', host: 'dev.internal' },
      ],
    }));
    const hosts = listSshHosts();
    expect(hosts.length).toBe(2);
    expect(hosts[0]!.name).toBe('prod');
    expect(hosts[0]!.user).toBe('ops');
    expect(hosts[1]!.name).toBe('dev');
    expect(hosts[1]!.user).toBeUndefined();
  });

  test('falls back on malformed JSON', () => {
    withConfig('{ hosts: not-a-list }');
    expect(listSshHosts()).toEqual([...TEST_FLEET]);
  });

  test('falls back on empty hosts array', () => {
    withConfig(JSON.stringify({ hosts: [] }));
    expect(listSshHosts()).toEqual([...TEST_FLEET]);
  });

  test('ignores entries missing name or host', () => {
    withConfig(JSON.stringify({
      hosts: [
        { name: 'valid', host: 'valid.host' },
        { name: 'no-host' },
        { host: 'no-name.example.com' },
        { name: '', host: 'empty-name' },
      ],
    }));
    const hosts = listSshHosts();
    expect(hosts.length).toBe(1);
    expect(hosts[0]!.name).toBe('valid');
  });
});

describe('findSshHost', () => {
  test('case-insensitive match', () => {
    expect(findSshHost('MBA')?.name).toBe('mba');
    expect(findSshHost('  mbp  ')?.name).toBe('mbp');
  });

  test('returns null on unknown', () => {
    expect(findSshHost('ghost')).toBeNull();
  });
});

describe('touchSshHost + listSshHostsByRecency', () => {
  test('untouched returns configured order', () => {
    const ordered = listSshHostsByRecency();
    expect(ordered.map(h => h.name)).toEqual(['mba', 'node-b', 'mbp', 'minio', 'node-c']);
    expect(ordered.every(h => h.lastUsedAt === 0)).toBe(true);
  });

  test('most-recent floats to top', () => {
    touchSshHost('node-c', 1_000);
    touchSshHost('node-b', 2_000);
    const ordered = listSshHostsByRecency(3_000);
    expect(ordered[0]!.name).toBe('node-b');
    expect(ordered[1]!.name).toBe('node-c');
    expect(ordered[2]!.name).toBe('mba');   // first untouched
  });

  test('tie goes to configured order', () => {
    touchSshHost('node-c', 1_000);
    touchSshHost('node-b', 1_000);
    const ordered = listSshHostsByRecency(2_000);
    // node-b is configured before node-c, so with same lastUsedAt it wins.
    expect(ordered[0]!.name).toBe('node-b');
    expect(ordered[1]!.name).toBe('node-c');
  });
});
