import { debug } from '../debug/log.js';
import * as harnessSkillExec from '../harness/skill-exec.js';
import { invokeResearch } from '../research-bridge/invoke.js';
import * as skillIndex from '../skills/index.js';
import type { SkillIndexEntry } from '../skills/index.js';
import { getUserConfig } from '../user-config.js';
import type { LLMToolSpec } from '../llm.js';
import type { ToolRuntime } from './types.js';

export interface SkillExecArgs {
  /** Exact name of the skill to execute. */
  skill: string;
  /** Task text passed verbatim to the named skill. */
  task: string;
}

export interface SkillExecResult extends Record<string, unknown> {
  skill: string;
  output: string;
  ok: boolean;
  error?: string;
}

export type SkillExecIndexProvider = () => readonly SkillIndexEntry[];

let skillExecIndexProvider: SkillExecIndexProvider | null = null;

/** Test seam: inject a skill index (or a throwing getter) so this path never reads user skill dirs. */
export function setSkillExecIndexProvider(provider: SkillExecIndexProvider | null): void {
  skillExecIndexProvider = provider;
}

const REJECT_OUTPUT = (skill: string): string =>
  `자동 실행 대상 아님: ${skill}. 대신 skill-hint 경로를 사용하세요. 이 판정을 넓히려면 skillRouter.harnessExecAllowlist와 HARNESS_EXEC_BLOCK_PATTERNS를 검토하세요.`;

function observe(event: string, data: Record<string, unknown>): void {
  try {
    debug.log('tool-runtime.skill-exec', event, data);
  } catch {
    /* fail-soft — observation must not fail the tool */
  }
}

function obtainSkillIndex(): readonly SkillIndexEntry[] {
  try {
    return (skillExecIndexProvider ?? skillIndex.getSkillIndex)();
  } catch (error) {
    observe('index-unavailable', {
      error: String((error as { message?: string })?.message ?? error).slice(0, 200),
    });
    // Explicit empty index — never `undefined`. Passing undefined would
    // re-evaluate a default `index = getSkillIndex()` and read user skill dirs.
    return [];
  }
}

export function buildSkillExecTool(): LLMToolSpec {
  return {
    name: 'skill_exec',
    description: 'Execute one explicitly named allowlisted skill with the supplied task. If you do not know the exact skill name, call elanous_skills_list first. Does not infer a skill name.',
    parameters: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Exact name of the skill to execute.',
        },
        task: {
          type: 'string',
          description: 'Task text passed to the named skill.',
        },
      },
      required: ['skill', 'task'],
      additionalProperties: false,
    },
  };
}

export async function dispatchSkillExec(args: SkillExecArgs): Promise<SkillExecResult> {
  const { skill, task } = args;
  const extra = getUserConfig().skillRouter.harnessExecAllowlist;
  const index = obtainSkillIndex();
  const allowlist = harnessSkillExec.resolveHarnessExecAllowlist(
    extra,
    (rejected, reason) => observe('allowlist-reject', { skill: rejected, reason }),
    index,
  );

  const declaredSafeCandidates = index
    .filter((entry) => harnessSkillExec.isDeclaredAutoExecSafe(entry))
    .map((entry) => entry.name);
  const declaredSafeAdmitted = declaredSafeCandidates.filter((name) => allowlist.has(name));
  const admitted = allowlist.has(skill);
  const reason = !admitted
    ? 'not-allowlisted'
    : declaredSafeAdmitted.includes(skill)
      ? 'declared-safe'
      : extra.includes(skill)
        ? 'config'
        : 'builtin';
  observe('decision', {
    skill,
    admitted,
    reason,
    extra,
    indexSize: index.length,
    declaredSafeCandidates,
    declaredSafeAdmitted,
  });

  if (!admitted) {
    return {
      skill,
      ok: false,
      output: REJECT_OUTPUT(skill),
    };
  }

  const result = await invokeResearch(task, { skill });
  return {
    skill,
    ok: result.ok,
    output: result.output,
    ...(result.error ? { error: result.error } : {}),
  };
}

export const skillExecRuntime: ToolRuntime<SkillExecArgs, SkillExecResult> = {
  id: 'skill_exec',
  spec: buildSkillExecTool(),
  async run(req) {
    return dispatchSkillExec(req);
  },
};
