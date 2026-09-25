// ── PX-5 P4: Turn hooks + LLM tools ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouteRegistry } from '../src/plugin-routes/registry';
import { buildRouteTurnHook } from '../src/plugin-routes/turn-hook';
import {
  dispatchRouteList,
  dispatchRouteResolve,
  dispatchRouteSuggest,
  dispatchAgentsMdRead,
  buildRouteListTool,
  buildRouteResolveTool,
  buildRouteSuggestTool,
  buildAgentsMdReadTool,
} from '../src/plugin-routes/llm-tools';
import type { LLMMessage } from '../src/llm';

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'routes-p4-'));
}

function makeCtx() {
  return {
    pluginId: 'test',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    abortSignal: new AbortController().signal,
  };
}

function makeSampleRegistry(): RouteRegistry {
  const reg = new RouteRegistry({ warnOnConflict: false });
  reg.register('agent-team', {
    id: 'explore', aliases: ['search', 'find'],
    target: { kind: 'agent', id: 'explore' },
    description: 'Fast code scout',
  });
  reg.register('custom', {
    id: 'ralph',
    target: { kind: 'workflow', id: 'ralph-loop' }, precedence: 50,
  });
  return reg;
}

describe('PX-5 P4 — route Turn hook', () => {
  test('skips when turnNumber !== 1', async () => {
    const reg = makeSampleRegistry();
    const hook = buildRouteTurnHook({ registry: reg });
    const out = await hook.invoke({
      turnNumber: 2, messages: [{ role: 'user', content: 'explore' }], systemPrompt: '', tools: [],
    }, makeCtx());
    expect(out).toEqual({});
  });

  test('emits banner on keyword match (turn 1)', async () => {
    const reg = makeSampleRegistry();
    const hook = buildRouteTurnHook({ registry: reg });
    const out = await hook.invoke({
      turnNumber: 1, messages: [{ role: 'user', content: 'please explore the module' }],
      systemPrompt: '', tools: [],
    }, makeCtx());
    expect(out.systemPromptInject).toContain('Suggested routes');
    expect(out.systemPromptInject).toContain('$explore');
  });

  test('explicit $name appears separately from suggestions', async () => {
    const reg = makeSampleRegistry();
    const hook = buildRouteTurnHook({ registry: reg });
    const out = await hook.invoke({
      turnNumber: 1, messages: [{ role: 'user', content: '$plan make me a plan' }],
      systemPrompt: '', tools: [],
    }, makeCtx());
    // "plan" isn't registered, but the hook should still emit the
    // explicit notice.
    expect(out.systemPromptInject).toContain('Explicit invocation');
  });

  test('empty text + no match → {} (no inject)', async () => {
    const reg = makeSampleRegistry();
    const hook = buildRouteTurnHook({ registry: reg });
    const out = await hook.invoke({
      turnNumber: 1, messages: [{ role: 'user', content: 'unrelated text here' }],
      systemPrompt: '', tools: [],
    }, makeCtx());
    expect(out).toEqual({});
  });

  test('unwraps multi-block user content (content: [{type:text,...}])', async () => {
    const reg = makeSampleRegistry();
    const hook = buildRouteTurnHook({ registry: reg });
    const msg: LLMMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'please explore something' } as any,
      ] as any,
    };
    const out = await hook.invoke({
      turnNumber: 1, messages: [msg], systemPrompt: '', tools: [],
    }, makeCtx());
    expect(out.systemPromptInject).toContain('$explore');
  });
});

describe('PX-5 P4 — LLM tools', () => {
  test('RouteList enumerates + filters by kind', () => {
    const reg = makeSampleRegistry();
    const result = dispatchRouteList({}, { registry: reg });
    expect(result.routes.length).toBe(2);
    const filtered = dispatchRouteList({ kind: 'workflow' }, { registry: reg });
    expect(filtered.routes.map(r => r.id)).toEqual(['ralph']);
  });

  test('RouteResolve reports explicit + keyword matches', () => {
    const reg = makeSampleRegistry();
    const r = dispatchRouteResolve({ text: '$explore scan src' }, { registry: reg });
    expect(r.explicit?.routeId).toBe('explore');
    expect(r.matches.map(m => m.id)).toContain('explore');
  });

  test('RouteSuggest scores by keyword overlap', () => {
    const reg = makeSampleRegistry();
    const r = dispatchRouteSuggest({ intent: 'I want a fast code scout to find things' }, { registry: reg });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0]!.id).toBe('explore');
  });

  test('AgentsMdRead returns content when present', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'AGENTS.md'), '# hi');
    const r = dispatchAgentsMdRead({}, { cwd: () => dir });
    expect(r.exists).toBe(true);
    expect(r.content).toBe('# hi');
  });

  test('AgentsMdRead reports exists=false when missing', () => {
    const dir = scratchDir();
    const r = dispatchAgentsMdRead({}, { cwd: () => dir });
    expect(r.exists).toBe(false);
  });

  test('all 4 tool specs carry the expected surface shape', () => {
    expect(buildRouteListTool().name).toBe('RouteList');
    expect(buildRouteResolveTool().name).toBe('RouteResolve');
    expect(buildRouteSuggestTool().name).toBe('RouteSuggest');
    expect(buildAgentsMdReadTool().name).toBe('AgentsMdRead');
  });
});
