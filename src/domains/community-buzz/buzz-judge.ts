// ── Tier1 로컬 LLM 배치 판정 · 버즈 P2a · 2026-07-09 ──────────────────────────
//
// PLAN §3b Tier1. Tier0(정규화·빠른기법)이 못 잡는 것 — 문맥 긍부정·스팸/도배·중요도 —
// 을 로컬 LLM 배치 1콜로 판정. 프롬프트는 순수 ASCII+한글(feedback_agent_prompt_ascii_only).
// 파서는 순수 helper 분리 + 단위테스트(feedback_llm_node_pure_helper_pattern).

import { extractJson } from './local-llm.js';
import type { LocalLlm } from './local-llm.js';

export interface JudgeInput {
  title: string;
  tickers: string[];   // Tier0 추출(힌트)
  category: string;
}

export interface JudgeVerdict {
  i: number;
  importance: number;  // 0-10 투자 관점 중요도
  spam: boolean;       // 광고/도배/무의미
  polarity: number;    // -1..+1 문맥 긍부정(Tier0 은어 보정)
  reason: string;      // 한글 1줄
}

/** 배치 판정 프롬프트(순수). Tier0 티커 힌트 동봉. */
export function buildJudgePrompt(items: JudgeInput[]): string {
  const lines = items.map((it, i) => {
    const tk = it.tickers.length ? ` [티커:${it.tickers.join(',')}]` : '';
    return `${i}. [${it.category}]${tk} ${it.title}`;
  });
  return [
    '너는 주식 커뮤니티(한국 에펨코리아 / 미국 레딧) 게시글을 빠르게 분류하는 판정기다.',
    '영어 글이어도 reason 은 한글로 쓴다.',
    '아래 글들을 각각 판정해 JSON 배열만 출력한다(설명 금지).',
    '각 항목: {"i":번호, "importance":0-10, "spam":true|false, "polarity":-1.0~1.0, "reason":"한글 1줄"}',
    '- importance: 투자 관점 중요도(속보/실적/급등락/파생/거시=높음, 잡담/감정토로=낮음).',
    '- spam: 광고/도배/무의미(단순 감탄, ㅋㅋ 도배)면 true.',
    '- polarity: 글의 시장 심리(강한 강세 +1, 강한 약세 -1, 중립 0). 은어(떡상/줄빠따 등) 반영.',
    '- reason: 왜 그 중요도인지 한글 한 줄.',
    '',
    '글:',
    ...lines,
    '',
    'JSON 배열:',
  ].join('\n');
}

/** 응답 파싱(순수) — extractJson + 검증/클램프. 누락/오류 항목은 스킵(fail-soft). */
export function parseJudgeResponse(raw: string, n: number): JudgeVerdict[] {
  const j = extractJson(raw);
  if (!Array.isArray(j)) return [];
  const out: JudgeVerdict[] = [];
  for (const item of j) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const i = typeof o.i === 'number' ? o.i : Number(o.i);
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    const importance = clamp(Number(o.importance), 0, 10);
    const polarity = clamp(Number(o.polarity), -1, 1);
    out.push({
      i,
      importance: Number.isNaN(importance) ? 0 : Math.round(importance),
      spam: o.spam === true || o.spam === 'true',
      polarity: Number.isNaN(polarity) ? 0 : Math.round(polarity * 100) / 100,
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 120) : '',
    });
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number { return Number.isNaN(v) ? NaN : Math.max(lo, Math.min(hi, v)); }

/** 배치 판정 — ≤chunkSize 로 쪼개 병렬 판정(라운드로빈이 2엔드포인트 분산 = 로드밸런싱).
 *  청크 실패는 [](fail-soft). i 는 전역 인덱스로 재매핑. */
export async function judgeBuzz(items: JudgeInput[], llm: LocalLlm, opts: { chunkSize?: number } = {}): Promise<JudgeVerdict[]> {
  if (items.length === 0) return [];
  const chunkSize = opts.chunkSize ?? 12;
  const chunks: JudgeInput[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map(async (chunk, ci) => {
    try {
      const content = await llm.complete(
        [{ role: 'user', content: buildJudgePrompt(chunk) }],
        { maxTokens: Math.min(4096, 256 + chunk.length * 60) },
      );
      return parseJudgeResponse(content, chunk.length).map(v => ({ ...v, i: v.i + ci * chunkSize }));
    } catch { return []; }
  }));
  return results.flat();
}
