// ── 커버리지 verify 게이트 (anti-drift 완결) ──
//
// enhance.ts 가 원문에서 뽑은 커버리지 체크리스트는 codex 프롬프트에 "지시"로 들어간다.
// 하지만 지시만으론 산출물이 실제로 그걸 담았는지 보장되지 않는다(드리프트의 본질 = 지시를 어김).
// 이 모듈은 **산출물을 독립 검증** — 각 체크리스트 항목이 산출물에 반영됐는지 대조하고,
// 빠진 항목을 돌려줘 재지시(되먹임)한다. 6-tool 조사(Gemini·Codex·Claude)가 공통으로
// "최고 레버리지·정확히 빠졌던 것"으로 꼽은 게이트.
//
// 재사용: streamLLM(의미 대조)·debug.log. LLM 실패 시 결정론 토큰 대조 폴백(항상 판정 가능).
import { tierModel } from '../llm/model-defaults.js';
import { streamLLM, type LLMMessage } from '../llm.js';
import { debug } from '../debug/log.js';

export interface CoverageResult {
  /** 산출물이 담은 항목. */
  covered: string[];
  /** 산출물에서 빠진 항목(되먹임 대상). */
  missing: string[];
  /** covered / total (1=완전). */
  ratio: number;
  method: 'llm' | 'fallback';
}

// 너무 흔해 변별력 없는 토큰(과다 매칭 방지). 최소 유지 — 공격적이면 실제 항목을 놓친다.
const STOP = new Set([
  '그리고', '그러나', '위한', '통해', '에서', '으로', '하는', '한다', '있다', '필요', '해야',
  '및', 'and', 'the', 'for', 'with', 'that', 'this', '것', '수', '등', '이', '그', '및',
]);

/** 항목에서 변별 토큰 추출 — 영문/숫자 런 + 2자 이상 한글. 소문자화·중복제거·불용어 제외. */
export function salientTokens(item: string): string[] {
  const toks = (item.toLowerCase().match(/[a-z0-9]+|[가-힣]{2,}/g) ?? []).filter(
    (t) => t.length >= 2 && !STOP.has(t),
  );
  return [...new Set(toks)];
}

/**
 * 결정론 폴백 — 각 항목의 변별 토큰이 산출물에 있는지. 절반 이상 나타나면 covered.
 * 변별 토큰이 없는 항목(전부 불용어/1자)은 판별 불가 → 보수적으로 covered 처리(거짓 미달 방지).
 */
export function coverageFallback(text: string, checklist: string[]): CoverageResult {
  const lc = text.toLowerCase();
  const covered: string[] = [];
  const missing: string[] = [];
  for (const item of checklist) {
    const toks = salientTokens(item);
    if (!toks.length) {
      covered.push(item);
      continue;
    }
    const hit = toks.filter((t) => lc.includes(t)).length;
    if (hit / toks.length >= 0.5) covered.push(item);
    else missing.push(item);
  }
  return {
    covered,
    missing,
    ratio: checklist.length ? covered.length / checklist.length : 1,
    method: 'fallback',
  };
}

/** LLM 응답에서 미달 항목 인덱스(1-based) 배열 파싱. 실패 시 null. */
export function parseMissingIndices(raw: string, total: number): number[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const idx = arr
    .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= total);
  return idx;
}

export interface CoverageOpts {
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** 산출물 텍스트 상한(토큰 절약). 기본 24000. */
  maxTextChars?: number;
}

const defaultModel = (): string =>
  process.env.ELANOUS_COVERAGE_MODEL || process.env.ELANOUS_PR_REVIEW_MODEL || tierModel('better');

/**
 * ★ 커버리지 검증 — 산출물이 체크리스트 각 항목을 담았는지 대조.
 *   LLM(의미 대조) 우선, 실패/빈 응답이면 결정론 토큰 대조 폴백. 항상 판정 반환.
 */
export async function verifyCoverage(
  text: string,
  checklist: string[],
  opts: CoverageOpts = {},
): Promise<CoverageResult> {
  if (!checklist.length) return { covered: [], missing: [], ratio: 1, method: 'fallback' };
  const clipped = text.slice(0, opts.maxTextChars ?? 24000);

  try {
    const numbered = checklist.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          '너는 산출물 커버리지 검증기다. 아래 [산출물]이 [체크리스트]의 각 항목을 실제로 반영했는지 판정한다. ' +
          '항목의 구체 사실(수치·고유명사·요구 장수)이 산출물에 없거나 일반화로 뭉개졌으면 "미달"이다. ' +
          '미달 항목의 번호만 JSON 배열로 출력하라(전부 반영됐으면 []). 설명 금지.',
      },
      { role: 'user', content: `[체크리스트]\n${numbered}\n\n[산출물]\n${clipped}\n\n미달 항목 번호 JSON 배열만:` },
    ];
    const raw = await streamLLM(messages, () => {}, {
      model: opts.model ?? defaultModel(),
      reasoningEffort: opts.reasoningEffort ?? 'low',
    });
    const missingIdx = parseMissingIndices(raw, checklist.length);
    if (missingIdx) {
      const missingSet = new Set(missingIdx);
      const covered: string[] = [];
      const missing: string[] = [];
      checklist.forEach((c, i) => (missingSet.has(i + 1) ? missing.push(c) : covered.push(c)));
      const r: CoverageResult = {
        covered,
        missing,
        ratio: covered.length / checklist.length,
        method: 'llm',
      };
      debug.log('coverage', 'verify', { total: checklist.length, missing: missing.length, ratio: r.ratio, method: 'llm' });
      return r;
    }
  } catch (e) {
    debug.log('coverage', 'llm-error', { error: String((e as { message?: string })?.message ?? e).slice(0, 160) }, { level: 'error' });
  }

  const r = coverageFallback(clipped, checklist);
  debug.log('coverage', 'verify', { total: checklist.length, missing: r.missing.length, ratio: r.ratio, method: 'fallback' });
  return r;
}
