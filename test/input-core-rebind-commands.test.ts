import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runRebindCommand,
  registerAction,
  addDefaultBinding,
  listAllBindings,
  __resetActionRegistryForTests,
  __resetBindingsForTests,
  __resetContextForTests,
} from '../src/input-core/index.js';

let tmpDir: string;

beforeEach(() => {
  __resetActionRegistryForTests();
  __resetBindingsForTests();
  __resetContextForTests();
  tmpDir = join(tmpdir(), `monad-rebind-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  __resetActionRegistryForTests();
  __resetBindingsForTests();
  __resetContextForTests();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('/rebind — list', () => {
  test('no bindings → muted empty message', () => {
    const r = runRebindCommand([]);
    expect(r.ok).toBe(true);
    expect(r.lines.some(l => l.text.includes('no bindings'))).toBe(true);
  });

  test('lists defaults + runtime with source labels', () => {
    registerAction({ id: 'x.one', handler: () => {} });
    addDefaultBinding({ matcher: 'ctrl+x', actionId: 'x.one' });
    runRebindCommand(['x.one', 'alt+x']);      // add runtime binding
    const r = runRebindCommand([]);
    expect(r.lines.some(l => l.text.includes('default'))).toBe(true);
    expect(r.lines.some(l => l.text.includes('runtime'))).toBe(true);
  });
});

describe('/rebind actions', () => {
  test('lists actions with description + reserved flag', () => {
    registerAction({ id: 'x.normal', handler: () => {}, description: 'plain action' });
    registerAction({ id: 'x.locked', handler: () => {}, reserved: true });
    const r = runRebindCommand(['actions']);
    expect(r.ok).toBe(true);
    expect(r.lines.some(l => l.text.includes('x.normal') && l.text.includes('plain action'))).toBe(true);
    expect(r.lines.some(l => l.text.includes('x.locked') && l.text.includes('[reserved]'))).toBe(true);
  });
});

describe('/rebind <actionId> show / add', () => {
  test('unknown action → warn', () => {
    const r = runRebindCommand(['no.such.action']);
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.tone).toBe('warn');
    expect(r.lines[0]!.text).toContain('NOT registered');
  });

  test('known action with no bindings → warn (still an error)', () => {
    registerAction({ id: 'x.empty', handler: () => {} });
    const r = runRebindCommand(['x.empty']);
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.text).toContain('no bindings');
  });

  test('add matchers → setRuntimeBinding', () => {
    registerAction({ id: 'x.target', handler: () => {} });
    const r = runRebindCommand(['x.target', 'alt+t', 'ctrl+alt+t']);
    expect(r.ok).toBe(true);
    expect(r.lines[0]!.tone).toBe('success');
    const all = listAllBindings().filter(b => b.source === 'runtime');
    expect(all).toHaveLength(2);
    expect(all.map(b => b.matcher).sort()).toEqual(['alt+t', 'ctrl+alt+t']);
  });

  test('add with --context scopes the binding', () => {
    registerAction({ id: 'x.scoped', handler: () => {} });
    runRebindCommand(['x.scoped', 'alt+s', '--context', 'input']);
    const b = listAllBindings().find(b => b.source === 'runtime' && b.matcher === 'alt+s');
    expect(b?.context).toBe('input');
  });

  test('reserved key rejected with violation message', () => {
    registerAction({ id: 'x.rogue', handler: () => {} });
    const r = runRebindCommand(['x.rogue', 'ctrl+c']);
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.tone).toBe('error');
    expect(r.lines[0]!.text).toContain('reserved');
  });
});

describe('/rebind reset', () => {
  test('clears runtime for action', () => {
    registerAction({ id: 'x.z', handler: () => {} });
    runRebindCommand(['x.z', 'alt+z']);
    expect(listAllBindings().some(b => b.source === 'runtime' && b.actionId === 'x.z')).toBe(true);
    const r = runRebindCommand(['reset', 'x.z']);
    expect(r.ok).toBe(true);
    expect(listAllBindings().some(b => b.source === 'runtime' && b.actionId === 'x.z')).toBe(false);
  });

  test('reset without actionId → usage warn', () => {
    const r = runRebindCommand(['reset']);
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.text).toContain('usage');
  });
});

describe('/rebind export + import (R7)', () => {
  test('export to path writes JSON with non-default bindings', () => {
    registerAction({ id: 'x.a', handler: () => {} });
    addDefaultBinding({ matcher: 'ctrl+a', actionId: 'x.a' });    // default — should NOT be exported
    runRebindCommand(['x.a', 'alt+a']);                            // runtime — exported
    const p = join(tmpDir, 'out.json');
    const r = runRebindCommand(['export', p]);
    expect(r.ok).toBe(true);
    const contents = JSON.parse(readFileSync(p, 'utf8'));
    expect(contents.version).toBe(1);
    expect(contents.bindings).toHaveLength(1);
    expect(contents.bindings[0].matcher).toBe('alt+a');
  });

  test('export without path prints JSON body in result lines', () => {
    registerAction({ id: 'x.b', handler: () => {} });
    runRebindCommand(['x.b', 'alt+b']);
    const r = runRebindCommand(['export']);
    expect(r.ok).toBe(true);
    expect(r.lines.some(l => l.text.includes('"version"'))).toBe(true);
    expect(r.lines.some(l => l.text.includes('"alt+b"'))).toBe(true);
  });

  test('import applies valid entries to runtime, skips reserved', () => {
    const p = join(tmpDir, 'in.json');
    writeFileSync(p, JSON.stringify({
      version: 1,
      bindings: [
        { matcher: 'alt+i', actionId: 'x.imported' },
        { matcher: 'ctrl+c', actionId: 'x.bad' },       // reserved → skip
      ],
    }));
    registerAction({ id: 'x.imported', handler: () => {} });
    registerAction({ id: 'x.bad', handler: () => {} });
    const r = runRebindCommand(['import', p]);
    expect(r.ok).toBe(false);    // one rejection → not all-ok
    expect(r.lines[0]!.text).toContain('imported 1 bindings, 1 rejected');
    expect(listAllBindings().some(b => b.source === 'runtime' && b.matcher === 'alt+i')).toBe(true);
  });

  test('import of version-mismatched file → error', () => {
    const p = join(tmpDir, 'v2.json');
    writeFileSync(p, JSON.stringify({ version: 2, bindings: [] }));
    const r = runRebindCommand(['import', p]);
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.text).toContain('version mismatch');
  });

  test('import of malformed JSON → error', () => {
    const p = join(tmpDir, 'bad.json');
    writeFileSync(p, '{ nope');
    const r = runRebindCommand(['import', p]);
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.text).toContain('malformed');
  });

  test('import without path → usage warn', () => {
    const r = runRebindCommand(['import']);
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.text).toContain('usage');
  });
});

describe('/rebind help', () => {
  test('help outcome lists all subcommands', () => {
    const r = runRebindCommand(['help']);
    expect(r.ok).toBe(true);
    const joined = r.lines.map(l => l.text).join(' ');
    expect(joined).toContain('list');
    expect(joined).toContain('reset');
    expect(joined).toContain('export');
    expect(joined).toContain('import');
  });
});
