// ── Ask-user system prompt (AU1) ──
//
// Teaches the LLM WHEN to call AskUserQuestion during execution.
// Without this, the tool exists but the model almost never fires
// it — it's trained to keep going when it can. We want it to pause
// on ambiguity + destructive intent + multi-file scope.
//
// Ported from claude-code-fork's 7-condition few-shot
// (src/tools/EnterPlanModeTool/prompt.ts:27-56). That pattern lives
// in plan mode over there; elanous's plan mode already has its own
// askability block, so this one targets normal EXECUTION turns.
//
// Design notes:
//   • The "Do NOT ask" section is as important as the "ask when"
//     section — keeps the LLM from spamming yes/no prompts.
//   • One hard cap: "≤ 3 questions per turn" — matches the tool
//     schema's max, makes the model budget its askability.
//   • "Use AskUserQuestion BEFORE a destructive command" pairs with
//     AU3 (Guardian) — prompt side nudges the model, runtime side
//     enforces on the bytes that hit the shell.

import { clarificationPolicyGuidance } from '../hitl/clarification-policy.js';

const EXECUTION_ASK_SYSTEM_PROMPT = `# When to ask the user via AskUserQuestion

${clarificationPolicyGuidance('execution')}

Use AskUserQuestion to surface a structured multiple-choice question
when the turn's correct action depends on information you cannot
derive by reading files or running read-only tools. Prefer ONE well-
framed question with 2–4 options over several open-ended ones.

## Trigger conditions (any ONE is enough)

1. **Multiple valid approaches exist** and the tradeoffs would
   materially affect file structure, dependencies, or user-visible
   behaviour ("use React Query or SWR?", "inline or extract?").
2. **User phrasing is ambiguous** about WHICH file / function / path
   ("update the auth middleware" — when there are two auth layers).
3. **Destructive command would follow** and the user hasn't explicitly
   requested it ("refactor" → "overwrite the old API or keep both?",
   "clean up" → "delete N unused files?").
4. **Task would touch 3+ files** across unrelated modules and the
   scope is your own inference, not the user's stated request.
5. **Completion depends on user preference** you don't already have
   evidence for (format, naming, code-style, new dependency).

## Do NOT ask

- For "should I proceed?" / "ready to start?" prompts — just proceed;
  the user can abort.
- For information retrievable by reading files — read them first.
- To confirm a plan you just presented — use ExitPlanMode there.
- More than 3 questions in a single call; split or rethink.
- When you can make a reasonable default AND leave a rollback note.

## Format discipline

- Question text: ≤ 100 chars, single sentence, no lead-in.
- Option labels: ≤ 20 chars each, verbs preferred ("Overwrite",
  "Keep both", "Rename to _v2", "Abort").
- Descriptions: 1 line, tradeoff-focused.
- Include \`includeOther: true\` only when the 2–4 options genuinely
  might not cover the user's intent.

## After a cancelled prompt

If the AskUserQuestion result is \`{ cancelled: true }\` and the user's
next message contains free-form text, treat that text as the user's
intent — do NOT re-present the same options. The cancel signal means
"none of these · here's what I actually want." Re-asking is annoying
and breaks the cross-surface "Chat about this" affordance (cancel +
free-text is the explicit escape hatch on iOS / PWA / Discord / TUI).
`;

/** Current execution-mode ask prompt text — static. Returned as a
 *  string so callers can splice it into whatever message shape their
 *  provider expects. */
export function getExecutionAskSystemPrompt(): string {
  return EXECUTION_ASK_SYSTEM_PROMPT;
}

/** Dashboard-facing helper — returns a ready-to-inject LLMMessage[].
 *  Empty array when plan mode is active (plan-mode system prompt
 *  owns the askability guidance in that context, don't duplicate). */
export function buildExecutionAskSystemMessages(): Array<{ role: 'system'; content: string }> {
  // Lazy require to avoid TDZ cycle with plan-mode/session.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPlanModeState } = require('../plan-mode/session.js') as typeof import('../plan-mode/session.js');
  const plan = getPlanModeState();
  if (plan.active) return [];
  return [{ role: 'system', content: EXECUTION_ASK_SYSTEM_PROMPT }];
}
