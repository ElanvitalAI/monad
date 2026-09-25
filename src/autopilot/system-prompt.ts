// src/autopilot/system-prompt.ts
//
// MB-12 (2026-05-15) — mission-aware system prompt composition for the
// monad-builtin autopilot runner. 직전 cut 의 빈 systemPrompt 가 LLM
// quality 한계 (mission 의 context 0 · tool 선택 noise) 였음.
//
// 본 helper 는 mission text 의 keyword pattern 으로 5 mission-type 분류
// 후 type-aware system prompt 발행. 다른 backend (ACP CLI) 의 vendor
// 내장 system prompt 와 비교해 monad-builtin path 의 첫 cut quality
// 보강.
//
// Mission types (priority 순):
//   - terminal:  사용자 SwiftTerm 의 직접 조작 (terminal agency mode)
//   - git:       commit · rebase · squash · PR workflow
//   - research:  web search · WebFetch · doc lookup
//   - code:      file edit / refactor / implement / fix
//   - general:   fallback · 모든 tool 사용 가능
//
// 분류 우선순위 — 사용자 mission 가 multi-domain 시 가장 specific 한
// type 우선 (terminal > git > research > code > general).
//
// 사용:
//   const prompt = composeAutopilotSystemPrompt(mission, { terminalAgency: true });
//   const runner = new MonadBuiltinTurnRunner({ ..., systemPrompt: prompt });

import { debug } from '../debug/log.js';

/** Mission classification result — type + matched keyword. */
export interface MissionType {
  /** `terminal` · `git` · `research` · `code` · `general` */
  kind: 'terminal' | 'git' | 'research' | 'code' | 'general';
  /** First keyword that matched — for debug / test pinning. */
  matchedKeyword?: string;
}

/** Classify a mission. Keyword-based · case-insensitive. Korean + English.
 *  MB-15 (2026-05-15) — Korean keyword 대폭 확장. 사용자 own utterance
 *  의 실제 phrase (PFC capture 의 utterance layer) 가 분류 catch 율 ↑. */
export function classifyMission(mission: string): MissionType {
  if (!mission || mission.length === 0) return { kind: 'general' };
  const text = mission.toLowerCase();
  // terminal — sit-in-user-shell verbs. Tmux/vim/nvim 는 강력한 신호.
  for (const kw of [
    'tmux', 'vim', 'nvim', 'less ', 'htop',
    'screen ', 'ssh ', 'sudo ',
    // Korean (MB-15)
    '터미널', '쉘', '콘솔', '명령어', '명령 실행',
  ]) {
    if (text.includes(kw)) return { kind: 'terminal', matchedKeyword: kw.trim() };
  }
  // git — workflow verbs
  for (const kw of [
    'git commit', 'git push', 'git rebase', 'git squash',
    'open pr', 'pull request', 'merge pr', 'branch',
    // Korean (MB-15)
    '커밋', '리베이스', '스쿼시', 'pr 만들', 'pr 올',
    '머지', '푸시', '브랜치', '체크아웃',
  ]) {
    if (text.includes(kw)) return { kind: 'git', matchedKeyword: kw };
  }
  // research — find/lookup/search verbs
  for (const kw of [
    'search', 'find ', 'look up', 'research', 'fetch ',
    // Korean (MB-15)
    '검색', '찾아', '리서치', '조사', '알아봐', '알려줘',
    '문서', '트렌드', '비교', '예제', '레퍼런스',
  ]) {
    if (text.includes(kw)) return { kind: 'research', matchedKeyword: kw.trim() };
  }
  // code — file paths or impl/refactor verbs
  if (/\bsrc\/|\.ts\b|\.swift\b|\.tsx\b|\.js\b|\.py\b|\.go\b/.test(text)) {
    return { kind: 'code', matchedKeyword: 'file-path' };
  }
  for (const kw of [
    'implement', 'refactor', 'fix bug', 'add feature',
    // Korean (MB-15)
    '구현', '리팩토', '버그', '추가', '수정',
    '함수', '클래스', '메서드', '에러', '고쳐', '만들어',
    '작성', '개선', '변경', '제거', '교체',
  ]) {
    if (text.includes(kw)) return { kind: 'code', matchedKeyword: kw };
  }
  return { kind: 'general' };
}

/** Optional context that shapes the prompt — terminal agency mode etc. */
export interface AutopilotPromptContext {
  /** When true, prepend terminal-agency guidance (driver 의 G4 guidance
   *  와 별 — system-level concise reminder · driver prompt 가 inject 하는
   *  raw byte 가이드 보다 high-level). */
  terminalAgency?: boolean;
  /** Mission type override — caller 가 classification 결과를 미리 알 때. */
  missionType?: MissionType;
}

/**
 * Compose a system prompt tailored to the mission. 본 함수 의 출력은
 * `MonadBuiltinTurnRunner({ systemPrompt })` 로 직접 전달.
 *
 * Output 의 first paragraph 는 항상 autopilot 의 role 정의 + tool 사용
 * 통제 — 모든 mission-type 공유. 후속 paragraph 가 type-specific guidance.
 *
 * @param mission 사용자가 보낸 mission text (autopilot loop 의 첫 user prompt)
 * @param ctx 추가 context (terminalAgency · 미리 분류된 missionType)
 */
export function composeAutopilotSystemPrompt(
  mission: string,
  ctx: AutopilotPromptContext = {},
): string {
  const type = ctx.missionType ?? classifyMission(mission);
  const core = CORE_PROMPT;
  const typeSection = TYPE_PROMPTS[type.kind];
  const terminalSection = ctx.terminalAgency ? TERMINAL_AGENCY_REMINDER : '';
  const result = [core, typeSection, terminalSection]
    .filter((s) => s.length > 0)
    .join('\n\n');
  // MB-16 — boundary instrumentation. mission classify 결과 + 합산
  // size 로 dogfood 시 quality regression 빠른 발견.
  if (debug.enabled) {
    debug.log('autopilot.system-prompt', 'compose', {
      kind: type.kind,
      matchedKeyword: type.matchedKeyword ?? null,
      missionLen: mission.length,
      terminalAgency: !!ctx.terminalAgency,
      promptSize: result.length,
    });
  }
  return result;
}

const CORE_PROMPT = `You are monad-builtin autopilot — an autonomous coding agent operating in-process within the user's monad daemon. Each iteration you receive a mission or follow-up prompt and may call any tool from your registered toolset.

Operating principles:
- One tool call per turn unless the task obviously benefits from parallel reads.
- After each tool result, briefly state what you observed and what you'll do next.
- When the task is complete or you need a decision, say so explicitly — the loop terminates on stable success or stuck signal.
- Prefer narrow scopes — don't expand beyond the user's mission.
- Use AskUserQuestion when blocked on a non-obvious choice rather than guessing.`;

const TYPE_PROMPTS: Record<MissionType['kind'], string> = {
  terminal: `Mission classification: TERMINAL.
You may be operating on the user's interactive terminal (terminal agency mode). Shell tool_calls are intercepted by the daemon and forwarded into the user's pty; you will see a screenshot of the terminal state in the NEXT iteration's first image block. Plan for that observation gap — don't assume stdout from a tool_result, read the screenshot.`,
  git: `Mission classification: GIT.
Prefer git_commit for local commits. Reuse existing branches when possible. PR open / merge are user-controlled — surface a draft message and confirm via AskUserQuestion before publishing if unsure.`,
  research: `Mission classification: RESEARCH.
WebSearch and WebFetch are available. Start broad (WebSearch) then narrow (WebFetch specific URLs). Cite sources by URL when summarizing. Avoid restating known facts — use the web when knowledge cutoff matters.`,
  code: `Mission classification: CODE.
Read before Edit (especially for unfamiliar files). When making changes, prefer Edit over Write unless the file is genuinely new. Run focused tests after edits when a test command is obvious. Keep diffs minimal — don't refactor adjacent code that wasn't requested.`,
  general: `Mission classification: GENERAL.
Pick the smallest correct first action. If the mission is ambiguous, ask the user once before proceeding (AskUserQuestion). Avoid scope creep — finish the stated task, then stop.`,
};

const TERMINAL_AGENCY_REMINDER = `Terminal agency note:
- Each shell tool_call gets forwarded to the user's terminal + cancelled here. You won't see tool_result stdout — only the screenshot in the next prompt.
- Pre-flight safety: rm -rf, sudo, git push --force, dd of=/dev/*, curl|bash are blocked by the daemon. Don't try to bypass.
- User can take over at any time — your loop will be cancelled if they tap or type.`;
