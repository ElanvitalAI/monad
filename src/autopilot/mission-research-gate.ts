// ── 미션 외부조사·보강 게이트 (대표 지시 2026-07-11) ─────────────────────────
//
// 대표 지시(정정):
//  · 게이팅 = [리서치 조사가 필요한지 판단] → [리서치·교정] → [사람 확인]. "교정 없음 → 바로
//    승인" 구조 아님. 모든 human-intent 미션은 사람 확인(HITL)으로 수렴한다.
//  · heavy 미션은 특히 항상 사람 게이팅.
//  · 리서치는 플랜을 더 풍부하게(enrich) 하는 용도로 많이 쓰인다(fact-check 는 그 일부).
//
// 흐름: assessResearchNeed(골이 외부조사로 이득 보는가?) → 필요하면 invokeResearch(omni-crawl)
// → LLM(sol/high 리즈닝)이 보강·교정 요지 추출 → 플랜 초안(HITL 서피스)에 append. 자동 승인 안 함
// (수렴점은 사람 확인). 전부 주입 seam(테스트). 실패는 fail-soft(조사 인프라 장애로 미션 안 막음).

import { tierModel } from '../llm/model-defaults.js';
import { getMission } from './mission-registry.js';
import { getDomainPack } from './domain/registry.js';
import { TaskStore } from '../task-orchestrator/store.js';
import { proposalDraftPath } from './build/build-target.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ResearchEnrichResult {
  ok: boolean;
  /** 외부조사를 실제로 수행했는가(필요 판단 결과). */
  researched: boolean;
  /** 조사가 필요하다고 판단된 이유(또는 불필요 이유). */
  needReason: string;
  /** 플랜 보강 요지(더 풍부하게). */
  enrichments: string[];
  /** 교정(사실오류·낡은 전제·더 나은 대안·놓친 제약). */
  corrections: string[];
  /** omni-crawl 조사 요지(truncate·플랜에 fold). */
  researchDigest?: string;
  error?: string;
}

export type ResearchInvoke = (topic: string) => Promise<{ ok: boolean; output: string }>;
/** 조사 필요 판단 seam(기본=LLM). needed=false 면 조사 skip. */
export type AssessNeed = (goal: string) => Promise<{ needed: boolean; reason: string }>;
/** 조사 결과 → 보강/교정 추출 seam(기본=LLM sol/high). */
export type ExtractEnrichment = (goal: string, research: string) => Promise<{ enrichments: string[]; corrections: string[] }>;

const DMODEL = () => process.env.MONAD_DECOMPOSE_MODEL || tierModel('better');
const DEFFORT = () => (process.env.MONAD_DECOMPOSE_EFFORT || 'high') as 'minimal'|'low'|'medium'|'high'|'xhigh'|'max';

async function llmJson(prompt: string): Promise<string> {
  const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
  const model = DMODEL();
  const provider = resolveDefaultProvider(model);
  let full = '';
  await streamLLM([{ role: 'user', content: prompt }], (_d, all) => { full = all; },
    { model, reasoningEffort: DEFFORT(), ...(provider ? { provider } : {}) });
  return full;
}

// assessNeed/invoke(코딩 도메인 기본값)은 domain/coding-pack.ts 로 이관(D2·도메인팩 소유).
// 도메인별 리서치 소스는 pack.research 가 공급 — researchAndEnrichMission 이 라우팅.

async function defaultExtract(goal: string, research: string): Promise<{ enrichments: string[]; corrections: string[] }> {
  const raw = await llmJson([
    'Given a coding mission and external research, extract how the research should ENRICH the plan and any CORRECTIONS',
    '(factual errors, outdated assumptions, better alternatives, missing constraints). Be concrete and concise.',
    '', `Mission goal:\n${goal}`, '', `External research (omni-crawl):\n${research.slice(0, 6000)}`, '',
    'Respond with ONE JSON object, no fences:',
    '{"enrichments": ["<short plan-enriching point>", ...], "corrections": ["<short correction>", ...]}',
  ].join('\n'));
  const j = parseJsonLoose(raw);
  return {
    enrichments: Array.isArray(j?.enrichments) ? j!.enrichments.filter((x: unknown): x is string => typeof x === 'string') : [],
    corrections: Array.isArray(j?.corrections) ? j!.corrections.filter((x: unknown): x is string => typeof x === 'string') : [],
  };
}

/** fence/prose 관대 JSON 파싱. 실패 null. */
export function parseJsonLoose(raw: string): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/```(?:json)?/g, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)) as Record<string, any>; } catch { return null; }
}

export interface ResearchEnrichDeps {
  store?: TaskStore;
  assessNeed?: AssessNeed;
  invoke?: ResearchInvoke;
  extract?: ExtractEnrichment;
  /** 조사 필요 판단을 건너뛰고 강제 실행(heavy 미션은 보강 가치가 커 항상 조사 권장). */
  force?: boolean;
  /** ★ 조사 필요 판단(luna) 직후 훅(대표 2026-07-17 관측성) — caller 가 실시간 진행 통지(UX) + 관측 로그.
   *  needed/reason/by(luna·force·internal-heuristic·error)를 받아 "딥리서치 중" vs "조사 불필요·grounding만"
   *  표시(낙관적 고정 해소) + `mission.research.assess` 로그(caller 측·검증된 sink 경로). */
  onAssess?: (need: { needed: boolean; reason: string; by: string }) => void;
}

/** 미션 외부조사·보강 — 필요 판단 → 조사 → 보강/교정 추출 → 플랜 초안(HITL)에 append.
 *  자동 승인 안 함(수렴점은 사람 확인). 반환값을 caller 가 분해 objective 보강에 재사용. */
/** 내부 작업 판정 — 로컬 코드/스크립트/문서 경로 참조 + 유지보수·복원 성격이면 외부 웹조사가
 *  무의미(모든 정보가 저장소 안). 보수적으로 둘 다 요구 → "scripts/foo.ts 로 신기능" 같이 외부
 *  정보가 필요한 케이스는 안 걸림. 순수함수(테스트). 대표 지적 2026-07-12(se-doc-map 과한 조사). */
export function isInternalGoal(goal: string): boolean {
  const g = goal.toLowerCase();
  const localPath = /\b(scripts|src|docs)\/[\w.\-]+/i.test(goal) || /\.(ts|tsx|js|md)\b/.test(g);
  const maintenance = /복원|재등록|재설정|재활성|비활성|주석\s*해제|크론|스케줄|schedule|cron/.test(g);
  return localPath && maintenance;
}

/** ★ 외부조사 시그널 감지(대표 2026-07-22) — 골에 "외부 레퍼런스·외부조사·웹검색·최신 조사" 등의 뉘앙스가
 *  있으면 luna 판정(오탐 needed=false)과 무관하게 외부조사를 **강제 ON** 한다. 실패 케이스 실증: tailscale
 *  외부노출/ngrok 등 외부지식이 필요한 골인데 luna 가 "내부 grounding 만"으로 skip → RFC 가 최적 외부방법을
 *  못 짚을 뻔. 순수함수(테스트). false-positive(불필요 조사)는 대표 의도상 허용(값싼 보강)·false-negative 가
 *  진짜 문제라 다소 포괄적. 명시 시그널만 잡아 모든 미션 트리거는 방지. */
export function hasExternalResearchSignal(goal: string): boolean {
  const g = (goal ?? '').toLowerCase();
  // 한글 — 외부 자료/검색/조사 나열 + 최신성/모범사례 요청.
  const kr = /외부\s*(조사|레퍼런스|자료|정보|참조|리서치)|웹\s*검색|웹검색|구글링|구글\s*검색|레퍼런스|참고\s*자료|참고자료|자료\s*조사|자료조사|리서치|딥리서치|검색\s*해|조사\s*해|찾아\s*(봐|줘|서|보)|알아\s*(봐|보)|최신\s*(동향|트렌드|정보|자료|문서|방식|사례|버전)|트렌드\s*조사|모범\s*사례|사람들이\s*(많이\s*)?(쓰|사용)|남들은\s*어떻게|업계\s*(표준|관행)/;
  // 영문 — external lookup / freshness / best practice.
  const en = /external\s+(research|reference|source|doc)|web\s*search|google\s+it|look\s*up|latest\s+(docs?|version|approach|practice|trend)|best\s+practices?|state\s+of\s+the\s+art|how\s+(do\s+people|others)|up[\s-]?to[\s-]?date|benchmark\b/;
  return kr.test(g) || en.test(g);
}

export async function researchAndEnrichMission(
  missionId: string, deps: ResearchEnrichDeps = {},
): Promise<ResearchEnrichResult> {
  const store = deps.store ?? new TaskStore();
  const owns = !deps.store;
  try {
    const m = getMission(store, missionId);
    if (!m) return { ok: false, researched: false, needReason: `미션 없음: ${missionId}`, enrichments: [], corrections: [] };

    // 도메인팩이 리서치 소스를 공급(coding=omni-crawl·investment=omni-market·business=deep-research).
    // 도메인 미상(pre-D1 미션)은 coding 폴백(회귀0·이 fabric 은 역사적으로 코딩).
    const pack = getDomainPack(m.domain ?? 'coding');

    // ★ 외부조사 시그널(대표 2026-07-22) — 골에 "외부 레퍼런스·웹검색·최신 조사" 등 명시 뉘앙스가 있으면
    //   최우선으로 조사 강제(내부-휴리스틱 skip·luna 오탐 needed=false 모두 override). 실패 실증: 외부지식
    //   필요한 골을 luna 가 skip → RFC 가 최적 외부방법 못 짚음. 시그널이 있으면 대표 의도=반드시 외부조사.
    const externalSignal = hasExternalResearchSignal(m.goal);

    // 0) 내부 작업(로컬 참조 + 유지보수·복원)은 heavy/force 여도 외부 웹조사 skip — 과한 트리거 방지.
    //    단, 외부조사 시그널이 명시적이면 skip 하지 않는다(시그널 우선).
    if (!externalSignal && isInternalGoal(m.goal)) {
      const need = { needed: false, reason: '내부 작업(로컬 참조·유지보수) — 외부조사 불필요' };
      deps.onAssess?.({ ...need, by: 'internal-heuristic' });
      return { ok: true, researched: false, needReason: need.reason, enrichments: [], corrections: [] };
    }

    // 1) 조사 필요 판단 — 시그널(강제) > force > luna.
    let need = { needed: true, reason: 'force' };
    let assessBy = 'force';
    if (externalSignal) {
      need = { needed: true, reason: '외부조사 시그널 감지(외부 레퍼런스/웹검색/최신 등) — 강제 ON' };
      assessBy = 'signal-forced';
    } else if (!deps.force) {
      assessBy = 'luna';
      try { need = await (deps.assessNeed ?? pack.research.assessNeed)(m.goal); }
      catch { need = { needed: false, reason: '필요 판단 실패(fail-soft·조사 skip)' }; assessBy = 'error'; }
    }
    // ★ 관측+UX 훅(대표 2026-07-17·제1원칙) — luna 조사 필요 판단(needed/reason/by)을 caller 가 실시간
    //   통지 + `mission.research.assess` 로그(caller 측·검증된 sink 경로). "왜 조사했나/skip했나" 조회 가능.
    deps.onAssess?.({ needed: need.needed, reason: need.reason, by: assessBy });
    if (!need.needed) return { ok: true, researched: false, needReason: need.reason, enrichments: [], corrections: [] };

    // 2) 외부조사(도메인 소스).
    let research: { ok: boolean; output: string };
    try { research = await (deps.invoke ?? pack.research.invoke)(m.goal); }
    catch (e) { return { ok: false, researched: false, needReason: need.reason, enrichments: [], corrections: [], error: e instanceof Error ? e.message.slice(0, 150) : String(e) }; }
    if (!research.ok || research.output.length === 0) {
      return { ok: false, researched: false, needReason: need.reason, enrichments: [], corrections: [], error: '조사 결과 없음' };
    }

    // 3) 보강/교정 추출.
    let ex = { enrichments: [] as string[], corrections: [] as string[] };
    try { ex = await (deps.extract ?? defaultExtract)(m.goal, research.output); }
    catch { /* fail-soft — 조사 원문만 fold */ }

    // 4) 플랜 초안(HITL)에 보강·교정·조사 요지 append.
    recordEnrichment(m.id, m.goal, research.output, ex);
    return { ok: true, researched: true, needReason: need.reason, enrichments: ex.enrichments, corrections: ex.corrections, researchDigest: research.output.slice(0, 1200) };
  } finally {
    if (owns) store.close();
  }
}

function recordEnrichment(
  missionId: string, goal: string, research: string,
  ex: { enrichments: string[]; corrections: string[] },
): void {
  if (process.env.NODE_ENV === 'test') return; // 테스트 격리 — 실 FS(플랜 초안) 미기록.
  try {
    const path = proposalDraftPath(missionId);
    mkdirSync(dirname(path), { recursive: true });
    const lines = [
      '', '---', `## 🔎 외부조사 보강 (omni-crawl·HITL 검토)`, `> 골: ${goal}`, '',
      ...(ex.enrichments.length ? ['플랜 보강:', ...ex.enrichments.map((e) => `- ${e}`), ''] : []),
      ...(ex.corrections.length ? ['⚠️ 교정 필요:', ...ex.corrections.map((c) => `- ${c}`), ''] : []),
      `### 조사 요지`, research.slice(0, 2000), '',
      '위 보강/교정을 반영해 진행할지 검토·승인해 주세요(사람 확인).',
    ];
    appendFileSync(path, lines.join('\n'));
  } catch { /* fail-soft */ }
}
