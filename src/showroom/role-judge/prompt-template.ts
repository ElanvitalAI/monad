// R6 Task 5 · §6.1 LLM-judge — prompt template (2026-05-09).
//
// JSON-output classification prompt for the small local LLM tier
// (gemma-4-e4b primary · 26b-a4b fallback). Few-shot examples cover
// the four canonical roles plus two ambiguous cases the user has
// flagged historically ("코드 한번 봐줘" → review · "이거 다시 생각
// 해보자" → reflect).
//
// The prompt is deliberately compact (≤ 200 tokens) so the local
// model's TTFT stays small — we only need a single classification
// token to be useful, not narrative reasoning.

export type RoleLabel = 'plan' | 'exec' | 'review' | 'reflect';

export interface BuildPromptArgs {
  userPrompt: string;
  /** Optional list of role labels actually mounted in the showroom.
   *  Used by the prompt to remind the model that other roles aren't
   *  represented; the model may still emit them, the caller decides
   *  whether to fall back to broadcast. */
  availableRoles?: readonly RoleLabel[];
}

const SYSTEM_PROMPT = `You classify a single user request into ONE of four roles: plan, exec, review, reflect.

Rules:
- Pick the role that BEST matches the user's verb / intent.
- "plan" = strategy or design BEFORE writing code · 어떻게 할까 / 설계 / 기획.
- "exec" = imperative do / build / write / run NOW · 구현해줘 / 작성해줘 / 실행 / 만들어줘.
- "review" = examine / inspect / verify EXISTING work · 봐줘 / 살펴 / 리뷰 / 검토 / 점검 / PR 리뷰.
- "reflect" = retrospective on PAST work · 회고 / 돌아보 / 다시 생각해보자 / "이번 sprint 회고".
- "검토" = review (examine an existing artefact). NOT reflect.
- "회고" = reflect (retrospective on completed period). NOT review.
- Reply with ONLY a single JSON object: {"role":"<plan|exec|review|reflect>"}.
- No prose, no markdown fence, no whitespace before or after the JSON.`;

const FEW_SHOT_EXAMPLES: ReadonlyArray<{ user: string; assistant: string }> = [
  { user: '이 함수 어떻게 짜야할까?', assistant: '{"role":"plan"}' },
  { user: '이 코드 작성해줘', assistant: '{"role":"exec"}' },
  { user: '이 PR 리뷰', assistant: '{"role":"review"}' },
  { user: '이 sprint 회고', assistant: '{"role":"reflect"}' },
  { user: '코드 한번 봐줘', assistant: '{"role":"review"}' },
  { user: '이거 다시 생각해보자', assistant: '{"role":"reflect"}' },
];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Build the chat-style messages array passed to the LM Studio /v1/
 *  chat/completions endpoint. Pure — no transport. Returns the
 *  finished list so callers can also log / cache it. */
export function buildJudgePromptMessages(args: BuildPromptArgs): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const ex of FEW_SHOT_EXAMPLES) {
    messages.push({ role: 'user', content: ex.user });
    messages.push({ role: 'assistant', content: ex.assistant });
  }
  // Optional reminder of the room's actual roles.
  const tail = args.availableRoles && args.availableRoles.length > 0
    ? `${args.userPrompt}\n\n(rooms in this showroom: ${args.availableRoles.join(', ')})`
    : args.userPrompt;
  messages.push({ role: 'user', content: tail });
  return messages;
}

/** Parse the local model's reply into a role label. Tolerant of
 *  trailing whitespace / leading code fence / accidental trailing
 *  prose so callers don't need extra try-catch around the JSON parse.
 *  Returns null when the reply can't be coerced. */
export function parseJudgeReply(raw: string): RoleLabel | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Strip markdown fences if the model added them despite the
  // prompt's ban.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  // Locate the first JSON object — the model occasionally prefixes
  // a stray punctuation mark.
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = stripped.slice(start, end + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(slice); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const role = (parsed as { role?: unknown }).role;
  if (role !== 'plan' && role !== 'exec' && role !== 'review' && role !== 'reflect') {
    return null;
  }
  return role;
}
