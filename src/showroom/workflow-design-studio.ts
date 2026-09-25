// W9 Z6 · Workflow Design Studio — 4-pane showroom (architect/executor/critic/tester).
// Cf. ROADMAP-showroom-x-task-fabric §4 Z6.

import type { ShowroomLaneCallable } from '../task-orchestrator/surfaces/showroom-surface.js';
import { validateWorkflow } from '../workflow-runtime/schema.js';

export type DesignLaneRole = 'architect' | 'executor' | 'critic' | 'tester';

export const DESIGN_LANE_ROLES: readonly DesignLaneRole[] = [
  'architect', 'executor', 'critic', 'tester',
];

const SHOWROOM_ROLE: Record<DesignLaneRole, 'plan' | 'build' | 'review' | 'reflect'> = {
  architect: 'plan',
  executor: 'build',
  critic: 'review',
  tester: 'reflect',
};

export interface DesignLaneSpec {
  role: DesignLaneRole;
  model: string;
  promptAddendum?: string;
}

export interface WorkflowDesignInput {
  /** When set, the studio diffs against this YAML; otherwise pure design. */
  currentYaml?: string;
  /** User goal — "add a slack notify after the build node". */
  goal: string;
  /** Free-form context (recent runs · pin notes). */
  context?: string;
  lanes: DesignLaneSpec[];
  signal?: AbortSignal;
}

export interface DesignLaneResult {
  role: DesignLaneRole;
  model: string;
  /** Lane proposal — YAML or commentary depending on role. */
  text: string;
  /** True when text appears to contain a YAML proposal (architect/executor). */
  hasYaml: boolean;
  modelId?: string;
}

export interface ValidatedProposal {
  yaml: string;
  ok: boolean;
  issues: string[];
}

export interface WorkflowDesignReport {
  goal: string;
  lanes: DesignLaneResult[];
  /** Picked YAML proposal (executor preferred · architect fallback). */
  proposedYaml: string | null;
  /** Validation outcome of the picked proposal. */
  proposal: ValidatedProposal | null;
  /** Critic + tester open issues distilled. */
  openIssues: string[];
  createdAt: number;
}

export interface WorkflowDesignDeps {
  laneCallable: ShowroomLaneCallable;
  now?: () => number;
}

function buildLanePrompt(role: DesignLaneRole, input: WorkflowDesignInput, lane: DesignLaneSpec): string {
  const goal = `Goal:\n${input.goal}`;
  const cur = input.currentYaml
    ? `\n\nCurrent workflow YAML:\n${input.currentYaml}`
    : '\n\n(no existing workflow · greenfield design)';
  const ctx = input.context ? `\n\nContext:\n${input.context}` : '';
  const add = lane.promptAddendum ? `\n\n${lane.promptAddendum}` : '';
  const roleInstr: Record<DesignLaneRole, string> = {
    architect: 'You are the architect. Propose the top-level workflow YAML shape (nodes + dependencies + main provider/model). Output YAML only, fenced as ```yaml ... ```.',
    executor: 'You are the executor. Refine the architect proposal into a runnable workflow YAML. Output YAML only, fenced as ```yaml ... ```.',
    critic: 'You are the critic. List up to 5 concrete issues (bullets) about the proposal — risks, missing nodes, brittle paths. No YAML.',
    tester: 'You are the tester. Propose 3 verify checks (inputs + expected outputs). Output as `- check: <name>: <inputs> → <expected>`. No YAML.',
  };
  return `${roleInstr[role]}\n\n${goal}${cur}${ctx}${add}`;
}

function extractYaml(text: string): string | null {
  const fence = text.match(/```yaml\s*\n([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  if (text.includes('\nname:') && text.includes('\nnodes:')) {
    return text.trim();
  }
  return null;
}

function looseYamlToObject(yaml: string): unknown {
  // The studio only needs validateWorkflow to run — keep parsing minimal,
  // fall back to letting validateWorkflow reject when shape is malformed.
  // Production wiring may swap in `parseYaml` from the 'yaml' package
  // when stricter checks land; for now we accept a single root mapping
  // via a tiny hand-roll (kept to keep this module free of import cycles).
  try {
    // Re-use the existing parser by dynamic-require to avoid hard coupling.
    // Tests inject a known-good YAML so this branch is exercised end-to-end.
    const yamlMod = require('yaml') as typeof import('yaml');
    return yamlMod.parse(yaml);
  } catch {
    return null;
  }
}

function validateProposal(yaml: string | null): ValidatedProposal | null {
  if (!yaml) return null;
  const raw = looseYamlToObject(yaml);
  if (!raw || typeof raw !== 'object') {
    return { yaml, ok: false, issues: ['yaml parse failed or not an object'] };
  }
  const result = validateWorkflow(raw);
  if (result.ok) return { yaml, ok: true, issues: [] };
  return { yaml, ok: false, issues: result.issues.map((i) => `${i.path}: ${i.message}`) };
}

function bulletsFromCritic(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[-•*]\s+(.+)$/);
    if (m && m[1]) out.push(m[1].trim());
    if (out.length >= 5) break;
  }
  return out;
}

export async function runWorkflowDesignStudio(
  input: WorkflowDesignInput,
  deps: WorkflowDesignDeps,
): Promise<WorkflowDesignReport> {
  const now = deps.now ?? Date.now;
  const runs = await Promise.allSettled(
    input.lanes.map(async (lane) => {
      const out = await deps.laneCallable({
        role: SHOWROOM_ROLE[lane.role],
        model: lane.model,
        prompt: buildLanePrompt(lane.role, input, lane),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const yaml = extractYaml(out.text);
      return {
        role: lane.role,
        model: lane.model,
        text: out.text,
        hasYaml: yaml !== null,
        ...(out.modelId ? { modelId: out.modelId } : {}),
      } as DesignLaneResult;
    }),
  );
  const lanes: DesignLaneResult[] = [];
  for (const r of runs) if (r.status === 'fulfilled') lanes.push(r.value);

  const executor = lanes.find((l) => l.role === 'executor' && l.hasYaml);
  const architect = lanes.find((l) => l.role === 'architect' && l.hasYaml);
  const picked = executor ?? architect;
  const proposedYaml = picked ? extractYaml(picked.text) : null;
  const proposal = validateProposal(proposedYaml);

  const critic = lanes.find((l) => l.role === 'critic');
  const tester = lanes.find((l) => l.role === 'tester');
  const openIssues: string[] = [];
  if (critic) openIssues.push(...bulletsFromCritic(critic.text));
  if (tester) openIssues.push(...bulletsFromCritic(tester.text).map((s) => `tester: ${s}`));

  return {
    goal: input.goal,
    lanes,
    proposedYaml,
    proposal,
    openIssues,
    createdAt: now(),
  };
}
