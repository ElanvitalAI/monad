// W5 Z5 · Post-Mortem Retro Showroom.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §4 Z5.
//
// When a workflow run reaches a terminal status (done / failed), an
// opt-in cascade fires:
//   1. collectRetroRecord — gather events into a RetroRunRecord.
//   2. runPostRunShowroom  — spawn a 3-lane showroom (reflect → lessons
//      → improvements) against the injected lane callable.
//   3. write the synthesized RetroCard via the injected KGS writer.
//
// executor.ts stays untouched; the caller (CLI / daemon / future
// scheduler hook) forwards events through `collectRetroRecord` and
// then calls `runPostRunShowroom`. KGS storage land is W3 Y1 (#2402)
// so the writer is dependency-injected — the bridge is a thin
// `KgsWriter` interface that the daemon wires to `sqlite-store.ts`.

import type {
  ShowroomLaneCallable,
  ShowroomLaneOutput,
} from '../task-orchestrator/surfaces/showroom-surface.js';
import type { NodeOutput, WorkflowEvent } from './types.js';

export interface RetroRunRecord {
  runId: string;
  workflowName: string;
  ok: boolean;
  startedAt: number;
  completedAt: number;
  /** Whole event tape so the showroom prompt can reference per-node skips/failures. */
  events: WorkflowEvent[];
  outputs: Record<string, NodeOutput>;
  /** When ok=false; mirrors the `workflow_failed.error`. */
  error?: string;
}

export interface RetroCard {
  kind: 'retrospective';
  runId: string;
  workflowName: string;
  ok: boolean;
  /** One-line summary from the reflect lane. */
  summary: string;
  /** Lessons lane output, line-split. */
  lessons: string[];
  /** Improvements lane output, line-split. */
  improvements: string[];
  createdAt: number;
  /** Full transcript so Patcher (Y3) can later distil deeper claims. */
  transcript: string;
}

export interface KgsRetroWriter {
  /** Persist a retrospective card. Best-effort — promise rejection is
   *  surfaced to the caller but does not break run finalization. */
  writeRetroCard(card: RetroCard): Promise<void>;
}

export interface PostRunShowroomDeps {
  laneCallable: ShowroomLaneCallable;
  kgsWriter: KgsRetroWriter;
  /** Opt-in toggle. Default OFF; daemon flips it via user-config. */
  enabled: () => boolean;
  /** Model pins per lane. Defaults are conservative locals so the retro
   *  loop does not silently spend cloud budget. */
  models?: { reflect?: string; lessons?: string; improvements?: string };
  now?: () => number;
}

export interface CollectRetroOpts {
  runId: string;
  workflowName: string;
  startedAt: number;
  now?: () => number;
}

export async function collectRetroRecord(
  events: AsyncIterable<WorkflowEvent>,
  opts: CollectRetroOpts,
): Promise<RetroRunRecord> {
  const now = opts.now ?? Date.now;
  const tape: WorkflowEvent[] = [];
  let ok = true;
  let error: string | undefined;
  let outputs: Record<string, NodeOutput> = {};
  for await (const ev of events) {
    tape.push(ev);
    if (ev.type === 'workflow_failed') {
      ok = false;
      error = ev.error;
      outputs = ev.partial;
    } else if (ev.type === 'workflow_done') {
      outputs = ev.outputs;
    }
  }
  return {
    runId: opts.runId,
    workflowName: opts.workflowName,
    ok,
    startedAt: opts.startedAt,
    completedAt: now(),
    events: tape,
    outputs,
    ...(error ? { error } : {}),
  };
}

function eventTapeSummary(events: WorkflowEvent[]): string {
  return events
    .map((e) => {
      switch (e.type) {
        case 'workflow_start': return `· start workflow=${e.workflow} run=${e.runId}`;
        case 'node_start':     return `· node_start ${e.nodeId} (${e.nodeType})`;
        case 'node_skipped':   return `· node_skipped ${e.nodeId} — ${e.reason}`;
        case 'node_done':      return `· node_done ${e.nodeId} ok=${e.result.ok} ${e.result.durationMs}ms`;
        case 'workflow_done':  return `· workflow_done`;
        case 'workflow_failed':return `· workflow_failed — ${e.error}`;
      }
    })
    .join('\n');
}

function buildReflectPrompt(rec: RetroRunRecord): string {
  return [
    `Workflow: ${rec.workflowName}`,
    `Run id : ${rec.runId}`,
    `Outcome: ${rec.ok ? 'ok' : `failed (${rec.error ?? 'no error message'})`}`,
    `Duration: ${rec.completedAt - rec.startedAt}ms`,
    '',
    'Event tape:',
    eventTapeSummary(rec.events),
    '',
    'Write one paragraph summarising what happened and why.',
  ].join('\n');
}

function buildLessonsPrompt(): string {
  return [
    'List the 3 most actionable lessons from the prior summary.',
    'One per line, no preamble, no numbering.',
  ].join('\n');
}

function buildImprovementsPrompt(): string {
  return [
    'Propose up to 3 concrete improvements the next run could make.',
    'One per line, no preamble, no numbering.',
  ].join('\n');
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 5);
}

export async function runPostRunShowroom(
  record: RetroRunRecord,
  deps: PostRunShowroomDeps,
): Promise<RetroCard | null> {
  if (!deps.enabled()) return null;

  const reflectModel = deps.models?.reflect ?? 'qwen-7b';
  const lessonsModel = deps.models?.lessons ?? 'qwen-7b';
  const improvementsModel = deps.models?.improvements ?? 'qwen-7b';

  const reflectOut = await deps.laneCallable({
    role: 'reflect',
    model: reflectModel,
    prompt: buildReflectPrompt(record),
  });

  const lessonsOut = await deps.laneCallable({
    role: 'review',
    model: lessonsModel,
    prompt: `${buildLessonsPrompt()}\n\n---\nPrior summary:\n${reflectOut.text}`,
  });

  const improvementsOut = await deps.laneCallable({
    role: 'plan',
    model: improvementsModel,
    prompt: `${buildImprovementsPrompt()}\n\n---\nPrior summary:\n${reflectOut.text}\n\nLessons:\n${lessonsOut.text}`,
  });

  const transcript = joinTranscript([reflectOut, lessonsOut, improvementsOut]);
  const now = (deps.now ?? Date.now)();
  const card: RetroCard = {
    kind: 'retrospective',
    runId: record.runId,
    workflowName: record.workflowName,
    ok: record.ok,
    summary: reflectOut.text.trim().slice(0, 1024),
    lessons: splitLines(lessonsOut.text),
    improvements: splitLines(improvementsOut.text),
    createdAt: now,
    transcript: transcript.slice(0, 16384),
  };

  await deps.kgsWriter.writeRetroCard(card);
  return card;
}

function joinTranscript(outs: ShowroomLaneOutput[]): string {
  const titles = ['reflect', 'review', 'plan'];
  return outs.map((o, i) => `## ${titles[i]} · ${o.modelId ?? 'n/a'}\n${o.text}`).join('\n\n');
}
