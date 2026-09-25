import { beforeEach, describe, expect, test } from 'bun:test';

import {
  nexusConfigGet,
  nexusConfigList,
  nexusConfigSet,
  nexusConfigUnset,
} from '../src/cli/nexus-config';
import {
  USER_CONFIG_VERSION,
  type UserConfig,
} from '../src/nexus/config/types';

interface CapturedOut {
  log: (s: string) => void;
  error: (s: string) => void;
  logs: string[];
  errors: string[];
}

function makeOut(): CapturedOut {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    log: (s) => logs.push(s),
    error: (s) => errors.push(s),
    logs,
    errors,
  };
}

let store: UserConfig;

function read(): UserConfig {
  return JSON.parse(JSON.stringify(store)) as UserConfig;
}

function patch(mutate: (cfg: UserConfig) => void): void {
  const next = read();
  mutate(next);
  store = next;
}

beforeEach(() => {
  store = { version: USER_CONFIG_VERSION, global: {}, tabs: {} };
});

describe('nexusConfigList', () => {
  test('emits the full UserConfig as pretty JSON', () => {
    store.global = { tools: 'webterm' };
    const out = makeOut();
    const r = nexusConfigList({ readFn: read, out });
    expect(r.exitCode).toBe(0);
    expect(out.logs).toHaveLength(1);
    const parsed = JSON.parse(out.logs[0]) as UserConfig;
    expect(parsed.version).toBe(USER_CONFIG_VERSION);
    expect(parsed.global.tools).toBe('webterm');
  });
});

describe('nexusConfigGet', () => {
  test('returns the stored value at a nested path', () => {
    store.global = { debug: { enabled: true } };
    const out = makeOut();
    const r = nexusConfigGet('global.debug.enabled', { readFn: read, out });
    expect(r.exitCode).toBe(0);
    expect(out.logs).toContain('true');
  });

  test('returns plain string verbatim', () => {
    store.global = { tools: 'webterm' };
    const out = makeOut();
    const r = nexusConfigGet('global.tools', { readFn: read, out });
    expect(r.exitCode).toBe(0);
    expect(out.logs).toContain('webterm');
  });

  test('missing path returns exit 1 with a hint', () => {
    const out = makeOut();
    const r = nexusConfigGet('global.tools', { readFn: read, out });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('not set'))).toBe(true);
  });

  test('rejects malformed paths', () => {
    const out = makeOut();
    expect(nexusConfigGet('', { readFn: read, out }).exitCode).toBe(1);
    expect(nexusConfigGet('global', { readFn: read, out }).exitCode).toBe(1);
    expect(nexusConfigGet('foo.bar', { readFn: read, out }).exitCode).toBe(1);
    expect(nexusConfigGet('tabs.', { readFn: read, out }).exitCode).toBe(1);
    expect(out.errors.length).toBe(4);
    expect(out.errors.every((e) => e.includes('invalid path'))).toBe(true);
  });
});

describe('nexusConfigSet', () => {
  test('stores a string value at the path', () => {
    const out = makeOut();
    const r = nexusConfigSet('global.tools', 'webterm', {
      patchFn: patch,
      out,
    });
    expect(r.exitCode).toBe(0);
    expect(store.global.tools).toBe('webterm');
    expect(out.logs.some((l) => l.includes('set global.tools'))).toBe(true);
  });

  test('parses booleans and numbers via JSON', () => {
    const out = makeOut();
    nexusConfigSet('global.debug.enabled', 'true', { patchFn: patch, out });
    expect(store.global.debug?.enabled).toBe(true);
    nexusConfigSet('tabs.daemon:1.httpPort', '31416', { patchFn: patch, out });
    expect(store.tabs['daemon:1']?.httpPort).toBe(31416);
  });

  test('parses JSON objects', () => {
    const out = makeOut();
    nexusConfigSet('global.debug', '{"enabled":true,"keymap":false}', {
      patchFn: patch,
      out,
    });
    expect(store.global.debug).toEqual({ enabled: true, keymap: false });
  });

  test('plain strings without quotes still land verbatim', () => {
    const out = makeOut();
    nexusConfigSet('global.tools', 'webterm', { patchFn: patch, out });
    expect(store.global.tools).toBe('webterm');
  });

  test('rejects malformed paths', () => {
    const out = makeOut();
    const r = nexusConfigSet('foo', 'bar', { patchFn: patch, out });
    expect(r.exitCode).toBe(1);
    expect(out.errors[0]).toContain('invalid path');
  });
});

describe('nexusConfigUnset', () => {
  test('removes a leaf value', () => {
    store.global = { tools: 'webterm' };
    const out = makeOut();
    const r = nexusConfigUnset('global.tools', {
      patchFn: patch,
      out,
    });
    expect(r.exitCode).toBe(0);
    expect(store.global.tools).toBeUndefined();
    expect(out.logs.some((l) => l.includes('unset global.tools'))).toBe(true);
  });

  test('is a no-op for missing paths', () => {
    const out = makeOut();
    const r = nexusConfigUnset('global.tools', {
      patchFn: patch,
      out,
    });
    expect(r.exitCode).toBe(0);
    expect(store.global.tools).toBeUndefined();
  });

  test('removes the entire tab when path is tabs.<id>', () => {
    store.tabs = { 'daemon:1': { httpPort: 31416 } };
    const out = makeOut();
    nexusConfigUnset('tabs.daemon:1', { patchFn: patch, out });
    expect(store.tabs['daemon:1']).toBeUndefined();
  });

  test('rejects malformed paths', () => {
    const out = makeOut();
    const r = nexusConfigUnset('foo', { patchFn: patch, out });
    expect(r.exitCode).toBe(1);
    expect(out.errors[0]).toContain('invalid path');
  });
});
