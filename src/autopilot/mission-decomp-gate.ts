// ── 분해 게이팅 비평 에이전트 (대표 2026-07-16 설계확정) ─────────────────────────
//
// 대표 구상: 분해 산출의 통과/거부를 **결정론 JSON 스키마**가 아니라 **정황을 읽는 LLM 비평
// 에이전트(terra)**가 게이팅한다. 기존 D1 critique(per-phase 자문)를 "자문 → 게이팅 1급"으로 격상.
// checks 완화(#4421·결정론 게이트 열림) 위에서 품질 게이팅은 이 에이전트가.
//
// 계약: 정황(골·확정설계·아크·grounding·조사) + 분해 페이즈 → verdict(pass|revise|reject).
//   pass   → 통과(빌드 가능)
//   revise → 고칠 점 있음 → BC3 역방향 피드백(decompose 재실행·힌트 반영·예산 MAX 2)
//   reject → 근본 문제 → HITL 카드(재설계 역제안·대표 결정·자동 차단 없음)
// [[feedback_mission_fabric_llm_logic_balance_2026_07_16]] — 판단은 LLM(terra), 파싱/집계는 로직.
// fail-soft: terra 실패/파싱 실패 → pass(비파괴·기존 자문 critique 로 폴백).

import { tierModel } from '../llm/model-defaults.js';
import type { DecompCritiquePhase } from './mission-decomp-critique.js';

export type GateVerdict = 'pass' | 'revise' | 'reject';

/** 게이팅 판단에 주입되는 정황(컨텍스트 플러스 — 대표 지시). 값 없으면 프롬프트에서 생략. */
export interface DecompGateContext {
  goal: string;
  /** clarified 확정 설계(되묻기 답변 fold). */
  confirmedDesign?: string;
  /** 아크 구조(다중 아크면 경계 판단 근거). */
  arcs?: string[];
  /** grounding — 재사용 가능한 기존 파일. */
  groundingFiles?: string[];
  /** 외부조사 보강/교정 요지. */
  research?: string;
}

export interface DecompGatePhaseVerdict {
  index: number;
  ok: boolean;
  /** 문제 요지(ok=false 일 때). */
  issue?: string;
  /** 재분해 힌트(revise 시 decompose 에 전달). */
  hint?: string;
}

export interface DecompGateResult {
  verdict: GateVerdict;
  reason: string;
  perPhase: DecompGatePhaseVerdict[];
  /** revise 시 decompose 재실행 reviseContext 에 넣을 힌트(집계). */
  reviseHints: string[];
}

/** 게이팅 판단 LLM(주입 seam·기본=terra). NODE_ENV=test 는 호출측이 주입(실 LLM 방지). */
export type GateJudge = (prompt: string) => Promise<string>;

/** 게이팅 판단 모델 = sol(대표 2026-07-18·계층 재정립) — decomp-gate 는 전체 분해를 종합해 아크 정합·
 *  의존성·범위를 판정하는 **코어/조율** 판단이다. 조율은 최고 모델(sol)이 값어치 있고, 게이팅은 미션당
 *  1~2회라 비용 감당 가능. per-phase critique(개별·병렬 20개)는 terra 로 내린다(단순 반복 판정). */
const GATE_MODEL = process.env.MONAD_DECOMP_GATE_MODEL || tierModel('best');

async function defaultGateJudge(prompt: string): Promise<string> {
  const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
  const provider = resolveDefaultProvider(GATE_MODEL);
  return streamLLM([{ role: 'user', content: prompt }], () => {}, {
    model: GATE_MODEL, reasoningEffort: 'high', ...(provider ? { provider } : {}),
  });
}

/** 게이팅 프롬프트(순수·ASCII+한글) — 정황 + 페이즈 → verdict JSON 요청. */
export function buildGatePrompt(phases: readonly DecompCritiquePhase[], ctx: DecompGateContext): string {
  const lines: string[] = [
    'You are a decomposition GATE agent for the monad codebase. Judge whether a mission decomposition is',
    'ready to BUILD, or needs revision, or should be rejected. You gate quality — natural-language judgment,',
    'NOT rigid schema. monad is a large mature codebase; extending existing assets across MULTIPLE ARCS in one',
    'mission is normal and GOOD. Do NOT reject merely for breadth if arcs/phases cover it coherently.',
    '',
    'Verdict rules:',
    '- pass   = phases are coherent, single-responsibility enough, grounded in reuse, realistically scoped.',
    '- revise = fixable issues (over-scope, under-spec, weak reuse, unrealistic phase) — give concrete hints.',
    '- reject = fundamentally unbuildable as framed (mirage premise, contradictory goal) — needs human redesign.',
    '',
    '★ Execution semantics (do NOT over-flag as revise — 대표 2026-07-20):',
    '- Phases with dependsOn run SEQUENTIALLY (the walker honors dependsOn at runtime). Intra-arc parallelism',
    '  applies ONLY to phases WITHOUT deps. Do NOT flag dependency ordering as a "parallel conflict" — sequential',
    '  deps are normal and handled by the executor, NOT a design defect.',
    '- Detail that a BUILD phase naturally produces (e.g. a contract/boundary defined in its first design phase)',
    '  is NOT a revise reason — the build phase resolves it. Revise ONLY for defects the build cannot fix:',
    '  wrong reuse target, contradictory scope, or a genuinely missing deliverable phase.',
    '',
    `Goal:\n${ctx.goal}`,
  ];
  if (ctx.confirmedDesign) lines.push('', `Confirmed design (clarified):\n${ctx.confirmedDesign.slice(0, 800)}`);
  if (ctx.arcs?.length) lines.push('', `Arcs (${ctx.arcs.length}): ${ctx.arcs.join(' | ').slice(0, 400)}`);
  if (ctx.groundingFiles?.length) lines.push('', `Existing files to reuse (${ctx.groundingFiles.length}): ${ctx.groundingFiles.slice(0, 20).join(', ')}`);
  if (ctx.research) lines.push('', `Research notes:\n${ctx.research.slice(0, 600)}`);
  lines.push('', 'Phases:');
  phases.forEach((p, i) => {
    lines.push(`[${i}] ${p.title}`);
    if (p.prompt) lines.push(`    ${p.prompt.slice(0, 200)}`);
    if (p.acceptance.length) lines.push(`    accept: ${p.acceptance.join(' / ').slice(0, 160)}`);
  });
  lines.push(
    '',
    'Respond with ONE JSON object, no fences:',
    '{"verdict":"pass|revise|reject","reason":"<one line>",',
    ' "perPhase":[{"index":<int>,"ok":<bool>,"issue":"<short or empty>","hint":"<short or empty>"}],',
    ' "reviseHints":["<concrete fix to feed re-decompose>"]}',
  );
  return lines.join('\n');
}

/** 게이팅 응답 파싱(순수·관대) — 실패/이상은 pass 폴백(fail-soft·비파괴). */
export function parseGateResult(raw: string, phaseCount: number): DecompGateResult {
  const passFallback: DecompGateResult = { verdict: 'pass', reason: '게이팅 파싱 실패(보수적 pass)', perPhase: [], reviseHints: [] };
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return passFallback;
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const verdict: GateVerdict = o.verdict === 'revise' || o.verdict === 'reject' ? o.verdict : 'pass';
    const perPhaseRaw = Array.isArray(o.perPhase) ? o.perPhase : [];
    const perPhase: DecompGatePhaseVerdict[] = perPhaseRaw
      .map((p) => p as Record<string, unknown>)
      .filter((p) => typeof p.index === 'number' && p.index >= 0 && p.index < phaseCount)
      .map((p) => ({
        index: p.index as number,
        ok: p.ok !== false,
        ...(typeof p.issue === 'string' && p.issue ? { issue: p.issue.slice(0, 200) } : {}),
        ...(typeof p.hint === 'string' && p.hint ? { hint: p.hint.slice(0, 200) } : {}),
      }));
    const reviseHints = (Array.isArray(o.reviseHints) ? o.reviseHints : [])
      .filter((h): h is string => typeof h === 'string' && h.length > 0)
      .map((h) => h.slice(0, 200));
    return {
      verdict,
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : '',
      perPhase,
      reviseHints,
    };
  } catch { return passFallback; }
}

/** revise 힌트 → decompose 재실행 reviseContext(순수·ASCII+한글). */
export function buildGateReviseComment(result: DecompGateResult): string {
  const lines = ['분해 게이팅(terra) 정련 요청 — 아래 지적을 반영해 재분해하라:'];
  for (const h of result.reviseHints) lines.push(`- ${h}`);
  for (const p of result.perPhase.filter((x) => !x.ok && (x.issue || x.hint))) {
    lines.push(`- 페이즈[${p.index}] ${p.issue ?? ''}${p.hint ? ` → ${p.hint}` : ''}`);
  }
  lines.push('각 페이즈는 단일책임·명세완성·기존 재사용근거·현실적 스코프를 지켜라.');
  return lines.join('\n');
}

/** 분해 게이팅 — 정황 + 페이즈 → verdict. terra 판단(주입 seam)·순수 파싱·fail-soft(pass). */
export async function gateDecomposition(
  phases: readonly DecompCritiquePhase[],
  ctx: DecompGateContext,
  deps: { judge?: GateJudge } = {},
): Promise<DecompGateResult> {
  if (!phases.length) return { verdict: 'pass', reason: '페이즈 없음 — 게이팅 skip', perPhase: [], reviseHints: [] };
  const judge = deps.judge ?? defaultGateJudge;
  try {
    const raw = await judge(buildGatePrompt(phases, ctx));
    return parseGateResult(raw, phases.length);
  } catch {
    return { verdict: 'pass', reason: '게이팅 판단 실패(fail-soft·pass)', perPhase: [], reviseHints: [] };
  }
}
