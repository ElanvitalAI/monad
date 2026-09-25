export interface SelfDevArcClassifyTask {
  id: string;
  title: string;
  description?: string;
  dependsOn?: readonly string[];
}

export interface SelfDevRawArcGroup {
  name?: unknown;
  intent?: unknown;
  tasks?: unknown;
  dependsOn?: unknown;
}

export interface SelfDevArc {
  id: string;
  name: string;
  intent: string;
  taskIds: string[];
  dependsOn: string[];
}

export interface SelfDevArcClassification {
  arcs: SelfDevArc[];
  hintDeviation?: { requested: number; actual: number };
}

const SELF_DEV_ARC_MAX_COUNT = 6;

function hasCycle(nodes: readonly SelfDevArc[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = byId.get(id);
    if (node?.dependsOn.some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return nodes.some((node) => visit(node.id));
}

/**
 * Converts a 1-based LLM grouping into harness arcs. Any malformed partition,
 * dependency cycle, or task-DAG ordering conflict returns null for flat fallback.
 */
export function deriveSelfDevArcsFromGrouping(
  tasks: readonly SelfDevArcClassifyTask[],
  groups: readonly SelfDevRawArcGroup[],
  requestedArcCount: number,
): SelfDevArcClassification | null {
  if (groups.length < 2 || groups.length > SELF_DEV_ARC_MAX_COUNT) return null;
  const covered = new Set<number>();
  const arcs: SelfDevArc[] = [];
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (typeof group !== 'object' || group === null || Array.isArray(group)
      || !Array.isArray(group.tasks) || !Array.isArray(group.dependsOn)) return null;
    const taskIds: string[] = [];
    for (const number of group.tasks) {
      if (!Number.isInteger(number) || number < 1 || number > tasks.length || covered.has(number)) return null;
      covered.add(number);
      taskIds.push(tasks[number - 1]!.id);
    }
    if (taskIds.length === 0) return null;
    const dependsOn: string[] = [];
    for (const number of group.dependsOn) {
      if (!Number.isInteger(number) || number < 1 || number > groups.length || number - 1 === index) return null;
      const id = `arc-${number}`;
      if (!dependsOn.includes(id)) dependsOn.push(id);
    }
    arcs.push({
      id: `arc-${index + 1}`,
      name: typeof group.name === 'string' && group.name.trim() ? group.name.trim().slice(0, 60) : `Arc ${index + 1}`,
      intent: typeof group.intent === 'string' ? group.intent.trim().slice(0, 300) : '',
      taskIds,
      dependsOn,
    });
  }
  if (covered.size !== tasks.length || hasCycle(arcs)) return null;

  const arcByTask = new Map(arcs.flatMap((arc) => arc.taskIds.map((taskId) => [taskId, arc.id] as const)));
  const dependsTransitivelyOn = (arcId: string, dependencyId: string, seen = new Set<string>()): boolean => {
    if (arcId === dependencyId) return true;
    if (seen.has(arcId)) return false;
    seen.add(arcId);
    return arcs.find((arc) => arc.id === arcId)?.dependsOn.some((id) => dependsTransitivelyOn(id, dependencyId, seen)) ?? false;
  };
  for (const task of tasks) {
    const taskArc = arcByTask.get(task.id)!;
    for (const dependencyId of task.dependsOn ?? []) {
      const dependencyArc = arcByTask.get(dependencyId);
      if (!dependencyArc) return null;
      if (dependencyArc !== taskArc && !dependsTransitivelyOn(taskArc, dependencyArc)) return null;
    }
  }
  const hintDeviation = arcs.length === requestedArcCount
    ? undefined
    : { requested: requestedArcCount, actual: arcs.length };
  return { arcs, ...(hintDeviation ? { hintDeviation } : {}) };
}

export function buildSelfDevArcClassifyPrompt(
  feature: string,
  tasks: readonly SelfDevArcClassifyTask[],
  requestedArcCount: number,
): string {
  return [
    'Group the decomposed self-dev tasks into requested arcs. Arcs are labels and ordering metadata, never execution units.',
    `Feature: ${feature.trim()}`,
    `Requested arcs: ${requestedArcCount}`,
    'Tasks (1-based):',
    ...tasks.map((task, index) => `${index + 1}. ${task.title}${task.description ? ` — ${task.description}` : ''}`),
    'Rules: assign every task exactly once; emit 2 to 6 arcs; dependsOn uses 1-based arc numbers; no cycles; preserve task dependency order across arcs.',
    'STRICT JSON only: {"arcs":[{"name":"...","intent":"...","tasks":[1],"dependsOn":[]}]}.',
  ].join('\n');
}

export function parseSelfDevArcGrouping(raw: string): SelfDevRawArcGroup[] | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { arcs?: unknown };
    return Array.isArray(parsed.arcs) ? parsed.arcs as SelfDevRawArcGroup[] : null;
  } catch {
    return null;
  }
}
