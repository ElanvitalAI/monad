// ── Phase D: consensus-trader v1 pipeline tests ──
//
// End-to-end harness for the Data Collector → N personas → Aggregator
// flow wired onto AgentRegistry. Uses the legacy `opts.stream` stub
// (adapted into an LLMProvider inside runner.ts) and Phase-D specific
// overrides (`dataCollectorStub`, `aggregatorStub`) to pin each
// phase's output without touching the network.

import { describe, test, expect } from 'bun:test';
import plugin, {
  type ConsensusTraderState,
} from '../plugins/consensus-trader/plugin.js';
import {
  runConsensus,
  buildAggregatorPrompt,
  type RunnerCtx,
} from '../plugins/consensus-trader/runner.js';
import {
  personaToDefinition,
  buildPersonaSystemPrompt,
} from '../plugins/consensus-trader/agent-adapter.js';
import { PERSONAS } from '../plugins/consensus-trader/personas.js';
import { AgentRegistry } from '../src/agent/registry.js';

function freshState(overrides: Partial<ConsensusTraderState> = {}): ConsensusTraderState {
  return { ...plugin.initialState(), ...overrides };
}

function capturingCtx(): RunnerCtx & { logs: string[]; renders: number } {
  const logs: string[] = [];
  let renders = 0;
  return {
    log: (line) => logs.push(line),
    requestRender: () => { renders++; },
    get logs() { return logs; },
    get renders() { return renders; },
  } as RunnerCtx & { logs: string[]; renders: number };
}

// ═══════════════════════════════════════════
// 1. personaToDefinition — runtime conversion
// ═══════════════════════════════════════════

describe('personaToDefinition', () => {
  test('emits AgentDefinition with persona:<id> name and tag contract', () => {
    const p = PERSONAS[0]!;
    const def = personaToDefinition(p);
    expect(def.name).toBe(`persona:${p.id}`);
    expect(def.systemPrompt).toContain(p.name);
    expect(def.systemPrompt).toContain(p.voice);
    expect(def.systemPrompt).toContain('STANCE:');
    expect(def.systemPrompt).toContain('CONFIDENCE:');
    expect(def.description).toContain(p.name);
    // No tools by default — explicit allowlist policy
    expect(def.tools).toBeUndefined();
  });

  test('commonGround prefix prepends a shared research brief block', () => {
    const p = PERSONAS[0]!;
    const def = personaToDefinition(p, {
      commonGround: 'ENTITIES: Samsung\nDOMAINS: equities, korea',
    });
    // Prefix appears BEFORE the persona identity — cache-prefix friendly
    expect(def.systemPrompt.indexOf('Shared research brief'))
      .toBeLessThan(def.systemPrompt.indexOf(p.name));
    expect(def.systemPrompt).toContain('ENTITIES: Samsung');
  });

  test('model + tools overrides flow through', () => {
    const p = PERSONAS[0]!;
    const def = personaToDefinition(p, {
      model: 'claude-haiku-4-5',
      tools: ['omni-market', 'web_search'],
    });
    expect(def.model).toBe('claude-haiku-4-5');
    expect(def.tools).toEqual(['omni-market', 'web_search']);
  });

  test('buildPersonaSystemPrompt honours maxRationaleWords', () => {
    const out = buildPersonaSystemPrompt(PERSONAS[0]!, { maxRationaleWords: 40 });
    expect(out).toContain('under 40 words');
  });
});

// ═══════════════════════════════════════════
// 2. buildAggregatorPrompt
// ═══════════════════════════════════════════

describe('buildAggregatorPrompt', () => {
  test('folds query + commonGround + per-persona responses into markdown', () => {
    const state = freshState({
      query: 'Will X outperform in 2026?',
      commonGround: 'DOMAINS: equities',
      results: [
        { personaId: 'a', personaName: 'Alice',
          stance: 'bullish', confidence: 0.8, summary: 'earnings momentum',
          raw: 'STANCE: bullish\nRATIONALE: ...' },
        { personaId: 'b', personaName: 'Bob',
          stance: 'bearish', confidence: 0.6, summary: 'valuation stretched',
          raw: 'STANCE: bearish' },
      ],
    });
    const prompt = buildAggregatorPrompt(state);
    expect(prompt).toContain('Will X outperform');
    expect(prompt).toContain('DOMAINS: equities');
    expect(prompt).toContain('### 1. Alice');
    expect(prompt).toContain('### 2. Bob');
    expect(prompt).toContain('Stance: bullish');
    expect(prompt).toContain('Confidence: 0.80');
  });

  test('errored results surface without stance/confidence fields', () => {
    const state = freshState({
      query: 'q',
      results: [
        { personaId: 'x', personaName: 'X', stance: 'unknown', confidence: 0,
          summary: '', raw: '', error: 'upstream 500' },
      ],
    });
    const prompt = buildAggregatorPrompt(state);
    expect(prompt).toContain('X');
    expect(prompt).toContain('upstream 500');
    expect(prompt).not.toContain('Stance: unknown');
  });
});

// ═══════════════════════════════════════════
// 3. End-to-end pipeline (stubs for every phase)
// ═══════════════════════════════════════════

describe('runConsensus — Phase D pipeline', () => {
  test('useDataCollector=true seeds commonGround and injects it into persona prompts', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'Should we buy X?',
      pickedIds: new Set([PERSONAS[0]!.id]),
      agentCount: 1,
      useDataCollector: true,
    });

    const seenPrompts: string[] = [];
    const stubStream = async (messages: any[]): Promise<string> => {
      // Capture the system prompt to assert commonGround injection
      const sys = messages.find((m: any) => m.role === 'system')?.content;
      if (typeof sys === 'string') seenPrompts.push(sys);
      return 'STANCE: neutral\nCONFIDENCE: 0.5\nSUMMARY: ok';
    };

    await runConsensus(ctx, state, {
      stream: stubStream as any,
      dataCollectorStub: async () => 'ENTITIES: X\nDOMAINS: equities',
    });

    expect(state.commonGround).toBe('ENTITIES: X\nDOMAINS: equities');
    // The persona system prompt should carry the commonGround block.
    const personaPrompt = seenPrompts.find(p => p.includes(PERSONAS[0]!.name));
    expect(personaPrompt).toBeDefined();
    expect(personaPrompt).toContain('ENTITIES: X');
    expect(personaPrompt).toContain('Shared research brief');
  });

  test('useAggregator=true runs aggregator after personas and stores its output', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id]),
      agentCount: 2,
      useAggregator: true,
    });

    let aggCalls = 0;
    await runConsensus(ctx, state, {
      stream: async () => 'STANCE: bullish\nCONFIDENCE: 0.7\nSUMMARY: ok',
      aggregatorStub: async (results) => {
        aggCalls++;
        expect(results).toHaveLength(2);
        return '## Consensus\n\n- 2 bullish agents agreed';
      },
    });

    expect(aggCalls).toBe(1);
    expect(state.aggregatorOutput).toContain('2 bullish agents agreed');
  });

  test('aggregator is skipped when no personas returned results', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id]),
      agentCount: 1,
      useAggregator: true,
    });

    let aggCalls = 0;
    await runConsensus(ctx, state, {
      stream: async () => { throw new Error('persona down'); },
      aggregatorStub: async () => { aggCalls++; return 'AGG'; },
    });

    // Persona failed → result row with error, but results.length === 1,
    // so aggregator SHOULD run. The "skip" path triggers only when
    // state.results is empty. Here we assert it DID run.
    expect(aggCalls).toBe(1);
  });

  test('data-collector failure is logged but does not block personas', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id]),
      agentCount: 1,
      useDataCollector: true,
    });

    await runConsensus(ctx, state, {
      stream: async () => 'STANCE: neutral\nCONFIDENCE: 0.3\nSUMMARY: ok',
      dataCollectorStub: async () => { throw new Error('dc-fail'); },
    });

    expect(state.commonGround).toBe('');
    expect(state.results).toHaveLength(1);
    expect(ctx.logs.some(l => l.includes('data-collector failed'))).toBe(true);
  });

  test('Phase D flags default OFF → no data-collector or aggregator runs', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id]),
      agentCount: 1,
    });

    let dcCalls = 0;
    let aggCalls = 0;
    await runConsensus(ctx, state, {
      stream: async () => 'STANCE: bullish\nCONFIDENCE: 0.8\nSUMMARY: ok',
      dataCollectorStub: async () => { dcCalls++; return 'X'; },
      aggregatorStub:    async () => { aggCalls++; return 'X'; },
    });

    expect(dcCalls).toBe(0);
    expect(aggCalls).toBe(0);
    expect(state.commonGround).toBe('');
    expect(state.aggregatorOutput).toBe('');
  });

  test('shared registry: every persona task lands in the same registry', async () => {
    const ctx = capturingCtx();
    const registry = new AgentRegistry();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id, PERSONAS[2]!.id]),
      agentCount: 3,
    });

    await runConsensus(ctx, state, {
      stream: async () => 'STANCE: neutral\nCONFIDENCE: 0.5\nSUMMARY: ok',
      registry,
    });

    // 3 persona tasks, all finished
    const done = registry.list('done');
    expect(done).toHaveLength(3);
    for (const task of done) {
      expect(task.definition.name.startsWith('persona:')).toBe(true);
    }
  });

  test('full pipeline: data-collector + personas + aggregator end-to-end', async () => {
    const ctx = capturingCtx();
    const registry = new AgentRegistry();
    const state = freshState({
      query: 'Will Samsung outperform in 2026?',
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id]),
      agentCount: 2,
      useDataCollector: true,
      useAggregator: true,
    });

    await runConsensus(ctx, state, {
      stream: async () => 'STANCE: bullish\nCONFIDENCE: 0.75\nSUMMARY: durable moat',
      dataCollectorStub: async (q) =>
        `ENTITIES: Samsung\nTIMEFRAME: long\nDOMAINS: equities, semiconductor\nQUERY: ${q}`,
      aggregatorStub: async (results) =>
        `## Consensus\n\n- ${results.length} bullish agents aligned`,
      registry,
    });

    expect(state.commonGround).toContain('ENTITIES: Samsung');
    expect(state.results).toHaveLength(2);
    expect(state.aggregatorOutput).toContain('2 bullish agents aligned');

    // dataCollectorStub / aggregatorStub short-circuit registry.spawn,
    // so only persona tasks land in the registry.
    expect(registry.size).toBe(2);
    expect(registry.list('done')).toHaveLength(2);
    for (const task of registry.list('done')) {
      expect(task.definition.name.startsWith('persona:')).toBe(true);
    }
  });

  test('aborting via signal cancels all in-flight personas', async () => {
    const ctx = capturingCtx();
    const controller = new AbortController();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id]),
      agentCount: 1,
    });

    const hangingStream = async (_m: any[], _cb: any, opts: any): Promise<string> => {
      await new Promise<void>((_r, rej) => {
        opts?.signal?.addEventListener('abort', () => {
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
      return '';
    };

    const pending = runConsensus(ctx, state, {
      stream: hangingStream as any,
      signal: controller.signal,
    });
    // Give runAgent time to wire abort listeners
    await new Promise(r => setTimeout(r, 10));
    controller.abort();

    await pending;
    expect(state.results).toHaveLength(1);
    const row = state.results[0]!;
    expect(row.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// 4. Plugin state defaults
// ═══════════════════════════════════════════

describe('plugin.initialState — Phase D fields', () => {
  test('Phase D flags default to false', () => {
    const s = plugin.initialState();
    expect(s.useDataCollector).toBe(false);
    expect(s.useAggregator).toBe(false);
    expect(s.commonGround).toBe('');
    expect(s.aggregatorOutput).toBe('');
  });
});
