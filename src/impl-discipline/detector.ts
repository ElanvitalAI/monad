// Phase detector for implementation discipline.
//
// Given the current turn's user text, classify into one of three
// phases. The system-prompt builder reads this result to decide
// which discipline guidance (if any) to inject as a system message.
//
// Rules (PLAN §3):
//   plan-loaded         — PLAN-*.md / HANDOFF-*.md / SPEC-*.md file-ref
//                         OR Korean/English doc keyword (핸드오프, 플랜
//                         문서, handoff, plan doc, 스펙 문서).
//   implementation-ready — starts with an implementation verb
//                         (구현/implement/build/포팅/port/만들어) AND
//                         NOT paired with an exploration verb
//                         (설명/분석/리뷰).
//   idle                — everything else.
//
// plan-loaded wins over implementation-ready when both would fire —
// when a plan doc is in play, the LLM must read-and-confirm before
// diving into edits, even if the user also said "구현해".

import type { DetectInput, ImplPhase } from './types.js';

// File-ref patterns — deliberately anchored to the naming convention
// used in this repo (PLAN-xxx.md, HANDOFF-xxx.md, SPEC-xxx.md). A bare
// "PLAN.md" or "notes.md" does NOT trigger; the user might be asking
// a generic question about a file that happens to share the name.
const FILE_REF_RE = /\b(?:PLAN|HANDOFF|SPEC)-[\w-]+\.md\b/i;

// Keyword fallback — for cases where the user paraphrases ("핸드오프
// 따라 구현해줘") without spelling out a filename.
const DOC_KEYWORDS = [
  '플랜 문서',
  '핸드오프',
  '스펙 문서',
  'plan doc',
  'handoff',
  'spec doc',
];

const IMPL_VERB_RE = /(^|[\s\u3000])(구현|implement|build|포팅|port|만들어)/i;

// Exploration verbs that, when co-occurring with an implementation
// verb, downgrade the turn to idle. "이 함수 구현 방식 분석해줘"
// should not trigger implementation-ready — the user wants analysis,
// not edits.
const EXPLORE_VERB_RE = /(분석|리뷰|설명|review|analyze|explain)/i;

function hasDocKeyword(lower: string): boolean {
  for (const kw of DOC_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

export function detectImplPhase(input: DetectInput): ImplPhase {
  const raw = input.text ?? '';
  const trimmed = raw.trim();
  if (!trimmed) return 'idle';
  const lower = trimmed.toLowerCase();

  if (FILE_REF_RE.test(trimmed) || hasDocKeyword(lower)) {
    return 'plan-loaded';
  }

  if (IMPL_VERB_RE.test(trimmed) && !EXPLORE_VERB_RE.test(trimmed)) {
    return 'implementation-ready';
  }

  return 'idle';
}
