import { afterEach, describe, expect, test } from 'bun:test';
import { mcpJoinReason, toWireToolName, toolSurface } from './index.js';
import { createMcpProxyRuntime, createMcpToolAuthorizer } from '../../mcp/proxy-runtime.js';
import {
  _resetToolRuntimeRegistryForTest,
  registerToolRuntime,
} from '../../tool-runtime/registry.js';
import { splitDeferredToolSpecs } from '../../session-runtime/tier-flip.js';
import type { ToolRuntime } from '../../tool-runtime/types.js';

const ctx = () => ({ cwd: process.cwd(), signal: new AbortController().signal });

afterEach(() => _resetToolRuntimeRegistryForTest());

function registerProxy(name: string, allowed: boolean, calls: string[]): string {
  const authorizer = createMcpToolAuthorizer();
  if (allowed) authorizer.grant({ serverId: 'remote', toolName: name });
  const runtime = createMcpProxyRuntime({
    serverId: 'remote',
    mcpTool: { name, description: `remote ${name}` },
    client: {
      callTool: async (toolName: string) => {
        calls.push(toolName);
        return { content: [{ type: 'text' as const, text: `ran:${toolName}` }] };
      },
    },
    authorizer,
  });
  registerToolRuntime(runtime);
  return runtime.spec.name;
}

function registerStaticNameCollision(name: string): void {
  const runtime: ToolRuntime = {
    id: `test-collision-${name}`,
    spec: { name, description: 'collides with a daemon static tool', parameters: { type: 'object' } },
    surfaces: ['mcp', 'tui'],
    run: async () => ({ output: 'must not replace static tool' }),
  };
  registerToolRuntime(runtime);
}

async function expectBridgeFor(kind: 'chat' | 'webterm'): Promise<void> {
  const calls: string[] = [];
  // ⛔⭐ The registry name is `remote.inspect`; the *wire* name is `remote__inspect`.
  //   Providers reject `.` in tool names (`^[a-zA-Z0-9_-]+$`) and the whole turn
  //   dies with a 400 — measured live on 2026-08-21. So everything the model sees
  //   or says uses the wire name, and only the dispatcher knows the registry one.
  const allowed = toWireToolName(registerProxy('inspect', true, calls));
  const denied = toWireToolName(registerProxy('private', false, calls));
  const surface = toolSurface(kind);

  expect(allowed).toBe('remote__inspect');
  expect(allowed).toMatch(/^[a-zA-Z0-9_-]+$/);
  expect(surface.specs.map((spec) => spec.name)).toContain(allowed);
  const split = splitDeferredToolSpecs(surface.specs);
  expect(split.active.map((spec) => spec.name)).not.toContain(allowed);
  expect(split.deferred.map((entry) => entry.name)).toContain(allowed);

  const search = await surface.dispatch(
    'ToolSearch',
    { query: `select:${allowed},${denied}` },
    ctx(),
  ) as { matched: string[]; unknown: string[] };
  expect(search.matched).toEqual([allowed, denied]);
  expect(search.unknown).toEqual([]);

  const result = await surface.dispatch(allowed, {}, ctx());
  expect(result).toMatchObject({ output: 'ran:inspect' });
  expect(calls).toEqual(['inspect']);

  const rejected = await surface.dispatch(denied, {}, ctx());
  expect(rejected).toMatchObject({ ok: false, classification: 'mcp-authorization-denied' });
  expect(calls).toEqual(['inspect']);
}

describe('daemon MCP registry bridge', () => {
  test('chat discovers deferred original names, dispatches them, and preserves authorization', async () => {
    await expectBridgeFor('chat');
  });

  test('webterm discovers deferred original names, dispatches them, and preserves authorization', async () => {
    await expectBridgeFor('webterm');
  });

  test('a surface built before the server connects still shows its tools', () => {
    // ⛔⭐ This is the live failure of 2026-08-20, encoded.
    //   The daemon builds its tool surface ~1s after boot; MCP clients connect
    //   *after* that, and a request reuses the boot surface. The first cut
    //   froze the list at construction, so `higgsfield.*` was never visible in
    //   chat even though 73 tools were registered — and the original test here
    //   asserted `not.toContain`, which ***pinned that bug in place***.
    //   ⇒ The list must be read from the registry when it is *read*, not built.
    const calls: string[] = [];
    const before = toolSurface('chat');
    const remoteName = toWireToolName(registerProxy('later', true, calls));
    expect(before.specs.map((spec) => spec.name)).toContain(remoteName);
  });

  test('a tool registered after construction is dispatchable through that same surface', async () => {
    const calls: string[] = [];
    const before = toolSurface('chat');
    const remoteName = toWireToolName(registerProxy('late-dispatch', true, calls));
    await before.dispatch(remoteName, {}, {} as never);
    // `calls` records what reached the remote server — the bare tool name.
    // The prefix is ours and never goes on the wire.
    expect(calls).toEqual(['late-dispatch']);
  });

  test('refreshes registry candidates and preserves a real static-name collision', () => {
    const calls: string[] = [];
    const remoteName = toWireToolName(registerProxy('later', true, calls));
    expect(toolSurface('chat').specs.map((spec) => spec.name)).toContain(remoteName);

    _resetToolRuntimeRegistryForTest();
    expect(toolSurface('chat').specs.map((spec) => spec.name)).not.toContain(remoteName);

    registerStaticNameCollision('Read');
    const collisionSurface = toolSurface('webterm');
    expect(collisionSurface.specs.filter((spec) => spec.name === 'Read')).toHaveLength(1);
    expect(splitDeferredToolSpecs(collisionSurface.specs).active.map((spec) => spec.name)).toContain('Read');
  });

  test('empty registry retains static readonly and chat catalogs', () => {
    expect(toolSurface('readonly').specs.map((spec) => spec.name)).toEqual([
      'Read', 'Grep', 'WebSearch', 'Plan', 'MarkStepDone',
    ]);
    const names = toolSurface('chat').specs.map((spec) => spec.name);
    expect(names).toContain('Read');
    expect(names).toContain('Bash');
  });
});

/** ⛔ 🅢 가 리뷰에서 요구한 칸(2026-08-20): 「비었다」만 남기면 셋을 못 가린다.
 *  ⚠️ 이 시험이 없을 때 반증해 보니 «안 깨졌다» — 즉 그 3분기는 주장뿐이었다. */
describe('why the join produced nothing', () => {
  test('joined when anything survived the static filter', () => {
    expect(mcpJoinReason({ tuiCount: 9, mcpCount: 3, joinedCount: 1 })).toBe('joined');
  });

  test('registry-empty when nothing is registered at all — wiring dead or still booting', () => {
    expect(mcpJoinReason({ tuiCount: 0, mcpCount: 0, joinedCount: 0 })).toBe('registry-empty');
  });

  test('no-mcp-runtimes when tools exist but none declares mcp — the peer has not connected', () => {
    expect(mcpJoinReason({ tuiCount: 9, mcpCount: 0, joinedCount: 0 })).toBe('no-mcp-runtimes');
  });

  test('all-static when mcp runtimes exist but every name collides with a static tool', () => {
    expect(mcpJoinReason({ tuiCount: 9, mcpCount: 3, joinedCount: 0 })).toBe('all-static');
  });

  test('the three zeros are distinct values — a boolean cannot carry them', () => {
    const zeros = [
      mcpJoinReason({ tuiCount: 0, mcpCount: 0, joinedCount: 0 }),
      mcpJoinReason({ tuiCount: 9, mcpCount: 0, joinedCount: 0 }),
      mcpJoinReason({ tuiCount: 9, mcpCount: 3, joinedCount: 0 }),
    ];
    expect(new Set(zeros).size).toBe(3);
  });
});

/** ⛔ 2026-08-21 실물에서 «턴 전체를 죽인» 결함의 회귀.
 *  `Codex API 400: Invalid 'tools[69].name' ... pattern '^[a-zA-Z0-9_-]+$'` */
describe('names that can actually go on the wire', () => {
  test('the dot becomes the delimiter the providers accept', () => {
    expect(toWireToolName('higgsfield.balance')).toBe('higgsfield__balance');
  });

  test('every wire name matches the provider pattern', () => {
    for (const n of ['higgsfield.generate_image', 'xcodebuild.session_set_defaults', 'plain']) {
      expect(toWireToolName(n)).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  test('a name with no server prefix is unchanged', () => {
    expect(toWireToolName('Read')).toBe('Read');
  });

  test('two servers with the same tool stay distinct', () => {
    expect(toWireToolName('a.run')).not.toBe(toWireToolName('b.run'));
  });
});
