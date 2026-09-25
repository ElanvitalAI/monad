// Ergonomic-port Tier E2.2 (2026-05-11) — derive the status class
// list applied to each ReactFlow node wrapper. Pulled out so the
// mapping can be unit-tested without mounting the React surface.

import type { NodeRunStatus } from './run-status-helpers';

/** Every status maps to exactly one class — running pulses, done
 *  flashes once, failed/skipped show a static halo. Falls back to
 *  the bare `workflow-node-status` baseline when no status is known
 *  (e.g. a node that never ran in the latest pass). */
export function nodeStatusClass(status: NodeRunStatus | undefined): string {
  if (!status) return 'workflow-node-status';
  return `workflow-node-status workflow-node-status-${status}`;
}
