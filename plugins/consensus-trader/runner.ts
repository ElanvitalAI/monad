// ── Consensus runner (Phase D — agent-based) ──
//
// Phase D rewires the fan-out layer onto AgentRegistry. Each persona
// runs as an AgentTask; a Data Collector agent (optional) runs first
// and seeds commonGround shared across every persona; an Aggregator
// agent (optional) runs last and produces a markdown consensus block.
//
// The public surface (runConsensus(ctx, state, opts)) is preserved so
// plugin.ts + existing tests don't need to change. `opts.stream` is
// the legacy string-returning streamLLM stub — tests still inject it,
// and internally we wrap it into a fake LLMProvider that emits one
// `text` delta carrying the full string, then delegate through the
// agent runtime as with any real call.

import { streamLLM, type LLMMessage, type LLMProvider, type LLMStreamEvent } from '../../src/llm.js';
import { AgentRegistry, collectAgentText } from '../../src/agent/registry.js';
import { resolveAgent } from '../../src/agent/loader.js';
import type { AgentDefinition } from '../../src/agent/types.js';
import {
  PERSONAS, filterPersonas, getPersona, samplePersonas, type Persona,
} from './personas.js';
import {
  personaToDefinition, buildPersonaSystemPrompt,
} from './agent-adapter.js';
import type { AgentResult, ConsensusTraderState } from './plugin.js';

/** Minimum surface a runner needs from PluginContext. Keeps the
 *  runner testable without instantiating the full plugin host. */
export interface RunnerCtx {
  log(line: string): void;
  requestRender(): void;
}

/** Overrides that tests can pass to stub out the LLM call + sampler. */
export interface RunOptions {
  /** Legacy stream function (matching streamLLM's shape). Tests use
   *  this to return canned responses without touching the network.
   *  When unset the runner picks a real provider via getProvider(). */
  stream?: typeof streamLLM;
  /** Abort signal that cancels every in-flight agent. */
  signal?: AbortSignal;
  /** RNG for auto-sampling. Defaults to Math.random. */
  rand?: () => number;
  /** Inject specific phase responses. Tests can pin the data-collector
   *  output (and skip calling opts.stream for it) so persona prompts
   *  see a predictable commonGround block. */
  dataCollectorStub?: (query: string) => Promise<string>;
  aggregatorStub?: (results: AgentResult[]) => Promise<string>;
  /** Shared registry (Phase D infra). A new one is created per call
   *  when omitted — tests use their own instance to assert task
   *  lifecycle or to clear between runs. */
  registry?: AgentRegistry;
}

// ── Legacy parse helpers (unchanged public surface) ──
//
// Kept in this file so tests that pin specific parse behaviour
// (`buildSystemPrompt.toContain(persona.voice)`, etc.) keep passing.
// The agent-adapter module owns the "rich" prompt builder that also
// accepts a commonGround prefix; this thin alias mirrors the v0.3.0
// signature.

export function buildSystemPrompt(persona: Persona): string {
  return buildPersonaSystemPrompt(persona);
}

const STANCE_RE  = /^\s*STANCE\s*:\s*(bullish|bearish|neutral)\s*$/im;
const CONF_RE    = /^\s*CONFIDENCE\s*:\s*([0-9]*\.?[0-9]+)/im;
const SUMMARY_RE = /^\s*SUMMARY\s*:\s*(.+)$/im;

export function parseStance(raw: string): AgentResult['stance'] {
  const m = raw.match(STANCE_RE);
  if (m) return m[1]!.toLowerCase() as AgentResult['stance'];
  const blob = raw.toLowerCase();
  const bull = (blob.match(/\b(bullish|bull|buy|upside|long)\b/g) || []).length;
  const bear = (blob.match(/\b(bearish|bear|sell|downside|short)\b/g) || []).length;
  if (bull > bear + 1) return 'bullish';
  if (bear > bull + 1) return 'bearish';
  if (bull || bear)     return 'neutral';
  return 'unknown';
}

export function parseConfidence(raw: string): number {
  const m = raw.match(CONF_RE);
  if (!m) return 0;
  const n = Number.parseFloat(m[1]!);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function parseSummary(raw: string): string {
  const m = raw.match(SUMMARY_RE);
  if (m) return m[1]!.trim();
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^(STANCE|CONFIDENCE|SUMMARY|RATIONALE)\s*:/i.test(t)) continue;
    return t.slice(0, 120);
  }
  return '';
}

export function parseResult(persona: Persona, raw: string): AgentResult {
  return {
    personaId: persona.id,
    personaName: persona.name,
    stance: parseStance(raw),
    confidence: parseConfidence(raw),
    summary: parseSummary(raw),
    raw,
  };
}

// ── Persona sampling (unchanged) ──

export function resolveAgents(
  state: ConsensusTraderState,
  rand: () => number = Math.random,
): Persona[] {
  if (state.pickedIds.size > 0) {
    const picked = [...state.pickedIds]
      .map(id => getPersona(id))
      .filter((p): p is Persona => p !== undefined);
    return picked.slice(0, Math.max(0, state.agentCount));
  }
  const pool = state.searchText.trim()
    ? filterPersonas(state.searchText)
    : [...PERSONAS];
  return samplePersonas(pool, state.agentCount, rand);
}

// ── stream → provider adapter ──
//
// The legacy stub `opts.stream` returns a full string when awaited.
// AgentRegistry wants an LLMProvider emitting streaming events. Wrap
// the stub so one awaited string becomes one text delta — enough to
// drive the whole pipeline deterministically in tests.

function streamToProvider(stream: typeof streamLLM): LLMProvider {
  const p: LLMProvider = {
    name: 'stub-stream',
    defaultModel: 'stub',
    available: () => true,
    async *streamChat(messages, opts) {
      const text = await stream(messages, () => {}, opts);
      yield { type: 'text', delta: text } as LLMStreamEvent;
    },
    async *chat(messages, opts) {
      for await (const ev of p.streamChat!(messages, opts)) {
        if (ev.type === 'text') yield ev.delta;
      }
    },
  };
  return p;
}

// ── Main run ──

/** Fan the query out to every resolved persona. Results stream into
 *  state.results as each agent finishes. Optional Data Collector
 *  phase seeds commonGround; optional Aggregator phase fills
 *  aggregatorOutput. Both opt-in via state flags (default false) so
 *  the baseline behaviour is identical to v0.3.0. */
export async function runConsensus(
  ctx: RunnerCtx,
  state: ConsensusTraderState,
  opts: RunOptions = {},
): Promise<void> {
  const agents = resolveAgents(state, opts.rand);
  if (agents.length === 0) {
    ctx.log('[consensus] pool is empty — nothing to run');
    return;
  }
  if (!state.query.trim()) {
    ctx.log('[consensus] query is empty — nothing to ask');
    return;
  }

  const registry = opts.registry ?? new AgentRegistry();
  const provider = opts.stream ? streamToProvider(opts.stream) : undefined;

  state.running = true;
  state.results = [];
  state.commonGround = '';
  state.aggregatorOutput = '';
  ctx.requestRender();

  const mode = state.pickedIds.size > 0 ? 'picked' : 'auto';
  const sample = state.searchText.trim()
    ? ` filtered by "${state.searchText.trim()}"` : '';
  ctx.log(`[consensus] dispatching ${agents.length} agent${agents.length !== 1 ? 's' : ''} (${mode}${sample}) on "${truncateForLog(state.query)}"`);

  // ── Phase 0: Data Collector ──
  if (state.useDataCollector) {
    try {
      const brief = await runDataCollector(state, opts, registry, provider);
      state.commonGround = brief.trim();
      if (state.commonGround) {
        ctx.log(`[consensus] data-collector: ${truncateForLog(brief.split('\n')[0] || brief)}`);
        ctx.requestRender();
      }
    } catch (err: any) {
      ctx.log(`[consensus] data-collector failed — ${err?.message || err} (continuing)`);
    }
  }

  // ── Phase 1: Personas ──
  const runs = agents.map(persona => runOnePersona(
    ctx, state, persona, registry, provider, opts.signal,
  ));
  await Promise.allSettled(runs);

  // ── Phase 2: Aggregator ──
  if (state.useAggregator && state.results.length > 0) {
    try {
      const agg = await runAggregator(state, opts, registry, provider);
      state.aggregatorOutput = agg.trim();
      if (state.aggregatorOutput) {
        ctx.log(`[consensus] aggregator: ${truncateForLog(firstHeading(agg))}`);
      }
    } catch (err: any) {
      ctx.log(`[consensus] aggregator failed — ${err?.message || err}`);
    }
  }

  state.running = false;
  ctx.log(`[consensus] done — ${state.results.length}/${agents.length} agents returned`);
  ctx.requestRender();
}

// ── Phase 0: Data Collector ──

async function runDataCollector(
  state: ConsensusTraderState,
  opts: RunOptions,
  registry: AgentRegistry,
  provider: LLMProvider | undefined,
): Promise<string> {
  if (opts.dataCollectorStub) return opts.dataCollectorStub(state.query);
  const def = resolveAgent('data-collector') ?? FALLBACK_DATA_COLLECTOR;
  const { events } = registry.spawn({
    definition: def,
    prompt: state.query,
    provider,
  });
  return collectAgentText(events);
}

// ── Phase 1: Single persona ──

async function runOnePersona(
  ctx: RunnerCtx,
  state: ConsensusTraderState,
  persona: Persona,
  registry: AgentRegistry,
  provider: LLMProvider | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const def = personaToDefinition(persona, {
    commonGround: state.commonGround || undefined,
  });

  // External AbortSignal cancels every persona task. The registry
  // keeps its own AbortController per task; we just wire a listener
  // that calls registry.abort(task.id) when the shared signal fires.
  const { task, events } = registry.spawn({
    definition: def,
    prompt: state.query,
    provider,
  });
  const unsubscribeAbort = signal
    ? bindAbort(signal, () => registry.abort(task.id))
    : () => {};

  try {
    const raw = await collectAgentText(events);
    state.results.push(parseResult(persona, raw));
    ctx.log(`[consensus] ${persona.name} → ${summaryForLog(raw)}`);
  } catch (err: any) {
    state.results.push({
      personaId: persona.id,
      personaName: persona.name,
      stance: 'unknown',
      confidence: 0,
      summary: '',
      raw: '',
      error: err?.message || String(err),
    });
    ctx.log(`[consensus] ${persona.name} FAILED — ${err?.message || err}`);
  } finally {
    unsubscribeAbort();
    ctx.requestRender();
  }
}

// ── Phase 2: Aggregator ──

async function runAggregator(
  state: ConsensusTraderState,
  opts: RunOptions,
  registry: AgentRegistry,
  provider: LLMProvider | undefined,
): Promise<string> {
  if (opts.aggregatorStub) return opts.aggregatorStub(state.results);

  const def = resolveAgent('aggregator') ?? FALLBACK_AGGREGATOR;
  const prompt = buildAggregatorPrompt(state);
  const { events } = registry.spawn({
    definition: def,
    prompt,
    provider,
  });
  return collectAgentText(events);
}

/** Serialise the results into a structured block the aggregator can
 *  read without re-parsing the raw persona output. Keep it compact so
 *  N × rationales fit well inside the aggregator's context. */
export function buildAggregatorPrompt(state: ConsensusTraderState): string {
  const lines: string[] = [];
  lines.push(`Question: ${state.query}`);
  if (state.commonGround) {
    lines.push('');
    lines.push('## Shared brief');
    lines.push(state.commonGround);
  }
  lines.push('');
  lines.push('## Expert responses');
  state.results.forEach((r, idx) => {
    lines.push('');
    lines.push(`### ${idx + 1}. ${r.personaName}`);
    if (r.error) {
      lines.push(`_(error: ${r.error})_`);
      return;
    }
    lines.push(`- Stance: ${r.stance}`);
    lines.push(`- Confidence: ${r.confidence.toFixed(2)}`);
    if (r.summary) lines.push(`- Summary: ${r.summary}`);
    if (r.raw) {
      lines.push('');
      lines.push('```');
      lines.push(r.raw.trim());
      lines.push('```');
    }
  });
  return lines.join('\n');
}

// ── Fallback definitions ──
//
// Used when loader can't find the built-in .md files (e.g. a bundled
// binary that didn't ship them). Minimal but functional.

const FALLBACK_DATA_COLLECTOR: AgentDefinition = {
  name: 'data-collector',
  systemPrompt: 'Extract a neutral research brief for the question. Produce ENTITIES / TIMEFRAME / DOMAINS / KEY FACTS / OPEN QUESTIONS / CONTEXT NOTE sections, under 200 words, no stance.',
};

const FALLBACK_AGGREGATOR: AgentDefinition = {
  name: 'aggregator',
  systemPrompt: 'Summarise the expert panel as markdown with sections: ## Consensus (stance distribution + weighted conviction + headline), ## Divergence (bullets), ## Outliers (bullets or omit), ## What to watch (up to 3 bullets). Under 250 words. Attribute claims; never invent stances.',
};

// ── utils ──

function truncateForLog(s: string): string {
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

function summaryForLog(raw: string): string {
  const s = parseSummary(raw);
  return s ? truncateForLog(s) : '(no summary)';
}

function firstHeading(md: string): string {
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#')) return t.replace(/^#+\s*/, '');
    if (t) return t;
  }
  return md.slice(0, 60);
}

function bindAbort(signal: AbortSignal, fn: () => void): () => void {
  if (signal.aborted) { fn(); return () => {}; }
  const handler = () => fn();
  signal.addEventListener('abort', handler, { once: true });
  return () => signal.removeEventListener('abort', handler);
}
