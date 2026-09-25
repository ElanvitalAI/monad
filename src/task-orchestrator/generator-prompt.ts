/**
 * Prompt template for `TaskGenerator.decompose()`.
 *
 * Separated into its own module so:
 *   - Tests can assert structure without pulling the whole generator
 *   - Future localisation / style tweaks don't touch generator logic
 *   - Prompt versioning becomes git-observable
 *
 * The prompt is terse because the LLM must produce STRICT JSON.
 */
import type { DecomposeInput } from './generator.js';
import type { ProposalValidationError } from './generator-schema.js';

export type DecomposePromptProfile = 'goal-author-coarse';

export const GOAL_AUTHOR_COARSE_MAX_SLICES = 6;

export interface BuildPromptOptions {
  maxTasks: number;
  /** Optional caller-specific decomposition policy; absence preserves the mission-fabric default. */
  profile?: DecomposePromptProfile;
  /** ★ 확정 아크 수(Intake clarify arcHint·구조화 배선 2026-07-17) — 있으면 이 수의 아크(작업 묶음)로,
   *  아크당 4~5페이즈로 분해하라고 명시한다. 없으면 종전대로(LLM 재량). 아크 총수 상한 없음. */
  arcCount?: number;
  /** If set, append a corrective section describing prior failures. */
  retryErrors?: ProposalValidationError[];
}

/** Goal kinds for which the planner should prefer `acx-session` over
 *  `subagent` / `terminal-pane`. Free-form lower-cased — the caller
 *  passes whatever PFC has classified the goal as. Recognised values
 *  trigger the recommended-surface section in the prompt. */
const CODING_GOAL_KINDS: ReadonlySet<string> = new Set([
  'coding',
  'code',
  'refactor',
  'agent-driven',
  'agent_driven',
  'agentic',
]);

export function buildDecomposePrompt(
  input: DecomposeInput,
  opts: BuildPromptOptions
): string {
  const constraints = input.constraints ?? {};
  const allowedSurfaces = constraints.allowedSurfaces?.join(' / ') ?? 'any of the 8';
  const preferredSurfaces = constraints.preferredSurfaces?.join(', ') ?? '(none)';
  const budget = constraints.budgetUsdRemaining;

  const lines: string[] = [];
  const isGoalAuthorCoarse = opts.profile === 'goal-author-coarse';
  lines.push(
    'You are the monad-agent Task Orchestrator decomposition planner.',
    isGoalAuthorCoarse
      ? `Break the objective into 1-${GOAL_AUTHOR_COARSE_MAX_SLICES} larger, concrete implementation slices.`
      : 'Break the objective into 3-7 concrete, single-responsibility tasks.',
    '',
    '## Output (STRICT JSON)',
    '{',
    '  "rationale": "2-5 sentences explaining the decomposition",',
    '  "tasks": [',
    '    {',
    '      "index": 0,',
    '      "title": "imperative, ≤80 chars",',
    '      "description": "why + acceptance criteria",',
    '      "surface": { "kind": "llm-direct" | "skill" | "subagent" | "chat-prompt" | "terminal-pane" | "vw-slot" | "cron" | "acx-session", ... },',
    '      "dependsOn": [indices of prior tasks — strictly < own index],',
    '      "priority": "low" | "medium" | "high" | "urgent",',
    '      "isolation": "shared" | "worktree",',
    '      "estimateMs": number,',
    '      "estimateTokens": number,',
    '      "estimateUsd": number,',
    '      "timeoutMs": number,',
    '      "acceptance": {',
    '        "criteria": ["natural-language bullet", ...],',
    '        "checks": [{ "kind": "exit-code" | "file-exists" | "file-contains" | "output-matches" | "shell-zero", ... }]',
    '      }',
    '    }',
    '  ]',
    '}',
    '',
    '## Surface shapes',
    '- llm-direct:    { kind: "llm-direct", prompt: string, systemPrompt?: string, model?: string }',
    '- skill:         { kind: "skill", skillName: string, args?: object }',
    '- subagent:      { kind: "subagent", definitionName: string, prompt: string, model?: string }',
    '- chat-prompt:   { kind: "chat-prompt", question: { header, question, options: [{label, description?}], multiSelect?, includeOther? } }',
    '- terminal-pane: { kind: "terminal-pane", spec: { command?, cwd?, title?, env? } }',
    '- cron:          { kind: "cron", scheduleText: string }',
    '- vw-slot:       { kind: "vw-slot", windowId: string, slotId: string }',
    '- acx-session:   { kind: "acx-session", sessionId: string, agentBrand: "claude-code" | "codex" | "gemini-cli" | "monad-self", prompt: string, model?: string, permissionMode?: "plan" | "auto" | "default", turn?: number, inheritEnv?: boolean }',
    '',
    `## Constraints`,
    `- maxTasks: ${opts.maxTasks}`,
    // ★ 확정 아크 수(Intake clarify)가 있으면 아크 구조를 강제한다. 아크당 4~5페이즈·총수 상한 없음
    //   (대표 2026-07-17). dependsOn 으로 아크 경계를 표현(아크 내 순차·아크 간 의존).
    ...(opts.arcCount !== undefined && opts.arcCount >= 1
      ? [`- arcCount: ${opts.arcCount} arcs. An arc is NOT one summary phase — give each arc the CONCRETE phases its work genuinely needs (typically ~4~5, target ≈${opts.arcCount * 4}~${opts.arcCount * 5} total). ★ This is guidance, NOT a hard floor: prefer FEWER high-value phases over padding to hit a count. Do NOT invent low-value phases (e.g. a separate trivial phase per test scenario / per edge case) just to reach the target — bundle tests with the implementation they cover, and let a phase's value justify its existence. Express arc boundaries via dependsOn (linear chain across arcs). The LAST phase of each arc MUST have an integration acceptance that consumes THIS arc's own prior-phase outputs (e.g. "calls funcX defined in phase N of this arc"), not a local "function exists" check.`]
      : []),
    `- allowedSurfaces: ${allowedSurfaces}`,
    `- preferredSurfaces: ${preferredSurfaces}`,
    budget !== undefined ? `- budgetUsdRemaining: $${budget.toFixed(2)}` : '- budget: (unknown)',
    `- depth: ${input.depth ?? 0} (max 4)`,
    '',
    '## Objective',
    input.objective
  );

  // ── 분해 품질 원칙 (4대 에이전트 교차 반영·RESEARCH-multiphase-decomposition-4agents) ──
  // monad 골격(dependsOn 그래프·acceptance 검증·재귀·비용)은 이미 강함. 여기서 프롬프트
  // 품질만 claude-code/gemini/codex/grok 패턴으로 보강: 복잡도비례·파일경로/재사용·LOC·few-shot.
  lines.push(
    '',
    '## Decomposition quality (follow strictly)',
    '- Complexity-proportional: if the objective is large/ambiguous, make the FIRST task a small "design/spike" task and let later tasks depend on it. Cover background, risk, and rollback in `rationale` for complex objectives.',
    '- Verifiable units: every task MUST have `acceptance.criteria` (natural-language) and, where possible, a deterministic `acceptance.checks` entry (exit-code / file-exists / file-contains). A phase with no way to verify it is a bad phase.',
    '- Name the code: in each `description`, name the concrete files to touch and the existing functions/modules to REUSE (e.g. `src/foo.ts:mkThing`). Do not restate the objective — say HOW.',
    '- ★ REUSE existing, never re-create: if the grounding/codebase context below shows a symbol/file ALREADY EXISTS, the phase MUST reuse it (import / wire / extend) — NEVER emit a phase that "defines/creates/implements" a symbol that already exists (that is duplicate re-implementation, flagged by the critique). Only genuinely NEW symbols get a "create" phase. When unsure whether X exists, phrase the phase as "reuse X if present, else add" and name X exactly.',
    '- ★ Complete dependsOn contracts: if a phase CONSUMES another phase\'s output, that producing phase MUST be in this phase\'s `dependsOn` (by index). A consumer with no dependsOn on its producer looks like an ungrounded/orphan dependency to the critique. Trace every consumed symbol to either grounding (exists) or a dependsOn phase (produced this mission).',
    ...(isGoalAuthorCoarse
      ? [
        '- Coarse scope: permit a larger implementation slice when its related definition, tests, and runtime wiring are necessary for an executable end-to-end path; do not split those related concerns into sibling tasks.',
        '- One implementation run can complete a large multi-file slice, including its tests, so do not split work that fits in one run.',
        '- Keep a coarse slice focused on one executable outcome, but it may combine related implementation concerns and exceed the default small-scope LOC guidance.',
      ]
      : [
        '- Small scope: keep each task ≈≤250 LOC of change. If a step is bigger, split it into sibling tasks or defer to a recursive decompose (depth) rather than one giant task.',
        '- ONE CONCERN PER PHASE: each task should touch a single concern class — investigate / design / add-one-unit / wire-into-existing / verify. If a task mixes ≥3 concern classes (e.g. add a type AND compute values AND wire a runtime path), split it into sibling tasks. A phase must be completable by ONE agent in one focused run.',
        '- SEPARATE DEFINE FROM WIRE: adding a new function/type/export is a SEPARATE task from wiring it into an existing runtime call site. A task that both defines a new symbol AND integrates it across modules tends to leave dead-code (defined but never called) that fails integration gates. Pattern: (a) add the function + its unit test; then (b) a dependent task that wires it into the specific existing call site — name the exact `file.ts:function` to modify.',
      ]),
    '- Explicit order: use `dependsOn` (sibling indices, strictly < own index) to encode real ordering. Independent tasks share no dependency so they can run in parallel.',
    '- Concise titles: imperative, ≤80 chars, single responsibility. The description carries the detail, not the title.',
    '',
    '## Good vs bad (few-shot)',
    'BAD (too coarse, unverifiable, no file/reuse):',
    '  1. Build the feature  2. Add tests  3. Ship it',
    'BAD (bundled define+wire — leaves dead-code, fails integration gate):',
    '  1. Add `routeResearch` + `buildBundle` AND wire them into `runReactiveLens`/`runDig` and publish (one task) ← too many concerns; the new exports end up unwired',
    'GOOD (concrete, ordered, verifiable, define/wire separated):',
    '  0. Spike: map current `parseHeuristicPlan` + `AutopilotPlan` shape; note reuse points (design task, no deps)',
    '  1. Add `phase` field to Task schema in `src/task-orchestrator/types.ts` (dependsOn: [0]; acceptance: file-contains "phase")',
    '  2. Implement `buildBundle` + unit test in `src/foo.ts` — pure, no wiring yet (dependsOn: [1]; acceptance: bun test passes)',
    '  3. Wire `buildBundle` into existing `src/runtime.ts:runReactiveLens` call site (dependsOn: [2]; acceptance: file-contains "buildBundle(" in runtime.ts + bun test)',
    '',
    '## Phase kind-specific spec bar (RIGID — the pre-build critique checks each task by kind; meet its bar so it passes)',
    'Classify each task by kind and satisfy its acceptance bar:',
    '- INVESTIGATE (조사/스파이크/스캔): acceptance names the concrete artifacts to find — files, symbols, constraints WITH source location. Not "researched X". A design/impl phase may depend on it.',
    '- DESIGN/CONTRACT (설계/정의/계약): acceptance ENUMERATES every item the design must decide (fields, states, boundaries, rules, error shapes). The concrete VALUES are this phase\'s OUTPUT (fine to be undecided) — but the LIST of items to decide MUST be explicit and complete. (The critique passes a design phase when items are enumerated; it fails one that omits items.)',
    '- IMPLEMENT (구현/작성/배선): DECIDE the concrete inputs the code needs — DO NOT leave them open. Pin the allowed input domain (exact hosts/schemes/paths/ports), the error & edge types, boundary values, and the success condition, right in this phase. e.g. for a URL classifier: "allow youtube.com|youtu.be|m.youtube.com (watch/shorts/embed); reject others as unsupported_source{code,msg}". Leaving "which hosts? which schemes?" open is a bad impl phase (critique will flag under_specified — justly). Pair each new export with unit test cases (normal + error path).',
    '- VERIFY (검증/회귀/검토): acceptance names the prior-phase outputs it integrates and the assertion that proves the flow end-to-end (reference the upstream task by what it produced).',
    '- Upstream contracts: if this phase CONSUMES a contract that a prior dependsOn phase defines, you need not restate that contract here — but you MUST name the dependsOn phase so the critique sees the dependency (avoids false "under-specified").',
    '- ★ DEPENDENCY COMPLETENESS (RIGID — else the critique flags "ungrounded / 미충족 의존"): for EVERY new symbol this phase CONSUMES (calls / wires / tests / imports) that another phase creates, the CREATING phase MUST appear in this phase\'s dependsOn. Trace each consumed new symbol back to its producer phase and put that index in dependsOn. If NO phase in the whole plan produces a symbol you consume, either (a) add a producer phase before it and depend on it, or (b) have this phase itself produce it — NEVER consume a new symbol (e.g. `ContentRecord`, `parseUrl`, `absorbYoutube`) that no dependsOn phase creates. Concretely: a wire/verify phase MUST dependsOn EVERY define phase whose export it uses (not just the immediately prior one). Self-check before returning: for each phase, is every consumed cross-phase symbol produced by something in its dependsOn closure?',
  );

  if (isGoalAuthorCoarse) {
    lines.push(
      '',
      '## Goal-author coarse slicing (follow strictly)',
      '- Prefer fewer, larger implementation slices over small single-concern tasks; use the task budget as a ceiling, not a target.',
      '- Keep related definition, tests, and runtime wiring together when they are required to make one implementation slice executable end-to-end.',
      '- A slice may cover multiple related concerns and a larger change scope when splitting them would leave a definition unwired or an execution path incomplete.',
      '- Every slice title MUST name at least one actual file path or function name because only the title is passed to the next stage; coarse slices must remain grounded and verifiable.',
      '- Fold non-code investigation or design into the implementation slice that needs it; do not emit it as a standalone slice.',
      '- Use dependsOn only for genuine ordering between independently completable slices; do not split related definition and runtime wiring merely to create sibling tasks.',
    );
  }

  // AXON P6 wrap-up (B1) — when the caller knows the goal flavour and
  // it's a coding-style objective, nudge the planner toward
  // `acx-session` instead of `subagent` / `terminal-pane`. Coding /
  // refactor goals benefit from external coding-agents driven through
  // DualRoleManager (claude-code, codex, gemini-cli) — the dispatcher
  // already wires that path via `acx-session-callable`.
  if (input.goalKind && CODING_GOAL_KINDS.has(input.goalKind.toLowerCase())) {
    lines.push(
      '',
      '## Recommended surface for coding/refactor goals',
      'When a task within this objective involves code editing, build / test execution, or',
      'agent-driven exploration, prefer surface kind "acx-session" with an appropriate',
      '`agentBrand` ("claude-code", "codex", "gemini-cli", or "monad-self"). The orchestrator drives',
      'the agent through the DualRoleManager which handles streaming, permissions, and',
      'reentrancy. Use "subagent" only when no live ACP session is suitable, and',
      '"terminal-pane" only for pure shell commands without LLM assistance.',
    );
  }

  if (input.context?.priorResults && input.context.priorResults.length > 0) {
    lines.push('', '## Prior results');
    for (const p of input.context.priorResults.slice(0, 10)) {
      lines.push(`- [${p.taskId}] ${p.title}: ${p.output.slice(0, 200)}`);
    }
  }

  if (input.context?.attachedFiles && input.context.attachedFiles.length > 0) {
    lines.push('', '## Attached files');
    for (const f of input.context.attachedFiles) {
      lines.push(`- [${f.kind}] ${f.path}${f.summary ? ` — ${f.summary}` : ''}`);
    }
  }

  if (input.context?.activeSummary) {
    lines.push('', '## Active goal summary', input.context.activeSummary);
  }

  if (opts.retryErrors && opts.retryErrors.length > 0) {
    lines.push('', '## Retry: prior output failed validation — FIX these errors');
    for (const e of opts.retryErrors) {
      lines.push(`- [${e.code}]${e.taskIndex !== undefined ? ` task[${e.taskIndex}]` : ''} ${e.message}`);
    }
    lines.push('', 'Return ONLY valid JSON matching the schema. No prose outside the JSON.');
  } else {
    lines.push('', 'Return ONLY valid JSON. No prose outside.');
  }

  return lines.join('\n');
}
