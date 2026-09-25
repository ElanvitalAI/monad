/**
 * Loop-prompt section helper. Produces a markdown block for auto-mode
 * context injection. Returns `null` on empty graph so the caller can
 * conditionally append without polluting prompts that have no TOX
 * state.
 */
import type { TaskGraph } from './graph.js';
import type { TaskFeedbackLoop } from './feedback-loop.js';
import { surfaceGlyph } from './types.js';

export interface LoopSectionOptions {
  graph: TaskGraph;
  loop?: TaskFeedbackLoop;
  /** Max ready tasks shown in next-ready block. Default 3. */
  maxTasksShown?: number;
  /** When true (default), return null if the graph has no live tasks. */
  onlyIfNonEmpty?: boolean;
}

export function buildToxLoopSection(opts: LoopSectionOptions): string | null {
  const graph = opts.graph;
  const loop = opts.loop;
  const maxShown = opts.maxTasksShown ?? 3;
  const onlyIfNonEmpty = opts.onlyIfNonEmpty ?? true;

  const counts = graph.countByStatus();
  const liveCount =
    counts.backlog + counts.blocked + counts.scheduled + counts.ready +
    counts.running + counts.review;
  if (onlyIfNonEmpty && liveCount === 0 && counts.done === 0 && counts.failed === 0) {
    return null;
  }

  const header = '## Task Orchestrator';
  const countsLine =
    `- counts: backlog ${counts.backlog} · blocked ${counts.blocked} ` +
    `· ready ${counts.ready} · running ${counts.running} ` +
    `· done ${counts.done} · failed ${counts.failed}`;

  const ready = graph.readySet({ limit: maxShown });
  let nextLine: string;
  if (ready.length === 0) {
    nextLine = '- next-ready: (none)';
  } else {
    const lines = ready.map(
      (t) => `  ${surfaceGlyph(t.surface.kind)} ${t.id} — "${t.title}" [${t.surface.kind}]`,
    );
    nextLine = `- next-ready:\n${lines.join('\n')}`;
  }

  const loopLine = loop
    ? (() => {
        const s = loop.stats();
        const depth = Object.entries(s.regenerateDepthByGoal)
          .map(([g, d]) => `${g}=${d}`)
          .join(', ');
        const depthFrag = depth.length > 0 ? ` · regenerate depth: ${depth}` : '';
        return s.paused
          ? `- loop: paused(${s.pausedReason ?? 'unknown'})${depthFrag}`
          : `- loop: active${depthFrag}`;
      })()
    : '- loop: (not wired)';

  return [header, countsLine, nextLine, loopLine].join('\n');
}
