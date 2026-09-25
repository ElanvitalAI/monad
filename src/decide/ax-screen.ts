/**
 * AX 자동화 스크리닝 — 업무 목록을 「자동화 후보」로 거른다.
 *
 * ⛔⭐ 이 모듈이 «묻지 않는» 것이 하나 있다 — ***「지금 무엇으로 하고 있나」***.
 *   📏 2026-09-20 실측(같은 업무 · 세 가지 표현):
 *      비고에 "반장이 경험으로 판단" 이 있으면  → human-judgment
 *      같은 업무를 «이름만» 주면               → ***system-automated***  (정반대)
 *   ⇒ ***모델이 «없는 정보»를 추측한다.*** 그리고 그 칸이 스크리닝에서 «가장 중요한» 칸이다.
 *   🩹 그래서 그것은 ***입력으로 받는다***(컨설턴트가 인터뷰로 채우는 칸이다).
 *      없으면 «모른다»로 두고 ⛔ 순위를 매기지 «않는다».
 *
 * ⛔ 판정(등급)은 «코드»가 한다. 모델은 확률만 낸다 — 임계·탈락 규칙은 우리 정책이다.
 */
import type { JevQuestion } from './jev.js';

/** 사람이 채우는 칸. ⛔ 모델에게 묻지 않는다(위 주석). */
export type CurrentMethod = 'human-judgment' | 'documented-rules' | 'system-automated' | 'generative-writing' | 'unknown';

export interface AxTask {
  id: string;
  업무: string;
  부서?: string;
  비고?: string;
  /** ⭐ 필수에 가깝다 — 없으면 'unknown' 이고 순위에서 빠진다. */
  현재판단?: CurrentMethod;
}

export const AX_QUESTIONS: Record<string, JevQuestion> = {
  repetition: {
    type: 'score',
    instructions: '이 업무는 얼마나 자주 반복되는가? ⛔ 건수가 주어지지 않았으면 낮게 잡아라 — 추측하지 마라.',
    criteria: [
      '거의 없음: 연 몇 회 이하. 자동화할 분모가 없다.',
      '낮음: 월 수십 건.',
      '보통: 월 수백 건.',
      '높음: 월 1,000건 이상 또는 매일 수십 건.',
      '매우 높음: 하루 수백 건 이상.',
    ],
  },
  closed_set: {
    type: 'noul',
    instructions: "이 업무의 산출이 '미리 정해진 선택지 중 하나를 고르거나 점수를 매기는 것'인가?",
    criteria: {
      true: '분류·판정·점수처럼 답이 닫힌 집합이다. 새 문장을 지어낼 필요가 없다.',
      false: '새 글·계획·설계를 만들어야 한다. 답이 열려 있다.',
    },
  },
  /** 🆕 다섯째 — 첫 판이 「추출」 업무를 통째로 놓쳤다(발주 메일 → ERP 등록이 닫힘 0.17 로 탈락). */
  extraction: {
    type: 'noul',
    instructions: '이 업무가 「자유 형식 문서에서 정해진 칸에 값을 뽑아 채우는 일」인가?',
    criteria: {
      true: '메일·문서·양식에서 항목을 읽어 시스템의 정해진 필드에 옮긴다.',
      false: '값을 옮기는 일이 아니다.',
    },
  },
  reversible: {
    type: 'noul',
    instructions: '이 업무의 판단이 틀렸을 때, 사람이 알아채고 되돌릴 수 있는가?',
    criteria: {
      true: '후속 검토 단계가 있거나 실수를 쉽게 정정할 수 있다.',
      false: '돈 이체·대외 발송·삭제처럼 즉시 확정되어 되돌리기 어렵다.',
    },
  },
};

export interface AxAnswers {
  repetition: { score: number };
  closed_set: { noul: number };
  extraction: { noul: number };
  reversible: { noul: number };
}

export type AxTier = '1순위' | '2순위' | '후보' | '⚠️ 경고로만' | '제외' | '⛔ 못 잰다';
export interface AxVerdict { tier: AxTier; why: string; score: number; kind: '판정' | '추출' | '—' }

/**
 * ⛔ 규칙의 «순서»가 사유를 정한다.
 * 🩸 첫 판은 closed_set 을 먼저 봐서 「급여 이체」에 *"답이 열려 있다"* 라는 ***틀린 사유***를 붙였다.
 *   실제 사유는 「되돌릴 수 없다」였다. ⇒ 안전 축을 맨 앞에 둔다.
 */
export function axVerdict(t: AxTask, a: AxAnswers): AxVerdict {
  const rep = a.repetition.score;          // 0..4
  const closed = a.closed_set.noul;
  const extract = a.extraction.noul;
  const rev = a.reversible.noul;
  const method: CurrentMethod = t.현재판단 ?? 'unknown';

  if (rev < 0.4) return { tier: '⚠️ 경고로만', why: `되돌리기 어렵다(${rev.toFixed(2)}) — 자동 금지`, score: 0, kind: '—' };
  const kind: AxVerdict['kind'] = closed >= 0.5 ? '판정' : extract >= 0.5 ? '추출' : '—';
  if (kind === '—') return { tier: '제외', why: '판정도 추출도 아니다(생성형)', score: 0, kind };
  if (rep < 1.5) return { tier: '제외', why: '반복이 적다(분모 없음)', score: 0, kind };
  if (method === 'system-automated') return { tier: '제외', why: '이미 시스템이 한다', score: 0, kind };
  if (method === 'generative-writing') return { tier: '제외', why: '사람이 매번 새로 쓴다', score: 0, kind };
  if (method === 'documented-rules') return { tier: '제외', why: '규칙이 확실하다 — if 문이 낫다', score: 0, kind };
  // ⛔ 「모른다」를 「사람의 감」으로 접지 않는다 — 그 칸이 비면 순위를 못 매긴다.
  if (method === 'unknown') return { tier: '⛔ 못 잰다', why: '현재판단 칸이 비었다 — 인터뷰로 채워라', score: 0, kind };

  const score = (rep / 4) * Math.max(closed, extract);
  const tier: AxTier = score >= 0.55 ? '1순위' : score >= 0.35 ? '2순위' : '후보';
  return { tier, why: `되돌리기 ${rev >= 0.6 ? '가능' : '⚠️ 사람 확인 필수'}`, score, kind };
}

export const AX_TIER_ORDER: Record<AxTier, number> = {
  '1순위': 0, '2순위': 1, '후보': 2, '⚠️ 경고로만': 3, '⛔ 못 잰다': 4, '제외': 5,
};

/**
 * ⛔⭐ 모델에게 보낼 state 에서 «사람의 칸»을 걷어낸다.
 * 🩸 정답 대조 템플릿이 한 파일에 「입력」과 「정답」을 같이 둔다(그게 편하다).
 *   그대로 보내면 ***모델이 정답을 보고 답한다*** — 그러면 그 측정은 «무효»다.
 *   ⇒ `_` 로 시작하는 칸(설명)과 `정답_` 으로 시작하는 칸을 «반드시» 뺀다.
 */
export function stateForModel(task: AxTask): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(task as unknown as Record<string, unknown>)) {
    if (k.startsWith('_') || k.startsWith('정답_')) continue;
    out[k] = v;
  }
  return out;
}
