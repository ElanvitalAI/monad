// ── Consensus trader runner tests (Phase 5.3) ──

import { describe, test, expect } from 'bun:test';
import plugin, {
  type ConsensusTraderState,
} from '../plugins/consensus-trader/plugin.js';
import {
  buildSystemPrompt,
  parseStance,
  parseConfidence,
  parseSummary,
  parseResult,
  resolveAgents,
  runConsensus,
  type RunnerCtx,
} from '../plugins/consensus-trader/runner.js';
import { PERSONAS, getPersona } from '../plugins/consensus-trader/personas.js';

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

describe('buildSystemPrompt', () => {
  test('embeds name, role, voice, bias, and tagged format', () => {
    const p = PERSONAS[0]!;
    const out = buildSystemPrompt(p);
    expect(out).toContain(p.name);
    expect(out).toContain(p.role);
    expect(out).toContain(p.voice);
    expect(out).toContain(p.bias);
    expect(out).toContain('STANCE:');
    expect(out).toContain('CONFIDENCE:');
    expect(out).toContain('SUMMARY:');
  });

  test('caps expertise + frameworks to keep the prompt tight', () => {
    // Synthesize an oversized persona — should still build.
    const fat = {
      ...PERSONAS[0]!,
      expertise: Array.from({ length: 20 }, (_, i) => `e${i}`),
      frameworks: Array.from({ length: 20 }, (_, i) => `f${i}`),
    };
    const out = buildSystemPrompt(fat);
    // First six exposures present, 7th excluded.
    expect(out).toContain('e5');
    expect(out).not.toContain('e7;');
    expect(out).toContain('f3');
    expect(out).not.toContain('f5;');
  });
});

describe('parseStance', () => {
  test('reads tagged stance line', () => {
    expect(parseStance('STANCE: bullish\nSUMMARY: x')).toBe('bullish');
    expect(parseStance('stance:   BEARISH   ')).toBe('bearish');
    expect(parseStance('Stance: Neutral\nother text')).toBe('neutral');
  });

  test('falls back to keyword sniff when tag missing', () => {
    expect(parseStance('I am very bullish on this name and see huge upside.'))
      .toBe('bullish');
    expect(parseStance('Bearish outlook — multiple downside catalysts and sell signals.'))
      .toBe('bearish');
  });

  test('returns unknown when no signal at all', () => {
    expect(parseStance('The weather is mild and the coffee is fine.'))
      .toBe('unknown');
  });
});

describe('parseConfidence', () => {
  test('reads 0..1 float from tagged line', () => {
    expect(parseConfidence('CONFIDENCE: 0.72')).toBeCloseTo(0.72);
    expect(parseConfidence('confidence: .5')).toBeCloseTo(0.5);
  });

  test('clamps values above 1 and below 0', () => {
    expect(parseConfidence('CONFIDENCE: 1.5')).toBe(1);
    expect(parseConfidence('CONFIDENCE: -0.2')).toBe(0);
  });

  test('returns 0 when tag missing or unparseable', () => {
    expect(parseConfidence('no tag here')).toBe(0);
    expect(parseConfidence('CONFIDENCE: not-a-number')).toBe(0);
  });
});

describe('parseSummary', () => {
  test('reads tagged summary line', () => {
    expect(parseSummary('STANCE: bullish\nSUMMARY: Strong earnings momentum.'))
      .toBe('Strong earnings momentum.');
  });

  test('falls back to first non-tag non-empty line', () => {
    const raw = 'STANCE: neutral\nCONFIDENCE: 0.4\n\nMixed signals across the sector.';
    expect(parseSummary(raw)).toContain('Mixed signals');
  });

  test('returns empty string for pure whitespace', () => {
    expect(parseSummary('\n\n   \n')).toBe('');
  });
});

describe('parseResult', () => {
  test('combines stance + confidence + summary into a typed row', () => {
    const persona = PERSONAS[0]!;
    const raw = [
      'STANCE: bullish',
      'CONFIDENCE: 0.85',
      'SUMMARY: Great franchise, durable moat.',
      'RATIONALE: …',
    ].join('\n');
    const r = parseResult(persona, raw);
    expect(r.personaId).toBe(persona.id);
    expect(r.personaName).toBe(persona.name);
    expect(r.stance).toBe('bullish');
    expect(r.confidence).toBeCloseTo(0.85);
    expect(r.summary).toContain('durable moat');
    expect(r.raw).toBe(raw);
  });
});

describe('resolveAgents', () => {
  test('maps pickedIds to Persona objects in insertion order', () => {
    const state = freshState({
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[2]!.id, PERSONAS[4]!.id]),
      agentCount: 10,
    });
    const agents = resolveAgents(state);
    expect(agents).toHaveLength(3);
    expect(agents[0]!.id).toBe(PERSONAS[0]!.id);
    expect(agents[2]!.id).toBe(PERSONAS[4]!.id);
  });

  test('caps at agentCount', () => {
    const state = freshState({
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id, PERSONAS[2]!.id]),
      agentCount: 2,
    });
    expect(resolveAgents(state)).toHaveLength(2);
  });

  test('skips unknown ids silently', () => {
    const state = freshState({
      pickedIds: new Set(['no-such-id', PERSONAS[0]!.id]),
      agentCount: 5,
    });
    const agents = resolveAgents(state);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe(PERSONAS[0]!.id);
  });
});

describe('runConsensus', () => {
  test('auto-samples agentCount personas when pickedIds is empty', async () => {
    const ctx = capturingCtx();
    const state = freshState({ query: 'hi', agentCount: 3 });
    const seed = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    let i = 0;
    const rand = () => seed[i++ % seed.length]!;
    await runConsensus(ctx, state, {
      stream: async () => 'STANCE: neutral\nCONFIDENCE: 0.5\nSUMMARY: ok',
      rand,
    });
    expect(state.running).toBe(false);
    expect(state.results).toHaveLength(3);
    expect(ctx.logs.some(l => l.includes('auto'))).toBe(true);
  });

  test('rejects when query is blank', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      pickedIds: new Set([PERSONAS[0]!.id]),
      query: '   ',
    });
    await runConsensus(ctx, state, { stream: async () => '' });
    expect(ctx.logs.some(l => l.includes('query is empty'))).toBe(true);
  });

  test('fans the query to every picked persona and parses results', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'Will X outperform?',
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id]),
      agentCount: 5,
    });
    let calls = 0;
    const stubStream = async (messages: any[]): Promise<string> => {
      calls++;
      const personaIdx = calls - 1;
      const stance = personaIdx === 0 ? 'bullish' : 'bearish';
      const conf  = personaIdx === 0 ? '0.80' : '0.60';
      return `STANCE: ${stance}\nCONFIDENCE: ${conf}\nSUMMARY: agent ${personaIdx}\nRATIONALE: x`;
    };
    await runConsensus(ctx, state, { stream: stubStream as any });
    expect(calls).toBe(2);
    expect(state.running).toBe(false);
    expect(state.results).toHaveLength(2);
    const stances = state.results.map(r => r.stance).sort();
    expect(stances).toEqual(['bearish', 'bullish']);
  });

  test('one failing agent does not poison the batch', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id]),
      agentCount: 5,
    });
    let n = 0;
    const stubStream = async (): Promise<string> => {
      n++;
      if (n === 1) throw new Error('boom');
      return 'STANCE: neutral\nCONFIDENCE: 0.3\nSUMMARY: ok';
    };
    await runConsensus(ctx, state, { stream: stubStream as any });
    expect(state.results).toHaveLength(2);
    const errored = state.results.find(r => r.error);
    expect(errored).toBeDefined();
    expect(errored!.stance).toBe('unknown');
    expect(errored!.error).toContain('boom');
  });

  test('triggers a render for each agent completion', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id, PERSONAS[2]!.id]),
      agentCount: 3,
    });
    const stubStream = async (): Promise<string> =>
      'STANCE: neutral\nCONFIDENCE: 0.5\nSUMMARY: ok';
    await runConsensus(ctx, state, { stream: stubStream as any });
    // 1 initial + 3 per-agent + 1 final = 5
    expect(ctx.renders).toBeGreaterThanOrEqual(5);
  });

  test('clears previous results before a new run', async () => {
    const ctx = capturingCtx();
    const state = freshState({
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id]),
      agentCount: 1,
      results: [{
        personaId: 'old', personaName: 'Old',
        stance: 'bullish', confidence: 1, summary: 'stale', raw: '',
      }],
    });
    const stubStream = async (): Promise<string> =>
      'STANCE: bearish\nCONFIDENCE: 0.4\nSUMMARY: fresh';
    await runConsensus(ctx, state, { stream: stubStream as any });
    expect(state.results).toHaveLength(1);
    expect(state.results[0]!.summary).toBe('fresh');
    expect(state.results[0]!.personaId).toBe(PERSONAS[0]!.id);
  });
});
