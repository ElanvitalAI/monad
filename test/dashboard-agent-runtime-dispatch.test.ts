import { afterEach, describe, expect, test } from 'bun:test';

import { debug } from '../src/debug/log.js';
import { recordDashboardToolCatalog } from '../src/dashboard/tool-catalog-observability.js';
import {
  dispatchSessionRuntimeTool,
  resolveDynamicSessionNativeToolSpecs,
  resolveSessionSurfaceProfile,
} from '../src/session-runtime/index.js';
import {
  _resetToolRuntimeRegistryForTest,
  dispatchToolByName,
  getToolRuntime,
  registerAllDefaultToolRuntimes,
} from '../src/tool-runtime/index.js';

const names = ['Agent', 'AgentOutput', 'AgentReply', 'AgentStop', 'AgentList'] as const;

function agentSpecs(): ReturnType<typeof resolveDynamicSessionNativeToolSpecs> {
  const surface = resolveSessionSurfaceProfile({ preferredSurfaceId: 'coding/turn' });
  return resolveDynamicSessionNativeToolSpecs({
    userText: '',
    defaultFamilyIds: surface.defaultNativeFamilyIds,
    surfaceId: surface.id,
  });
}

afterEach(() => {
  _resetToolRuntimeRegistryForTest();
});

describe('dashboard Agent runtime dispatch', () => {
  test('records exactly five Agent tools in the coding TUI catalog and dispatches each through its registered run() wrapper', async () => {
    registerAllDefaultToolRuntimes();
    const specs = agentSpecs();
    const agentNames = specs.map((spec) => spec.name).filter((name) => name.startsWith('Agent'));
    const records: Array<{ category: string; event: string; data: { tools: string[] } }> = [];
    const previousDiag = debug.enabled;
    debug.setDiagEnabled(true);
    const off = debug.registerSink({
      name: 'dashboard-agent-runtime-dispatch-test',
      emit: (record) => records.push({
        category: record.category,
        event: record.event,
        data: record.data as { tools: string[] },
      }),
    });

    try {
      recordDashboardToolCatalog('tui-agent-runtime-dispatch', specs);
    } finally {
      off?.();
      debug.setDiagEnabled(previousDiag);
    }

    expect(agentNames).toEqual([...names]);
    expect(records).toEqual([expect.objectContaining({
      category: 'capability.resolve',
      event: 'tool-catalog-assembled',
      data: expect.objectContaining({
        surface: 'tui-dashboard',
        assembler: 'buildSessionRuntimeToolSpecs',
        tools: expect.arrayContaining([...names]),
      }),
    })]);

    // ⛔ Record AFTER the runtime returns, and do NOT swallow exceptions.
    //
    //  Recording before the call and catching everything into `{ error }` makes
    //  this a Goodhart test: it passes even when `run()` is never reached or
    //  throws immediately, which is exactly the failure the goal asks us to rule
    //  out (`dispatch` is optional, so "spec exposed but calling it fails" is a
    //  real shape). `toBeDefined()` on a swallowed error object is not evidence.
    //  ⛔ Prove arrival with a spy on the registry's own `run()`, not by pattern-
    //     matching the error text. String matching cannot distinguish the tool's
    //     own validation ("Agent: description is required") from an infrastructure
    //     failure that merely happens to name it ("No runtime for Agent") — and
    //     the second one means the wiring is BROKEN while the test goes green.
    const ran: string[] = [];
    const seenCtx: Array<Record<string, unknown>> = [];
    for (const name of names) {
      const rt = getToolRuntime(name);
      expect(rt?.spec.name).toBe(name);
      const originalRun = rt!.run.bind(rt);
      // Spy stays installed only for this tool's dispatch; the registry is reset
      // wholesale in afterEach, so no cross-test leakage.
      (rt as { run: unknown }).run = async (req: never, ctx: never) => {
        ran.push(name);
        seenCtx.push((ctx ?? {}) as Record<string, unknown>);
        return await originalRun(req, ctx);
      };

      await dispatchSessionRuntimeTool(name, {}, {
        getToolRuntime: (candidate) => getToolRuntime(candidate) as any,
        dispatchToolRuntime: async (candidate, args) => {
          try {
            return await dispatchToolByName(candidate, args, {
              surface: 'dashboard',
              // Stand-in for what dashboard/index.ts injects in production. The
              // assertion below checks the runtime actually RECEIVES it, which is
              // acceptance criterion 4 (a sub-agent with zero tools is useless).
              agentHostTools: [{ name: 'Read' }] as never,
              agentDispatchTool: async () => ({ ok: true }),
            } as never);
          } catch (error) {
            // Swallowing here is safe now: `ran` (not the message) is the evidence.
            return { error: error instanceof Error ? error.message : String(error) };
          }
        },
        dispatchPluginTool: async () => ({ ok: false, error: 'unexpected plugin fallback' }),
      });
    }

    // Each tool's registered run() was actually entered — infrastructure errors
    // would leave `ran` short regardless of what the error text says.
    expect(ran).toEqual([...names]);
    // …and the Agent-family context survived the trip to the runtime.
    //
    // ⚠️ Read this assertion for exactly what it is: the context WE injected above
    //    reached run() intact, i.e. the session-runtime → registry hop does not
    //    drop it. It does NOT prove dashboard/index.ts injects it in production —
    //    this test never boots the ACP dashboard. That half is verified live
    //    (spawn a sub-agent from a real TUI and confirm it has tools). Recording
    //    the gap because a reader who assumes otherwise will trust a guarantee
    //    that isn't here.
    expect(seenCtx.every((c) => Array.isArray(c.agentHostTools) && typeof c.agentDispatchTool === 'function'))
      .toBe(true);
  });

  test('each Agent catalog rule has a direct native dispatch instead of plugin fallback', async () => {
    const calls: string[] = [];
    for (const name of names) {
      const result = await dispatchSessionRuntimeTool(name, {}, {
        getToolRuntime: () => undefined,
        dispatchToolRuntime: async () => ({ error: 'unexpected runtime dispatch' }),
        dispatchNativeTool: async (candidate) => {
          calls.push(candidate);
          return { output: candidate };
        },
        dispatchPluginTool: async () => ({ ok: false, error: 'unexpected plugin fallback' }),
      });
      expect(result).toEqual({ output: name });
    }
    expect(calls).toEqual([...names]);
  });

  // ⛔ Regression guard for the runtime-preference branch.
  //
  //  `getToolRuntime` resolves aliases through the native catalog, so Read/Edit/
  //  Write DO resolve to the registered `read`/`edit`/`write` runtimes. A branch
  //  that prefers "any registered runtime" therefore captures the fs tools too
  //  and routes them around `SessionNativeToolRule.dispatch` — which is the only
  //  path that carries `pathPolicy`, the Phase-4b surface-trust policy (remote
  //  messengers = strict: credential deny-list + cwd anchor).
  //
  //  Deleting `preferRuntime` from the fs-vs-agent branch makes this test fail
  //  with dispatchToolRuntime capturing Read/Edit/Write. That is the failure we
  //  want loud: a silent one is a security regression.
  test('fs tools keep the pathPolicy-carrying native dispatch even though runtimes exist for them', async () => {
    registerAllDefaultToolRuntimes();

    // Precondition: the aliases really do resolve to runtimes. Without this the
    // test could pass for the wrong reason (nothing registered → nothing to steal).
    for (const fsTool of ['Read', 'Edit', 'Write'] as const) {
      expect(getToolRuntime(fsTool)).toBeDefined();
    }

    const nativeCalls: string[] = [];
    const runtimeCalls: string[] = [];
    for (const fsTool of ['Read', 'Edit', 'Write'] as const) {
      await dispatchSessionRuntimeTool(fsTool, {}, {
        getToolRuntime: (candidate) => getToolRuntime(candidate) as any,
        dispatchToolRuntime: async (candidate) => {
          runtimeCalls.push(candidate);
          return { error: 'runtime path drops pathPolicy' };
        },
        dispatchNativeTool: async (candidate) => {
          nativeCalls.push(candidate);
          return { output: candidate };
        },
        dispatchPluginTool: async () => ({ ok: false, error: 'unexpected plugin fallback' }),
      });
    }

    expect(runtimeCalls).toEqual([]);
    expect(nativeCalls).toEqual(['Read', 'Edit', 'Write']);
  });
});
