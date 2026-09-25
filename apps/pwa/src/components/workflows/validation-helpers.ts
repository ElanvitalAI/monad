// ROADMAP Tier 2 W5 (2026-05-11) — pure helpers for inline per-node
// validation rendering. Server-side `validateWorkflow` already returns
// issues with structured `path` strings ("nodes[2].approval.delivery")
// — we just need a small parser to map those paths back onto the
// workflow's nodeIds so each card can show its own ⚠ badge.
//
// Cycle detection runs client-side because the server's topoSort
// throws with a plain-text message and doesn't surface which nodes are
// in the cycle in a structured way. DFS with a recursion-stack pass
// is plenty for the size of workflow graphs we expect (≤ 50 nodes).

import type { WorkflowDefinitionLike } from './workflow-graph-layout';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Pure: extract the nodeId responsible for a server-side issue path.
 *  Returns null when the path doesn't pin a specific node (root-level
 *  metadata like "name", or empty/malformed). */
export function parseIssueNodeId(
  path: string,
  def: WorkflowDefinitionLike,
): string | null {
  if (typeof path !== 'string') return null;
  const match = /^nodes\[(\d+)\]/.exec(path);
  if (!match) return null;
  const idx = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(idx) || idx < 0) return null;
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  if (idx >= nodes.length) return null;
  const node = nodes[idx];
  if (!node || typeof node.id !== 'string' || node.id.length === 0) return null;
  return node.id;
}

export interface GroupedIssues {
  /** issues that pin a specific node, keyed by nodeId */
  byNodeId: Record<string, ValidationIssue[]>;
  /** issues with no node-scoped path (root-level / unparseable) */
  rootIssues: ValidationIssue[];
}

/** Pure: bucket server issues by their owning nodeId. Used both by the
 *  graph (to paint ⚠ on each affected card) and the textarea-mode
 *  issue list (to make each row clickable → fitView). */
export function groupIssuesByNodeId(
  issues: ReadonlyArray<ValidationIssue>,
  def: WorkflowDefinitionLike,
): GroupedIssues {
  const byNodeId: Record<string, ValidationIssue[]> = {};
  const rootIssues: ValidationIssue[] = [];
  for (const issue of issues) {
    const nodeId = parseIssueNodeId(issue.path, def);
    if (nodeId) {
      if (!byNodeId[nodeId]) byNodeId[nodeId] = [];
      byNodeId[nodeId]!.push(issue);
    } else {
      rootIssues.push(issue);
    }
  }
  return { byNodeId, rootIssues };
}

/** Pure: find every node that participates in a cycle of the
 *  `depends_on` graph. Returns a set of nodeIds (one set captures all
 *  cycles since the renderer needs the union — every offending edge
 *  is dashed regardless of which cycle it belongs to).
 *
 *  Edge direction: `nodes[i].depends_on: [a, b]` means a→i and b→i.
 *  (i depends on a + b, so a + b must finish first.) */
export function detectCycle(def: WorkflowDefinitionLike): Set<string> {
  const rawNodes = Array.isArray(def.nodes) ? def.nodes : [];
  const ids = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const n of rawNodes) {
    if (!n || typeof n.id !== 'string' || n.id.length === 0) continue;
    ids.add(n.id);
  }
  for (const n of rawNodes) {
    if (!n || typeof n.id !== 'string' || n.id.length === 0) continue;
    const deps = Array.isArray(n.depends_on) ? n.depends_on : [];
    for (const dep of deps) {
      if (typeof dep !== 'string' || dep.length === 0) continue;
      if (!ids.has(dep)) continue;
      const out = adj.get(dep) ?? [];
      out.push(n.id);
      adj.set(dep, out);
    }
  }

  const inCycle = new Set<string>();
  // color: undefined/0 = unvisited, 1 = on current dfs stack, 2 = done
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  function dfs(id: string): void {
    color.set(id, 1);
    stack.push(id);
    const children = adj.get(id) ?? [];
    for (const c of children) {
      const cColor = color.get(c) ?? 0;
      if (cColor === 1) {
        // back-edge — mark every node from `c` up to top of stack
        const ix = stack.lastIndexOf(c);
        if (ix >= 0) {
          for (let k = ix; k < stack.length; k++) inCycle.add(stack[k]!);
        }
      } else if (cColor === 0) {
        dfs(c);
      }
    }
    color.set(id, 2);
    stack.pop();
  }

  for (const id of ids) {
    if ((color.get(id) ?? 0) === 0) dfs(id);
  }
  return inCycle;
}
