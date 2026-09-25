/**
 * Self-dev live board (S3 — item 5).
 *
 * Thin wrapper over the existing TOX board renderer (`computeBoard` +
 * `renderBoardAnsi`) — the orchestrator exposes the running graph's
 * tasks via `onSnapshot`, and the CLI renders this kanban on each cycle
 * (`--board`). Re-invention 0: no new rendering, just a self-dev-sized
 * viewport default + the graph's real Task[].
 *
 * Cf. PLAN-parallel-self-dev-orchestrator-2026-07-21 §5 (S3).
 */
import { computeBoard, renderBoardAnsi } from '../task-orchestrator/board/index.js';
import type { Task } from '../task-orchestrator/types.js';

export function renderSelfDevBoard(
  tasks: readonly Task[],
  opts: { width?: number; height?: number; now?: number; color?: boolean } = {},
): string {
  const layout = computeBoard({
    tasks,
    viewport: { width: opts.width ?? 100, height: opts.height ?? 24 },
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });
  return renderBoardAnsi(layout, { color: opts.color ?? true });
}
