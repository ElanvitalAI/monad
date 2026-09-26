// ── 미션 아크 A6-a — 골 grounded intake + 리디자인 역제안 ──────────────────────
// RFC-mission-arcs §8·§14b · PLAN-mission-arc-a6-goal-altitude-anti-inflation §4.
//
// 골-고도 반-인플레이션(A6)의 최상류 방어선. A7-L2 preflight 가 **아크**를 grounded 로 판정하듯,
// A6-a 는 **골 전체**를 분해 **전에** 판정한다 — "이 골이 하나의 응집 미션인가, 이질 다발인가":
//   founded    → 그대로 진행(단일 응집 미션)
//   mirage     → 골 리디자인 역제안(잘못된 파일·없는 전제 — 골 전제를 고쳐 재구성)
//   bundle     → 골 리디자인 역제안(이질 관심사 다발 — [미션 A][미션 B] 또는 명시 아크로 재구성)
//   over_scope → 성숙도 분리로 라우팅(A6-b maturity-split — 크기 과대)
//
// A7-L2 verdict 어휘(founded/mirage/over_scope)를 골 고도로 리프트 + bundle 추가(미션 경계 다발).
// A6-a 는 **미션 경계**(골→몇 개 미션)를 본다 — classifyArcs 는 한 미션 안의 **아크 경계**(하류).
//
// ★ 자율경계(대표) — 자동 분리·자동 재구성 절대 금지. 검출·역제안은 HITL 카드에만(원탭 승인).
// 제1원칙: 판정을 debug.log('mission.redesign') 로 관측. fail-soft — 도구 오류는 founded(진행).

import { tierModel } from '../llm/model-defaults.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debug } from '../debug/log.js';
import type { TaskStore } from '../task-orchestrator/store.js';
import { listMissions } from './mission-registry.js';
import { extractFileRefs } from './mission-arc-preflight.js';
import { groundMissionInCodebase } from './mission-codebase-gate.js';
import { adaptiveGround, extractSymbols } from './mission-grounding-ladder.js';

function defaultFileExists(path: string, repoRoot: string): boolean {
  try { readFileSync(join(repoRoot, path)); return true; } catch { return false; }
}

export type GoalShape = 'founded' | 'mirage' | 'bundle' | 'over_scope';

export interface GoalShapeVerdict {
  verdict: GoalShape;
  reason: string;
  /** 역제안 요지(재구성 형태) — bundle/mirage 일 때. */
  suggestion: string;
}

export interface SimilarMission {
  id: string;
  goal: string;
  status: string;
}

export interface GoalShapeDeps {
  ground?: (goal: string) => Promise<{ grounded: boolean; context: string; files: string[] }>;
  fileExists?: (path: string, repoRoot: string) => boolean;
  /** LLM 판정(기본 streamLLM·sol). 테스트 주입·NODE_ENV=test 미주입 시 founded 폴백. */
  judge?: (prompt: string) => Promise<string>;
  repoRoot?: string;
}

/** 골 토큰화(한글/영문·소문자·2자+) — 유사 미션 Jaccard 용. 순수. */
function tokenize(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+|[가-힣]{2,}/g) ?? []).filter((t) => t.length >= 2));
}

/** 골 유사도(Jaccard·순수). */
export function goalSimilarity(a: string, b: string): number {
  const ta = tokenize(a), tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** 유사 과거 미션 — 리디자인 역제안 근거(평균 페이즈/실패 패턴 참고). 자기 제외. */
export function findSimilarMissions(store: TaskStore, goal: string, id?: string, limit = 3): SimilarMission[] {
  return listMissions(store, { limit: 60 })
    .filter((m) => m.id !== id)
    .map((m) => ({ m, sim: goalSimilarity(goal, m.goal) }))
    .filter((x) => x.sim >= 0.25)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit)
    .map((x) => ({ id: x.m.id, goal: x.m.goal, status: x.m.status }));
}

function buildGoalShapePrompt(goal: string, groundContext: string, missingFiles: string[], researchContext?: string): string {
  return [
    '역할: 자율 미션 시스템의 "골 형태" 판정기. 골을 분해하기 **전에**, 이 골이 하나의 응집 미션으로',
    '수렴 가능한지 본다. 골을 그대로 받지 않고 적절한 형태로 역제안하기 위함.',
    '네 판정(하나):',
    '  1) founded — 하나의 응집 미션. 단일 deliverable 계열·전제 실재. 그대로 진행.',
    '  2) mirage — 골이 잘못된 파일/모듈을 지목하거나, 존재하지 않는 전제(없는 fixture·없는 시스템)에',
    '     기댄다. → 전제를 고쳐 재구성 역제안.',
    '  3) bundle — 이질 관심사 다발(deliverable 종류 ≥3이 미션 경계를 넘음. 예: "수집+판정+UI+배포"를',
    '     한 골에). → [미션 A][미션 B] 또는 명시 아크로 재구성 역제안.',
    '  4) over_scope — 규모가 별도 미션 여러 개급으로 과대(성숙도 여러 단계). → 성숙도 분리 역제안.',
    '주의: 애매하면 founded(HITL 이 최종 판단·과계층화 방지). "아직 미구현"은 mirage 아님(당연).',
    // ★ 이름-낚임 경계(대표 2026-07-20) — assessGoalShape 가 골의 키워드로 기존 자산 재사용을 단정해',
    //   아크 preflight(grounding)와 판정이 어긋나던 문제 수복(골 "youtube absorb" → absorb-flow 재사용
    //   오역제안 vs preflight 는 absorb-flow=repo→PR 이라 mirage). suggestion 작성 시 실제 목적 대조 강제.
    '★ suggestion(역제안) 작성 규칙: 골·grounding 이 언급한 기존 스킬·파일·모듈을 "재사용" 전제로 삼기',
    '  전에 grounding 으로 그 실제 목적을 확인하라. 이름·키워드가 유사해도 목적이 다르면(예: 골의 "absorb"',
    '  와 코드의 absorb-flow=repo 커밋→PR 자동화는 무관) 재사용을 제안하지 말고 "신규 필요"로 적어라.',
    '  이름 매칭만으로 기존 자산 재사용을 단정하지 마라 — 아크 preflight(grounding)와 판정이 어긋나는 주원인.',
    '',
    `## 골\n${goal.slice(0, 800)}`,
    '',
    `## 골이 지목했으나 코드베이스에 없는 파일\n${missingFiles.length ? missingFiles.join(', ') : '(없음)'}`,
    '',
    `## grounding(골로 찾은 실제 관련 코드)\n${groundContext.slice(0, 800)}`,
    ...(researchContext ? ['', `## 외부조사 보강\n${researchContext.slice(0, 500)}`] : []),
    '',
    'JSON 한 줄만: {"verdict":"founded|mirage|bundle|over_scope","reason":"한 줄 근거","suggestion":"역제안 요지(재구성 형태·founded 면 빈 문자열)"}',
  ].join('\n');
}

/** LLM 출력 → 골 형태 판정. 파싱 실패/애매 → founded(보수적·진행). 순수. */
export function parseGoalShapeVerdict(raw: string): GoalShapeVerdict {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { verdict: 'founded', reason: '판정 파싱 실패(보수적 founded)', suggestion: '' };
    const o = JSON.parse(m[0]) as { verdict?: unknown; reason?: unknown; suggestion?: unknown };
    const verdict: GoalShape = o.verdict === 'mirage' || o.verdict === 'bundle' || o.verdict === 'over_scope' ? o.verdict : 'founded';
    return {
      verdict,
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : '',
      suggestion: verdict === 'founded' ? '' : (typeof o.suggestion === 'string' ? o.suggestion.slice(0, 300) : ''),
    };
  } catch {
    return { verdict: 'founded', reason: '판정 오류(보수적 founded)', suggestion: '' };
  }
}

async function defaultJudge(prompt: string): Promise<string> {
  const { streamLLM } = await import('../llm.js');
  return streamLLM([{ role: 'user', content: prompt }], () => {}, {
    model: process.env.ELANOUS_REDESIGN_MODEL || process.env.ELANOUS_DECOMPOSE_MODEL || tierModel('better'),
    reasoningEffort: 'medium',
  });
}

/** 골 형태 grounded 판정. fail-soft — 도구/LLM 오류는 founded(진행). */
export async function assessGoalShape(
  goal: string,
  ctx: { researchContext?: string } = {},
  deps: GoalShapeDeps = {},
): Promise<GoalShapeVerdict> {
  try {
    const repoRoot = deps.repoRoot ?? process.cwd();
    const exists = deps.fileExists ?? defaultFileExists;
    const refs = extractFileRefs(goal);
    const missingFiles = refs.filter((f) => !exists(f, repoRoot));
    // ★ 소비자 통일(G3·2026-07-14) — 얕은 단발 대신 adaptiveGround(상황 따라 디깅·external 티어가
    //   ctx.researchContext 훅 대체 가능). deps.ground 주입 시 얕은 경로 보존(하위호환).
    let groundContext: string;
    if (deps.ground) {
      groundContext = (await deps.ground(goal)).context;
    } else {
      const r = await adaptiveGround(goal, { seedFiles: refs, symbols: extractSymbols(goal) }, { repoRoot });
      groundContext = r.context;
    }
    const judge = deps.judge ?? (process.env.NODE_ENV === 'test' ? undefined : defaultJudge);
    if (!judge) return { verdict: 'founded', reason: 'judge 미주입(test) — 보수적 founded', suggestion: '' };
    const raw = await judge(buildGoalShapePrompt(goal, groundContext, missingFiles, ctx.researchContext));
    const v = parseGoalShapeVerdict(raw);
    debug.log('mission.redesign', v.verdict, { reason: v.reason.slice(0, 120), missingFiles: missingFiles.slice(0, 4) });
    return v;
  } catch (e) {
    debug.log('mission.redesign', 'error', { error: e instanceof Error ? e.message.slice(0, 120) : '' }, { level: 'error' });
    return { verdict: 'founded', reason: '리디자인 판정 오류(fail-soft·founded)', suggestion: '' };
  }
}

/** HITL 카드/알림용 역제안 요약. founded 면 빈 문자열. */
export function formatRedesignProposal(v: GoalShapeVerdict, similar: readonly SimilarMission[] = []): string {
  if (v.verdict === 'founded') return '';
  const head = v.verdict === 'mirage'
    ? '🔧 골 리디자인 역제안 — 허상 전제(잘못된 파일·없는 전제)'
    : v.verdict === 'bundle'
      ? '🔧 골 리디자인 역제안 — 이질 관심사 다발(미션 경계 재구성 권장)'
      : '⚠️ 과대 골 — 성숙도 분리 권장(maturity-split)';
  const lines = [`${head}`, `  근거: ${v.reason}`];
  if (v.suggestion) lines.push(`  역제안: ${v.suggestion}`);
  if (similar.length) {
    lines.push(`  유사 과거 미션 ${similar.length}건 참고:`);
    for (const s of similar) lines.push(`    · ${s.id} (${s.status})`);
  }
  lines.push('  → 그대로 수렴 X·원탭 승인으로 재구성(자동 분리 없음·HITL)');
  return lines.join('\n');
}
