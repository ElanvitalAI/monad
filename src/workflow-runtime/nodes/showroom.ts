// W6 Z8 · Workflow-Native Showroom node executor.
// Cf. ROADMAP §4 Z8. Multi-model cascade as a workflow step with 4
// aggregator strategies; falls back to first lane when consensus split.

import type {
  NodeExecContext,
  NodeOutput,
  ShowroomAggregator,
  ShowroomLaneSpecNode,
  ShowroomNode,
  WorkflowDeps,
} from '../types.js';
import { interpolate } from '../variables.js';

export interface ShowroomLaneRun {
  role: ShowroomLaneSpecNode['role'];
  model: string;
  text: string;
}

export type ShowroomConsensus =
  | 'unanimous'
  | 'majority'
  | 'split'
  | 'first'
  | 'escalate';

export interface ShowroomNodeOutput {
  aggregator: ShowroomAggregator;
  result: string;
  consensus: ShowroomConsensus;
  lanes: ShowroomLaneRun[];
  /** Free-form aggregator notes (e.g. vote tally · escalate reason). */
  notes?: string;
}

function normalizeForVote(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function aggregate(
  aggregator: ShowroomAggregator,
  lanes: ShowroomLaneRun[],
): { result: string; consensus: ShowroomConsensus; notes?: string } {
  if (lanes.length === 0) {
    return { result: '', consensus: 'split', notes: 'no-lanes' };
  }
  const first = lanes[0]!;
  if (aggregator === 'first-finalize') {
    return { result: first.text, consensus: 'first' };
  }

  // Vote tally by normalized text.
  const tally = new Map<string, { count: number; canonical: string }>();
  for (const l of lanes) {
    const key = normalizeForVote(l.text);
    const entry = tally.get(key);
    if (entry) entry.count += 1;
    else tally.set(key, { count: 1, canonical: l.text });
  }
  const tallyEntries = Array.from(tally.values()).sort((a, b) => b.count - a.count);
  const top = tallyEntries[0]!;
  const unanimous = top.count === lanes.length;

  if (aggregator === 'unanimous-or-escalate') {
    return unanimous
      ? { result: top.canonical, consensus: 'unanimous' }
      : { result: '', consensus: 'escalate', notes: `split-${lanes.length}-way` };
  }

  if (aggregator === 'majority') {
    if (top.count > lanes.length / 2) {
      return {
        result: top.canonical,
        consensus: unanimous ? 'unanimous' : 'majority',
        notes: `vote ${top.count}/${lanes.length}`,
      };
    }
    return { result: first.text, consensus: 'split', notes: 'no-majority-fallback-first' };
  }

  // vote_with_reasoning · majority + reasoning bundle from every lane
  const reasoning = lanes.map((l) => `- ${l.role}/${l.model}: ${l.text}`).join('\n');
  if (top.count > lanes.length / 2) {
    return {
      result: `${top.canonical}\n\n---\nReasoning:\n${reasoning}`,
      consensus: unanimous ? 'unanimous' : 'majority',
      notes: `vote ${top.count}/${lanes.length}`,
    };
  }
  return {
    result: `${first.text}\n\n---\nReasoning:\n${reasoning}`,
    consensus: 'split',
    notes: 'no-majority-fallback-first',
  };
}

export async function executeShowroomNode(
  node: ShowroomNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const { lanes: laneSpecs, aggregator } = node.showroom;
  const mode = node.showroom.mode ?? 'parallel';

  const runLane = async (lane: ShowroomLaneSpecNode): Promise<ShowroomLaneRun> => {
    const interpolated = interpolate(lane.prompt, {
      arguments: ctx.arguments,
      artifactsDir: ctx.artifactsDir,
      outputs: ctx.outputs,
    });
    const text = await deps.callLLM({
      prompt: interpolated.text,
      model: lane.model,
      ...(ctx.resolvedProvider !== undefined ? { provider: ctx.resolvedProvider } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    });
    return { role: lane.role, model: lane.model, text };
  };

  try {
    const runs: ShowroomLaneRun[] = [];
    if (mode === 'sequential') {
      for (const ls of laneSpecs) runs.push(await runLane(ls));
    } else {
      const results = await Promise.all(laneSpecs.map(runLane));
      runs.push(...results);
    }
    const agg = aggregate(aggregator, runs);
    const output: ShowroomNodeOutput = {
      aggregator,
      result: agg.result,
      consensus: agg.consensus,
      lanes: runs,
      ...(agg.notes ? { notes: agg.notes } : {}),
    };
    return { ok: true, output, durationMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
