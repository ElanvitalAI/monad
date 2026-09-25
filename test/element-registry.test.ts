import { describe, test, expect, beforeEach } from 'bun:test';
import {
  createElementRegistry,
  formatElementAddress,
  parseElementAddress,
  ensureQualified,
  isQualifiedAddress,
  type ElementHandle,
} from '../src/element-registry/index.js';

function handle(kind: ElementHandle['kind'], id: string): ElementHandle {
  return { kind, id };
}

describe('element-registry / address parser', () => {
  test('parses qualified addresses for every kind', () => {
    expect(parseElementAddress('win:3')).toMatchObject({ kind: 'window', id: '3' });
    expect(parseElementAddress('pane:a1b2c3')).toMatchObject({ kind: 'pane', id: 'a1b2c3' });
    expect(parseElementAddress('pty:pty_0abc1234')).toMatchObject({ kind: 'pty', id: 'pty_0abc1234' });
    expect(parseElementAddress('sess:codex-1')).toMatchObject({ kind: 'session', id: 'codex-1' });
    expect(parseElementAddress('job:nightly')).toMatchObject({ kind: 'job', id: 'nightly' });
    expect(parseElementAddress('plugin:foo')).toMatchObject({ kind: 'plugin', id: 'foo' });
    expect(parseElementAddress('tool:Bash')).toMatchObject({ kind: 'tool', id: 'Bash' });
  });

  test('keeps nested colons for widget addresses', () => {
    expect(parseElementAddress('widget:wd-log:2')).toMatchObject({ kind: 'widget', id: 'wd-log:2' });
  });

  test('accepts leading @', () => {
    expect(parseElementAddress('@pane:deadbeef')).toMatchObject({ kind: 'pane', id: 'deadbeef' });
  });

  test('rejects unknown prefixes and empty ids', () => {
    expect(parseElementAddress('foo:bar')).toBeNull();
    expect(parseElementAddress('win:')).toBeNull();
    expect(parseElementAddress('noColonAtAll')).toBeNull();
  });

  test('formatElementAddress roundtrips with parse', () => {
    const addr = formatElementAddress('window', '7');
    expect(addr).toBe('win:7');
    expect(parseElementAddress(addr)).toMatchObject({ kind: 'window', id: '7' });
  });

  test('isQualifiedAddress / ensureQualified', () => {
    expect(isQualifiedAddress('pty:x', 'pty')).toBe(true);
    expect(isQualifiedAddress('pty:x', 'window')).toBe(false);
    expect(isQualifiedAddress('x')).toBe(false);
    expect(ensureQualified('pty', 'pty_abc')).toBe('pty:pty_abc');
    expect(ensureQualified('pty', 'pty:pty_abc')).toBe('pty:pty_abc');
    expect(ensureQualified('pty', '@pty:pty_abc')).toBe('pty:pty_abc');
  });
});

describe('element-registry / registry', () => {
  let registry = createElementRegistry();

  beforeEach(() => {
    registry = createElementRegistry();
  });

  test('register + resolve by qualified address', () => {
    const h = handle('pty', 'pty_ab12');
    registry.register('pty', 'pty_ab12', h);
    expect(registry.resolve('pty:pty_ab12')).toBe(h);
    expect(registry.resolve('pty:pty_ab12', 'pty')).toBe(h);
    expect(registry.resolve('pty:pty_ab12', 'session')).toBeNull();
  });

  test('resolve by bare id scans all kinds', () => {
    const h1 = handle('window', '1');
    const h2 = handle('session', 'xyz');
    registry.register('window', '1', h1);
    registry.register('session', 'xyz', h2);
    expect(registry.resolve('xyz')).toBe(h2);
    expect(registry.resolve('1')).toBe(h1);
  });

  test('resolve with expectedKind disambiguates', () => {
    const hWin = handle('window', '42');
    const hJob = handle('job', '42');
    registry.register('window', '42', hWin);
    registry.register('job', '42', hJob);
    expect(registry.resolve('42', 'window')).toBe(hWin);
    expect(registry.resolve('42', 'job')).toBe(hJob);
  });

  test('unregister removes', () => {
    const h = handle('widget', 'wd-log:3');
    registry.register('widget', 'wd-log:3', h);
    expect(registry.has('widget', 'wd-log:3')).toBe(true);
    registry.unregister('widget', 'wd-log:3');
    expect(registry.has('widget', 'wd-log:3')).toBe(false);
    expect(registry.resolve('widget:wd-log:3')).toBeNull();
  });

  test('list + listAll + count', () => {
    registry.register('pty', 'a', handle('pty', 'a'));
    registry.register('pty', 'b', handle('pty', 'b'));
    registry.register('tool', 'Bash', handle('tool', 'Bash'));
    expect(registry.count('pty')).toBe(2);
    expect(registry.list('pty').map(e => e.addr).sort()).toEqual(['pty:a', 'pty:b']);
    expect(registry.listAll()).toHaveLength(3);
  });

  test('reset clears everything', () => {
    registry.register('pane', 'abc', handle('pane', 'abc'));
    registry.reset();
    expect(registry.listAll()).toEqual([]);
  });
});
