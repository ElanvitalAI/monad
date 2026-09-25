// ── URL route curation (the "UX 정제 에이전트") ──
//
// PLAN-url-triage-routing-2026-07-22 · P4b (UX refinement per 대표 2026-07-22).
//
// executeSkill runs the skill through an LLM tool-loop that narrates its
// Bash calls + progress ("⏺ Bash(…)", "[1/3] Supadata…", "라우트:…",
// "Agent(Summarize…)"). Streaming that raw to a chat surface buries the
// actual summary in process noise. This module curates each stage's raw
// output into a clean, send-ready message:
//   - quick / summary  → a distilled clean 요약 (LLM-backed, strip fallback)
//   - detailed / absorb → just the Obsidian link (the detailed text already
//     lives in the vault — no need to dump it into chat)

import { streamLLM, type LLMMessage } from '../llm.js';

/** Pull the saved Obsidian .md path out of a noisy skill run. The skills
 *  print "저장 완료: <path>" / "저장 위치: <path>" / "Obsidian 저장 완료\n<path>".
 *  Falls back to the first vault-looking absolute .md path. */
export function extractObsidianPath(raw: string): string | null {
  if (!raw) return null;
  const labeled = raw.match(/(?:Obsidian\s*저장\s*완료|저장\s*(?:완료|위치))\s*[:：]?\s*\n?\s*(\/[^\n]+?\.md)/i);
  if (labeled?.[1]) return labeled[1].trim();
  const bare = raw.match(/(\/[^\s"'`\n]+\/[^\s"'`\n]*\.md)/);
  return bare?.[1] ? bare[1].trim() : null;
}

/** Deterministic strip of skill-execution process lines. Used as the
 *  distiller's pre-filter and as the fallback when the LLM call fails. */
export function stripProcessNoise(raw: string): string {
  return raw
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true;
      if (/^[⏺⎿]/.test(t)) return false;                          // tool-call / result glyphs
      if (/^Bash\(|^Agent\(/.test(t)) return false;
      if (/^\[\d+\/\d+\]/.test(t)) return false;                   // [1/3] progress
      if (/^(메타데이터\s*조회|라우트\s*:|이유\s*:|아티팩트\s*저장|저장\s*완료\s*:|학습노트\s*저장\s*:|저장\s*위치\s*:)/.test(t)) return false;
      if (/^(Supadata|Cloud\s*STT|Prompt\s*:)/.test(t)) return false;
      if (/npx\s+tsx|scripts\/main\.ts/.test(t)) return false;     // raw CLI echoes
      // skill-specific pipeline markers (youtube-master / omni-digest)
      if (/^(요약\s*생성\s*중|xAI\s*요약\s*모델|요약\s*완료|자막\s*조회|전사\s*중|--?-?BEGIN[_A-Z]*|--?-?END[_A-Z]*|\[Sections\]|\[Timeline\])/.test(t)) return false;
      if (/^(구현\s*파이프라인|.*하겠습니다\.?$|.*확인하겠습니다\.?$|.*생성하겠습니다\.?$)/.test(t)) return false; // executeSkill narration
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Distill a noisy skill run into a clean Korean summary for a chat
 *  surface. LLM-backed; deterministic strip is the fallback on any error
 *  (or when no classifier/provider is available). */
export async function distillSummary(
  raw: string,
  opts: { signal?: AbortSignal; model?: string } = {},
): Promise<string> {
  const stripped = stripProcessNoise(raw);
  if (!stripped) return raw.trim().slice(0, 1200);
  // Only skip the LLM for genuinely tiny + clean text (a one-liner with no
  // residual pipeline markers). Everything else gets distilled — skill
  // outputs carry format markers ([Sections], ---BEGIN…) a strip can't
  // fully anticipate, so the LLM is the robust path.
  const hasMarker = /[⏺⎿]|\[\d\/\d\]|BEGIN_|\[Sections\]|요약\s*생성|xAI/.test(stripped);
  if (stripped.length < 240 && !hasMarker) return stripped;
  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          '너는 요약 정제기다. 입력에는 스킬 실행 과정(Bash 호출·진행 로그·라우트 정보·에이전트 스폰)과 최종 요약이 섞여 있다. '
          + '실행 과정·로그·도구 흔적·파일 경로를 모두 제거하고, 사용자에게 바로 보낼 깨끗한 한국어 요약만 출력하라. '
          + '메타 설명("~하겠습니다"·"실행합니다") 없이 요약 본문만. 원문에 없는 내용은 지어내지 마라.',
      },
      { role: 'user', content: stripped.slice(0, 8000) },
    ];
    const out = await streamLLM(messages, () => {}, {
      maxTokens: 900,
      temperature: 0.2,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return out.trim() || stripped;
  } catch {
    return stripped;
  }
}
