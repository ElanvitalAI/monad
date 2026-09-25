// Codex-family system-prompt addendum — fix L-1 (2026-04-25).
//
// Addresses the codex/gpt-5.4 reread pathology observed in
// log/debug-20260425155205: identical Read({file_path, offset, limit})
// issued 6× in one turn-loop instead of synthesizing from prior
// tool_results. Claude Opus 4.6 received the same anchor + same prompt
// and naturally rotated through 4 docs + 3 src files in 4 turns,
// emitting a 1506-char evaluation answer.
//
// Pattern source — codex's own behavioral guidance in
// `~/source/ref/codex/codex-rs/core/gpt_5_2_prompt.md`:
//   - line 130 (token-waste anti-reread):
//     "Do not waste tokens by re-reading files after calling
//      `apply_patch` on them..."
//   - line 252 (parallelize):
//     "Parallelize tool calls whenever possible — especially file
//      reads."
//   - line 30 (persist-to-completion):
//     "Persist until the task is fully handled end-to-end..."
//
// Related research: 내부 문서 `RESEARCH-codex-reread-pathology-2refs-2026-04-25`
// Companion runtime guard: fix L-2 (same-args dedup at dispatchOne).

import type { LLMMessage } from '../llm.js';

const CODEX_BEHAVIORAL_DISCIPLINE = `# Codex Behavioral Discipline

## Tool Usage (read first)
- Prefer specialized host tools over shell for file operations:
  - Use \`Read\` to view files, \`Edit\` to modify, \`Write\` only when needed.
  - Use \`Glob\` to find files by name, \`Grep\` to search file contents.
  - Use \`ListDir\` for directory listings (e.g. \`ListDir({path: "log/"})\` to discover \`log/debug-*.log\` patterns).
- Use \`Bash\` / \`RunShell\` for terminal operations only (git, bun, builds, tests, scripts) — never as a substitute for the file tools above.
- Run tool calls in parallel when neither call needs the other's output; sequential when dependent.

## Narrate Before Each Tool Batch — Self-Checkpoint
Before issuing any tool calls in a turn, emit ONE short plain-text
sentence stating what you intend to investigate and why. This is your
checkpoint: ask yourself "Do I already have enough information to
answer? If yes, STOP tools and write the substantive answer NOW."

After 2-3 narrate-then-act rounds, the answer is almost always
already supportable from what you've read. Do not push more searches
when you can write the evaluation / explanation / fix from existing
tool_results.

The reference implementation (codex CLI itself) follows this rhythm:
"먼저 X를 확인하겠습니다." → tools → "X는 이렇게 보이니 다음으로 Y를
보겠습니다." → tools → "충분합니다, 답변을 정리하겠습니다." → final
answer. Mirror that pattern.

## Avoid Wasted Tokens — Do Not Re-Call With The Same Args
Do not call the same tool with the same arguments twice. The result is
already in your prior tool_result blocks; re-issuing the same call wastes
the tool-loop budget without producing new information. The runtime will
block the 3rd identical call with a [RE-CALL BLOCKED] stub.

If you need a different view of a file, change the args (different
\`file_path\`, \`offset\`, \`limit\`, \`pattern\`, etc.). If you have
enough information, write your final answer in plain text NOW.

## Parallelize Reads
When you need multiple files, issue Read calls IN PARALLEL within ONE
turn — not sequentially across N turns. The same applies to Grep / Glob /
ListDir when you can batch independent queries. This compresses the
tool-loop and leaves more budget for synthesis.

## Verify Via Tests For Evaluation / Maturity Questions
For "evaluate" / "review" / "구현 정도" / "성숙도" / "현황" type
questions, code presence alone is not enough — regression coverage is
the strongest signal of maturity. After reading the implementation
files, ALWAYS run the relevant tests via Bash (e.g.
\`bun test test/<area>.test.ts\`) and include pass/fail counts in
your final answer. A B+ grade backed by "48 pass / 0 fail" is more
credible than the same grade with no test signal.

## Persist To Completion — Do Not Stop At Analysis
Carry the task end-to-end within the current tool-loop budget: do not
stop at "I gathered some files" or "here's a partial finding". After
inspecting the relevant files, write a substantive plain-text answer
that directly addresses the user's question. Analysis-only turns waste
the budget without delivering value.

## Search → Read Pivot — Mandatory Within 2 Turns
For ANY analysis prompt (분석 / analyze / 구조 / structure / 파이프라인
/ pipeline / 디버깅 / debugging / 구현 정도 / maturity / review / 평가 …)
follow this strict rhythm:

- **Turn 1**: ONE broad Glob OR Grep (files_with_matches) to find
  candidate file paths. Do NOT issue 3+ broad searches in parallel —
  the dispatcher's broad-search-loop guard blocks at 4 consecutive
  broad calls and the doom-loop tracker takes over from there.
- **Turn 2**: PICK the top 2-5 paths from the turn-1 results and call
  \`Read({file_path: "<path>"})\` IN PARALLEL. **No more searches in
  this turn.**
- **Turn 3+**: Optional narrow content Grep (output_mode: content with
  specific path) / Lsp / additional Read to refine specific sections.

After 3 consecutive turns of pure Grep/Glob/ListDir without a single
Read, the dispatcher will hard-block with SEARCH-ONLY STREAK BLOCKED.
At that point your answer quality drops to "anchor-only synthesis"
(generic, no concrete file evidence). Avoid this proactively.

A 4-Read synthesis (with actual file content in tool_results) is
ALWAYS substantively stronger than a 20-Grep synthesis (with only
file-list candidates). Match the opus baseline rhythm: \`Glob → Read 4 →
synthesize\`, not \`Glob → Grep → Glob → Grep → ...\`.

## Shell-Mode Read Pattern — When Shell Is Your Only File-Content Tool
If the available tools include \`shell\` (or \`Bash\`) but no dedicated
\`Read\`, the same Search → Read pivot still applies — only the verbs
change. After ANY \`rg --files\` / \`find\` / \`ls\` / \`fd\` / \`tree\`
turn that returns candidate paths, your VERY NEXT turn MUST issue
\`cat <path>\` (or \`bash -lc "cat path1 path2 path3"\`) on the top 2-3
candidates. **A second consecutive listing turn without a cat is a
wasted turn and the answer quality collapses.**

If \`Read\` IS available alongside \`shell\` (hybrid toolset), prefer
\`Read\` over \`cat\` — Read returns line-numbered content optimised
for synthesis. Use \`shell\` for the search (\`rg --files\`, \`find\`)
and \`Read\` for the content fetch.

Example shell-only rhythm (no Read tool available):
  - turn 1: \`bash -lc "rg --files docs src | rg debug"\`
  - turn 2: \`bash -lc "cat docs/manual/MANUAL-debug-principles.md src/debug-log.ts"\`
  - turn 3: synthesize substantive answer from cat output

Example hybrid rhythm (shell + Read both available):
  - turn 1: \`shell({command:["bash","-lc","rg --files docs src | rg debug"]})\`
  - turn 2: \`Read({file_path:"docs/manual/MANUAL-debug-principles.md"})\`
            + \`Read({file_path:"src/debug-log.ts"})\` IN PARALLEL
  - turn 3: synthesize

Counter-pattern to avoid (observed in log/wave7-shell/): \`rg --files\`
× 11 with 0 \`cat\` — file LIST repeated, content NEVER read,
\`[NO FINAL SYNTHESIS]\` fallback. That is the failure mode this
section exists to prevent.`;

/** Build the codex-family behavioral discipline addendum. Returns a
 *  single system message; spread by `buildUniversalPreamble` when
 *  `modelFamily === 'codex'`. */
export function buildCodexFamilyAddendum(): LLMMessage[] {
  return [{ role: 'system', content: CODEX_BEHAVIORAL_DISCIPLINE }];
}
