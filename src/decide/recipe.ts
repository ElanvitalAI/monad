/**
 * 🧾 **결정 레시피** — ⛔ 「Claude 없이 도는 결정」을 만드는 장치.
 *
 * 🔑 **왜 이것이 필요한가** (2026-09-20 점검):
 * ```
 *                    state 를 만든다   질문을 만든다   결과를 읽는다
 * elanous ax-screen      코드(파일)      ***코드(고정)***   코드(등급)      ⇒ ✅ 이미 Claude 없이 돈다
 * elanous decide         사람/Claude     ***사람/Claude***  사람            ⇒ ⛔ 매번 사람이 짓는다
 * ```
 * ⇒ ***갈린 것은 「질문이 코드에 고정됐나」 하나였다.***
 *   레시피는 그 고정을 «파일»로 빼서, 한 번 저작하면 그 뒤로는 ***코드만으로 돌게*** 한다.
 *
 * ⛔ **레시피가 «하지 않는» 것**: state 를 «짓지» 않는다. state 는 호출자가 «구조화된 값»으로 준다.
 *   자유 서술을 넣는 순간 다시 사람이 필요해진다.
 */
import type { JevQuestion } from './jev.js';

/** 판정을 코드가 하도록, 레시피가 «정책»까지 들고 있는다. */
export interface RecipeGate {
  /** 자동 통과에 필요한 최상위 확률(기본 0.9 — ⛔ 커뮤니티 값이지 우리 값이 아니다). */
  minProb?: number;
  /** 자동 통과에 필요한 신뢰도(기본 0.7). */
  minConf?: number;
  /**
   * ⛔ 「어느 답이 위험한가」를 레시피가 «이름으로» 말한다.
   *   noul 질문에서 이 값 이상이면 «사람에게» 보낸다. 없으면 임계만 쓴다.
   */
  escalateWhenNoulAbove?: Record<string, number>;
}

export interface Recipe {
  name: string;
  /** 사람이 읽는 한 줄 — ⛔ 모델에게 가지 않는다. */
  description: string;
  /** ⛔ state 에 «반드시» 있어야 하는 칸. 없으면 돌리지 않는다(모른다를 접지 않는다). */
  requiredStateKeys: string[];
  questions: Record<string, JevQuestion>;
  gate?: RecipeGate;
}

export class RecipeError extends Error {}

export function parseRecipe(raw: string, fallbackName?: string): Recipe {
  const o = JSON.parse(raw) as Partial<Recipe>;
  const name = o.name ?? fallbackName;
  if (!name) throw new RecipeError('name 칸이 없다');
  if (!o.questions || typeof o.questions !== 'object' || Object.keys(o.questions).length === 0) {
    throw new RecipeError(`${name}: questions 가 비었다`);
  }
  for (const [qn, q] of Object.entries(o.questions)) {
    const t = (q as JevQuestion)?.type;
    if ('options' in (q as object) || 'levels' in (q as object)) {
      throw new RecipeError(`${name}.questions.${qn} 에 options/levels 가 있다 — ⛔ 그런 칸은 «없다». criteria 로 바꿔라`);
    }
    if (t !== 'noul' && t !== 'choice' && t !== 'score') {
      throw new RecipeError(`${name}.questions.${qn}.type 이 '${String(t)}' 이다 — noul·choice·score 중 하나여야 한다`);
    }
    if ((t === 'choice' || t === 'score') && !(q as { criteria?: unknown }).criteria) {
      throw new RecipeError(`${name}.questions.${qn} 은 criteria 가 필요하다`);
    }
  }
  return {
    name,
    description: o.description ?? '',
    requiredStateKeys: Array.isArray(o.requiredStateKeys) ? o.requiredStateKeys : [],
    questions: o.questions as Record<string, JevQuestion>,
    ...(o.gate ? { gate: o.gate } : {}),
  };
}

/**
 * ⛔⭐ 「모른다」를 접지 않는다 — 필수 칸이 비면 ***돌리지 않는다.***
 * 🩸 근거: ax-screen 에서 「현재판단」을 모델에게 물었더니 표현에 따라 «정반대»로 뒤집혔다.
 *   그 칸은 호출자가 채워야 하는 것이고, 비었으면 «순위를 지어내는» 것이 더 나쁘다.
 */
export function missingStateKeys(recipe: Recipe, state: unknown): string[] {
  if (recipe.requiredStateKeys.length === 0) return [];
  if (typeof state !== 'object' || state === null) return [...recipe.requiredStateKeys];
  const has = (o: Record<string, unknown>, k: string): boolean => {
    const v = o[k];
    return v !== undefined && v !== null && v !== '';
  };
  const o = state as Record<string, unknown>;
  return recipe.requiredStateKeys.filter((k) => !has(o, k));
}

export interface RecipeDecision {
  verdict: 'act' | 'escalate';
  reasons: string[];
}

/** ⛔ 판정은 «코드»가 한다 — 레시피의 정책을 읽어 적용한다. 모델은 확률만 냈다. */
export function decideByRecipe(
  recipe: Recipe,
  answers: Record<string, { type: string; noul?: number; confidence?: number; probabilities?: Record<string, number> }>,
  gateAnswerFn: (a: never, p: number, c: number) => { verdict: 'act' | 'escalate'; why: string },
): RecipeDecision {
  const minProb = recipe.gate?.minProb ?? 0.9;
  const minConf = recipe.gate?.minConf ?? 0.7;
  const reasons: string[] = [];
  let verdict: RecipeDecision['verdict'] = 'act';

  // ⓐ 레시피가 «이름으로» 정한 위험 답부터 — ⛔ 임계보다 먼저다(사유가 구체적이어야 하므로).
  for (const [qn, threshold] of Object.entries(recipe.gate?.escalateWhenNoulAbove ?? {})) {
    const a = answers[qn];
    if (a?.type === 'noul' && (a.noul ?? 0) >= threshold) {
      verdict = 'escalate';
      reasons.push(`${qn} ${(a.noul ?? 0).toFixed(2)} ≥ ${threshold} — 레시피가 위험으로 지정한 답이다`);
    }
  }
  // ⓑ 그다음 일반 임계
  for (const [qn, a] of Object.entries(answers)) {
    const g = gateAnswerFn(a as never, minProb, minConf);
    if (g.verdict === 'escalate') {
      verdict = 'escalate';
      reasons.push(`${qn}: ${g.why}`);
    }
  }
  return { verdict, reasons };
}
