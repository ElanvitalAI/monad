// ── 도메인 맥락 resolver — D5 (§3.8 ambiguity 1급화) ───────────────────────
//
// 도메인 = f(텍스트, 행위자 맥락, 최근 이력, 모드). 키워드 stateless 판정이 모호할 때
// 상위 층이 푼다: 키워드 → (모호 시) **맥락 편향(최근 미션 도메인)** → (옵션) LLM refine.
// 잔여 모호는 confidence/candidates 로 노출해 HITL seam 이 물어보게 한다("투자용? 업무용?").
//
// "반도체 산업 동향 조사" = 투자자에겐 investment(선-매매 리서치)·분석가에겐 business.
// 최근 활동이 investment 면 investment 로 기운다(elanous 가 개인 에이전트라서 갖는 강점).
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §3.8.

import { classifyDomain, type DomainClassification } from './detect.js';
import { isDomain, type Domain } from './types.js';
import { budgetModel } from '../../llm/model-defaults.js';

export interface DomainResolution extends DomainClassification {
  /** 어떤 층이 결정했나(관측·회상). */
  via: 'keyword' | 'context' | 'llm';
  /** 키워드 baseline 도메인(관측 — luna 가 뒤집었는지 override 가시화). */
  keywordDomain: Domain;
}

/** LLM refine seam — 후보/맥락을 받아 도메인 하나를 고르거나 null(미결). 주입(테스트/비용). */
export type DomainClassify = (
  goal: string,
  ctx: { candidates: Domain[]; recentDomains?: Domain[] },
) => Promise<Domain | null>;

/** 최근 미션 도메인의 우세값 — 최근일수록 가중(recent[0]=가장 최근). general 제외. */
export function dominantRecentDomain(recent: Domain[]): Domain | null {
  const weighted = new Map<Domain, number>();
  recent.forEach((d, i) => {
    if (d === 'general') return;
    weighted.set(d, (weighted.get(d) ?? 0) + (recent.length - i));
  });
  let best: Domain | null = null;
  let bestN = 0;
  for (const [d, n] of weighted) if (n > bestN) { best = d; bestN = n; }
  return best;
}

/** 키워드/맥락 사다리(LLM 미주입·실패 시 fallback) — high 면 키워드 확정, 모호면 최근이력 편향. */
function keywordLadder(c: DomainClassification, recentDomains?: Domain[]): DomainResolution {
  if (c.confidence === 'high') return { ...c, keywordDomain: c.domain, via: 'keyword' };
  const dom = dominantRecentDomain(recentDomains ?? []);
  // low(동점/무앵커·business-research-verb)면 후보 밖이라도 최근 도메인으로 기울임
  //   ("반도체 조사"→투자자면 investment). medium 이면 최근 도메인이 후보에 있을 때만.
  if (dom && (c.confidence === 'low' || c.candidates.includes(dom))) {
    return { domain: dom, confidence: c.confidence, candidates: c.candidates, keywordDomain: c.domain, via: 'context' };
  }
  return { ...c, keywordDomain: c.domain, via: 'keyword' };
}

/** 도메인 해소 사다리 — 강앵커 high(구현/매매)는 키워드 신뢰, 그 외(business-high·모호)는 luna 의미판정.
 *
 * ★ luna 도메인 승격(2026-07-20 대표 지시) — 키워드는 "주제(무엇에 관한가)"와 "행위유형(무엇을 하는가)"을
 *   못 가른다. "요약/정리/digest 기능을 텔레그램에 만들어줘"는 주제어(요약·정리)가 business high 를 확정시켜
 *   구현 미션이 리서치/문서(PR 없음)로 오라우팅됐다(실측·대표 dogfood). tier 를 luna 로 승격한 선례
 *   (triage.ts 2026-07-16)와 동형: 결정론 baseline 은 floor·fallback, semantic 판정은 luna 가.
 *   강앵커 high(구현/리팩토링·매매)는 신뢰해 luna 불호출(비용·무회귀). LLM 미주입(test)은 기존 사다리 그대로. */
export async function resolveDomain(
  goal: string,
  deps: { recentDomains?: Domain[]; classify?: DomainClassify } = {},
): Promise<DomainResolution> {
  const c = classifyDomain(goal);
  // 강앵커 high(coding 구현·investment 매매)만 키워드 신뢰. business=최하위 catch-all·주제어 위양성 잦음 → luna 재정.
  const trustKeyword = c.confidence === 'high' && c.domain !== 'business';
  if (trustKeyword || !deps.classify) return keywordLadder(c, deps.recentDomains);

  try {
    const picked = await deps.classify(goal, {
      candidates: c.candidates.length ? c.candidates : [c.domain],
      recentDomains: deps.recentDomains,
    });
    if (picked) return { domain: picked, confidence: c.confidence, candidates: c.candidates, keywordDomain: c.domain, via: 'llm' };
  } catch { /* fall through — 키워드/맥락 유지 */ }
  return keywordLadder(c, deps.recentDomains);
}

// ──────────────────── luna 도메인 판정(선택·주입·2026-07-20) ─────────────────

/** luna 도메인 분류 프롬프트 — 주제 vs 행위유형 구분이 핵심(주석 §설계). 영어 지시·골은 데이터. */
export function buildDomainPrompt(goal: string, ctx: { candidates: Domain[]; recentDomains?: Domain[] }): string {
  const recent = (ctx.recentDomains ?? []).filter((d) => d !== 'general');
  return [
    'You are the Autopilot DOMAIN router. Decide the WHAT axis of a user goal — one of: coding, investment, business, general.',
    'coding = fulfilling it requires writing or changing code in the elanous codebase, OR wiring/adding a',
    '  feature/capability/integration INTO the product (its telegram, discord, PWA surfaces, storage, pipelines).',
    '  The deliverable is a code change (a pull request).',
    'business = produce a knowledge artifact with EXISTING tools: report, briefing, analysis, digest, summary,',
    '  research writeup. The deliverable is a document or answer, NOT a code change.',
    'investment = trading/portfolio actions (buy/sell/rebalance) or pre-trade market research.',
    'general = none of the above (small talk, one-off facts).',
    'CRITICAL RULE: the SUBJECT of a goal does NOT decide the domain; the ACTION does. A goal to BUILD, MAKE,',
    'WIRE, IMPLEMENT or ADD a feature that itself summarizes/reports/digests/researches (e.g. "make elanous digest',
    'any URL and save to Obsidian", "wire the youtube skill into telegram, quick summary then detail") is CODING,',
    'not business, because it requires building or modifying the system. Classify as business ONLY when the',
    'deliverable is the artifact itself (a report/summary) with no change to the system.',
    recent.length ? `Recent user missions (context): ${recent.join(', ')}. A research-only goal may be pre-trade research when the user is acting as an investor.` : '',
    `Keyword baseline candidates: ${ctx.candidates.join(', ') || 'none'}.`,
    `Goal: ${goal}`,
    'Reply JSON only: {"domain":"coding|investment|business|general","rationale":"<why, 1 short line>"}',
  ].filter(Boolean).join('\n');
}

/** luna 응답 파싱 — 순수함수(inline ternary 금지·LLM node 규칙). 실패/무효=null. */
export function parseDomainResponse(raw: string): Domain | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    return isDomain(j.domain) ? j.domain : null;
  } catch {
    return null;
  }
}

// ★ 판단 모델 = luna(경량·고속·대표 지시) — tier/실행모델 분류처럼 "동적 상황을 섬세히 보는" 판정은
//   빠른 LLM 에(휴리스틱은 fail-soft floor). [[feedback_model_tier_sol_terra_luna_2026_07_17]].
const DOMAIN_JUDGE_MODEL = (): string => process.env.ELANOUS_DOMAIN_MODEL || budgetModel();

/** 기본 도메인 분류기(luna). NODE_ENV=test 는 호출측이 주입 안 함(seam) — 실 LLM 호출 방지. */
export const defaultDomainClassify: DomainClassify = async (goal, ctx) => {
  const { streamLLM } = await import('../../llm.js');
  const raw = await streamLLM([{ role: 'user', content: buildDomainPrompt(goal, ctx) }], () => {}, {
    model: DOMAIN_JUDGE_MODEL(),
    reasoningEffort: 'low', // 경량 분류 — 무거운 추론 불필요(luna 속도 살림)
  });
  return parseDomainResponse(raw);
};
