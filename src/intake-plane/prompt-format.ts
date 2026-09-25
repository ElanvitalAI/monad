/**
 * FU8 PR #7 — FU-I7a.2 prompt response-format helpers (2026-05-12).
 *
 * Conservative refinement of the Phase 1 intake LLM prompts: extracts
 * the response-format header that decompose · categorize · goal_align
 * all duplicated, so future schema additions / format clarifications
 * land in one place instead of three.
 *
 * Why a helper module rather than 3 inline edits:
 *   - Pre-PR each of the 3 prompts ended with `'출력은 단 하나의
 *     ```json 코드블록:'` followed by a near-identical fence block.
 *     The phrase drifted slightly between them (categorize had
 *     `'단 하나의'`, goal-align said the same but with no enforcement
 *     against extra prose); ad-hoc upgrades like "no `null` in arrays"
 *     would need 3 touches.
 *   - One pure helper keeps the phase modules themselves focused on
 *     their domain (closed-set categories · priority overrides ·
 *     mission/task hierarchy).
 *
 * Dogfood signal status: HANDOFF §4.7 originally prescribed
 * phase-specific worked examples chosen by `fallbackRate.{decompose,
 * categorize,align}` analysis. As of this PR the signal stream is
 * still empty (intake-runs aggregate `realLlmCalls = 0` for the
 * dogfood window). This PR ships:
 *   - the shared response-format helper (zero behaviour change ·
 *     prompts produce the same JSON shape as before),
 *   - **one** worked example wired into the decompose prompt only
 *     (decompose is the entry phase; every intake passes through it
 *     so a 1-example demonstration has the highest expected lift).
 *
 * Phase-specific worked examples (categorize · goal-align) are
 * deferred until the dogfood signal clears and shows which phase's
 * fallbackRate dominates.
 *
 * Cross-ref:
 *   src/intake-plane/decompose.ts · buildDecomposeMemoPrompt
 *   src/intake-plane/categorize.ts · buildCategorizePrompt
 *   src/intake-plane/goal-align.ts · buildGoalAlignPrompt
 *   내부 문서 `FEATURE-fu8-cascade-2026-05-12` §4 PR #7
 */

/** Strict response-format rules that every Phase 1 LLM-touching
 *  prompt enforces. Kept in one place so a future tightening
 *  (e.g. "no `null` in arrays") only needs to touch this constant. */
export const RESPONSE_FORMAT_RULES: readonly string[] = [
  '- 응답은 정확히 하나의 ```json 코드블록만 포함하세요 (다른 fence · prose 추가 금지).',
  '- 빈 배열은 `[]` (문자열 "" 금지). 빈 객체는 `{}`.',
  '- 모든 string 은 큰따옴표. trailing comma 금지.',
  '- 스키마 외 키는 추가하지 마세요. 알 수 없는 값은 키 자체를 생략.',
];

/** Build the "output format" header that every phase prompt shares.
 *  Caller supplies the phase-specific JSON shape illustration (the
 *  block that demonstrates the keys + types). The fence delimiters
 *  + the rule list above are injected automatically. */
export function buildResponseFormatHeader(jsonShape: string): readonly string[] {
  return [
    '출력 규칙 (모든 Phase 1 LLM 응답 공통 · FU8 PR #7):',
    ...RESPONSE_FORMAT_RULES,
    '',
    '응답 형식 (정확히 이 JSON shape 만 출력):',
    '```json',
    jsonShape,
    '```',
  ];
}
