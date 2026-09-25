import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { buildSetToolHintTool, dispatchSetToolHint } from '../src/skills/tools/set-hint.js';
import {
  listHints,
  resetScope,
  setConfigPathForTesting,
  _reloadForTesting,
} from '../src/tool-hints/registry.js';

let tmp: string;

beforeEach(() => {
  tmp = joinPath(tmpdir(), `mh-sth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  setConfigPathForTesting(joinPath(tmp, 'hints.json'));
  process.env.HINTS_PROJECT_CWD = joinPath(tmp, 'fake-project');
  _reloadForTesting();
});

afterEach(() => {
  resetScope('all');
  resetScope('global');
  setConfigPathForTesting(null);
  delete process.env.HINTS_PROJECT_CWD;
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('buildSetToolHintTool', () => {
  test('exposes required schema fields + defaults', () => {
    const spec = buildSetToolHintTool();
    expect(spec.name).toBe('SetToolHint');
    expect(spec.parameters.required).toEqual(['kind', 'tool']);
    const props = spec.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.kind.enum).toContain('prefer');
    expect(props.kind.enum).toContain('param-default');
    expect(props.scope.enum).toEqual(['turn', 'session']);
  });
});

describe('dispatchSetToolHint — happy path', () => {
  test('basic prefer hint lands in turn scope', async () => {
    const res = await dispatchSetToolHint({ kind: 'prefer', tool: 'web_search' });
    expect(res.output).toContain('hint set: prefer web_search');
    expect(res.output).toContain('scope=turn');
    const hints = listHints('turn');
    expect(hints.length).toBe(1);
    expect(hints[0].tool).toBe('web_search');
    expect(hints[0].kind).toBe('prefer');
    expect(hints[0].sourceSignal).toBe('llm');
  });

  test('session scope is accepted', async () => {
    await dispatchSetToolHint({ kind: 'avoid', tool: 'bash', scope: 'session' });
    expect(listHints('session').length).toBe(1);
  });

  test('param-default requires args', async () => {
    await expect(dispatchSetToolHint({ kind: 'param-default', tool: 'api_call' })).rejects.toThrow(/args/i);
    const res = await dispatchSetToolHint({
      kind: 'param-default', tool: 'api_call', args: { timeout_ms: 5000 },
    });
    expect(res.output).toContain('hint set: param-default');
    const hints = listHints('turn');
    expect(hints[0].payload).toEqual({ args: { timeout_ms: 5000 } });
  });

  test('ttl_seconds sets expiresAt', async () => {
    const before = Date.now();
    await dispatchSetToolHint({ kind: 'prefer', tool: 'x', ttl_seconds: 300 });
    const h = listHints('turn')[0];
    expect(h.expiresAt).toBeDefined();
    expect(h.expiresAt!).toBeGreaterThan(before);
    expect(h.expiresAt!).toBeLessThanOrEqual(before + 300_001 + 100);
  });

  test('uses_left stored on the hint', async () => {
    await dispatchSetToolHint({ kind: 'prefer', tool: 'x', uses_left: 3 });
    expect(listHints('turn')[0].usesLeft).toBe(3);
  });

  test('reason echoed in output and stored', async () => {
    const res = await dispatchSetToolHint({ kind: 'prefer', tool: 'x', reason: 'user asked' });
    expect(res.output).toContain('reason="user asked"');
    expect(listHints('turn')[0].reason).toBe('user asked');
  });
});

describe('dispatchSetToolHint — validation', () => {
  test('invalid kind rejected', async () => {
    await expect(dispatchSetToolHint({ kind: 'nuke', tool: 'x' })).rejects.toThrow(/invalid 'kind'/);
  });

  test('missing tool rejected', async () => {
    await expect(dispatchSetToolHint({ kind: 'prefer' })).rejects.toThrow(/tool/);
  });

  test('project + global scopes rejected (user-only via /hint)', async () => {
    await expect(dispatchSetToolHint({ kind: 'prefer', tool: 'x', scope: 'project' })).rejects.toThrow(/scope/);
    await expect(dispatchSetToolHint({ kind: 'prefer', tool: 'x', scope: 'global' })).rejects.toThrow(/scope/);
  });

  test('non-integer uses_left rejected', async () => {
    await expect(dispatchSetToolHint({ kind: 'prefer', tool: 'x', uses_left: 2.5 })).rejects.toThrow(/uses_left/);
    await expect(dispatchSetToolHint({ kind: 'prefer', tool: 'x', uses_left: -1 })).rejects.toThrow(/uses_left/);
    await expect(dispatchSetToolHint({ kind: 'prefer', tool: 'x', uses_left: 0 })).rejects.toThrow(/uses_left/);
  });

  test('zero or negative ttl_seconds rejected', async () => {
    await expect(dispatchSetToolHint({ kind: 'prefer', tool: 'x', ttl_seconds: 0 })).rejects.toThrow(/ttl_seconds/);
    await expect(dispatchSetToolHint({ kind: 'prefer', tool: 'x', ttl_seconds: -5 })).rejects.toThrow(/ttl_seconds/);
  });

  test('non-object args rejected', async () => {
    await expect(dispatchSetToolHint({ kind: 'param-default', tool: 'x', args: 'bogus' })).rejects.toThrow(/args/);
    await expect(dispatchSetToolHint({ kind: 'param-default', tool: 'x', args: [] })).rejects.toThrow(/args/);
  });
});

describe('catalog registration', () => {
  test('set_tool_hint carries minTier=T2', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    const entry = nativeToolCatalog.find(t => t.id === 'set_tool_hint');
    expect(entry).toBeDefined();
    expect(entry!.minTier).toBe('T2');
    expect(entry!.aliases).toContain('SetToolHint');
  });
});
