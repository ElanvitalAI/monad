// ── 미션 진행 판단 브레인 (P6·상황점검·대표 2026-07-21) ──────────────────────────
//
// 대표 통찰: 구현 중 막혔을 때 곧바로 stop/arc-edit/replan 판단하지 말고, 먼저 **상황점검**으로 증거를
// 재수집(플랜 인프라 재사용·해상도 적응)해 **충분한 문맥**을 갖춘 뒤 판단하라. "판단할 충분한 문맥을
// 갖췄나?"가 동기. 이 모듈 = 두 순수 브레인(seam 주입·P5b 동형):
//   (1) assessEvidenceSufficiency — "판단할 문맥이 충분한가? 더 볼 grounding/외부조사 gap 있는가?"
//   (2) decideProgressVerdict     — 충분한 증거 위에서 continue / arc-adjust / replan / partial-stop.
// 재수집(build-rerun grounding/research)·집행은 P6b/c 호출부. 여기는 판정만·보수적.

/** 막힘 상황의 증거 번들 — 상황점검이 재수집해 채운다. */
export interface StuckEvidence {
  goal: string;
  phaseTitle: string;
  failClass?: string;
  /** 세대 걸친 반복 실패 횟수(판단 무게). */
  recurrence: number;
  attemptTrail?: string;
  /** 재수집된 grounding(코드베이스·기존 구현 사실). */
  groundingFacts: readonly string[];
  /** 재수집된 외부 research 발견. */
  researchFindings: readonly string[];
  /** 이미 랜딩/done 맥락(히스토리안). */
  doneContext: readonly string[];
}

// ── (1) 증거 충분성 평가 ─────────────────────────────────────────────
export interface EvidenceSufficiency {
  /** 판단할 문맥이 충분한가. */
  sufficient: boolean;
  /** 부족 시 더 볼 것(예: "기존 digest 코드 grounding", "외부 X API 계약 조사"). */
  gaps: string[];
  reason: string;
}
export interface RawSufficiency { sufficient?: boolean; gaps?: string[]; reason?: string }
export type SufficiencyResolve = (evidence: StuckEvidence) => Promise<RawSufficiency>;

/**
 * ★ 증거 충분성 평가(순수·대표 2026-07-21). "판단할 문맥이 충분한가? 더 볼 grounding/외부조사 gap 있나?"
 * 보수적 기본: LLM 실패·불명확이면 **sufficient=true**(무한 조사 방지 — 호출부 상한과 이중). gaps 있으면
 * insufficient. resolve 는 seam(테스트).
 */
export async function assessEvidenceSufficiency(
  evidence: StuckEvidence,
  resolve: SufficiencyResolve,
): Promise<EvidenceSufficiency> {
  let raw: RawSufficiency;
  try {
    raw = await resolve(evidence);
  } catch {
    return { sufficient: true, gaps: [], reason: '충분성 판정 LLM 실패 — 현 증거로 판단 진행(무한조사 방지·보수적)' };
  }
  const gaps = Array.isArray(raw.gaps) ? raw.gaps.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.slice(0, 200)).slice(0, 5) : [];
  // sufficient 명시 false 이고 gap 이 있으면 부족. 그 외(불명확·gap 없음)는 충분(진행).
  const sufficient = raw.sufficient === false && gaps.length > 0 ? false : true;
  return { sufficient, gaps: sufficient ? [] : gaps, reason: (raw.reason ?? '').slice(0, 200) || (sufficient ? '증거 충분 — 판단 진행' : '증거 부족 — 추가 조사 필요') };
}

// ── (2) 진행 판단 ───────────────────────────────────────────────────
/** continue=재시도로 풀림(예산/접근 조정) · arc-adjust=구조문제→P5 아크편집 · replan=접근/스코프 재설계→
 *  재분해 · partial-stop=더 못 감→P2 graceful 종결(부분달성). */
export type ProgressAction = 'continue' | 'arc-adjust' | 'replan' | 'partial-stop';
export interface ProgressVerdict { action: ProgressAction; reason: string }
export interface RawVerdict { action?: string; reason?: string }
export type VerdictResolve = (evidence: StuckEvidence) => Promise<RawVerdict>;

const VALID_VERDICTS: ReadonlySet<string> = new Set<ProgressAction>(['continue', 'arc-adjust', 'replan', 'partial-stop']);

/**
 * ★ 진행 판단(순수·대표 2026-07-21). 충분한 증거 위에서 continue/arc-adjust/replan/partial-stop.
 * 보수적: LLM 실패·유효하지 않은 action → **continue**(현행 유지·잘못된 종결/재분해 방지). partial-stop 은
 * 미션 종결이라 명시적일 때만. resolve 는 seam(테스트).
 */
export async function decideProgressVerdict(
  evidence: StuckEvidence,
  resolve: VerdictResolve,
): Promise<ProgressVerdict> {
  let raw: RawVerdict;
  try {
    raw = await resolve(evidence);
  } catch {
    return { action: 'continue', reason: '진행 판단 LLM 실패 — 현행 재시도 유지(fail-soft·보수적)' };
  }
  if (!VALID_VERDICTS.has(raw.action ?? '')) return { action: 'continue', reason: `유효하지 않은 판정(${raw.action ?? '없음'}) — 현행 유지(보수적)` };
  return { action: raw.action as ProgressAction, reason: (raw.reason ?? '').slice(0, 200) };
}

// ── 상황점검 오케스트레이터 (P6·증거 충분성 + 판단 결합) ─────────────────────────
export interface SituationOutcome {
  sufficiency: EvidenceSufficiency;
  verdict: ProgressVerdict;
  evidence: StuckEvidence;
}

/**
 * ★ 상황점검(대표 2026-07-21) — 증거 충분성 평가 + 진행 판단을 결합. 핵심 규율(대표 "부족하면 추가 조사 후
 * 결정"): **증거가 부족한데 verdict 가 continue/partial-stop 이면 replan(재수집) 으로 승격** — 얕은 문맥에서
 * 프리매처 종결/무의미 재시도를 막고 먼저 증거를 더 모은다. 충분하면 verdict 그대로. 순수(resolve 주입).
 */
export async function runSituationAssessment(
  evidence: StuckEvidence,
  sufficiencyResolve: SufficiencyResolve,
  verdictResolve: VerdictResolve,
): Promise<SituationOutcome> {
  const sufficiency = await assessEvidenceSufficiency(evidence, sufficiencyResolve);
  const verdict = await decideProgressVerdict(evidence, verdictResolve);
  // 증거 부족 + 판단이 continue/partial-stop → replan(재수집) 승격(프리매처 종결/무의미 재시도 방지).
  const finalVerdict: ProgressVerdict =
    !sufficiency.sufficient && (verdict.action === 'continue' || verdict.action === 'partial-stop')
      ? { action: 'replan', reason: `증거 부족(${sufficiency.gaps.join(', ').slice(0, 120)}) — 재수집(replan) 우선 후 재판단` }
      : verdict;
  return { sufficiency, verdict: finalVerdict, evidence };
}

// ── 프롬프트/어댑터/파서 ─────────────────────────────────────────────
function evidenceBlock(e: StuckEvidence): string {
  const g = e.groundingFacts.length ? e.groundingFacts.slice(0, 12).map((x) => `  - [코드] ${x}`).join('\n') : '  (재수집된 grounding 없음)';
  const r = e.researchFindings.length ? e.researchFindings.slice(0, 8).map((x) => `  - [조사] ${x}`).join('\n') : '  (재수집된 외부조사 없음)';
  const d = e.doneContext.length ? e.doneContext.slice(0, 8).map((x) => `  - ${x}`).join('\n') : '  (없음)';
  return [
    `골: ${e.goal.slice(0, 200)}`,
    `막힌 페이즈: ${e.phaseTitle} · failClass=${e.failClass ?? '?'} · 반복 ${e.recurrence}회`,
    e.attemptTrail ? `시도 트레일: ${e.attemptTrail.slice(0, 200)}` : '',
    '재수집 grounding(코드베이스):', g,
    '재수집 외부조사:', r,
    '이미 랜딩/완료:', d,
  ].filter(Boolean).join('\n');
}

/** 증거 충분성 프롬프트(순수·테스트). */
export function sufficiencyPrompt(e: StuckEvidence): string {
  return [
    '너는 미션 조율자다. 아래 막힘 상황에 대해, **진행 판단(재시도/구조조정/재설계/종결)을 내릴 문맥이',
    '충분한지** 평가하라. 부족하면 무엇을 더 봐야 하는지(gap) 짚어라 — 더 볼 grounding(기존 코드)이나',
    '외부 조사 거리가 있는가.',
    '',
    evidenceBlock(e),
    '',
    '충분(sufficient=true): 위 증거로 진행 판단 가능. 부족(false): 명확한 gap 존재(더 조사 필요).',
    '⚠️ 무한 조사 금지 — 이미 핵심 증거가 있으면 sufficient=true. gap 은 정말 판단을 좌우할 것만.',
    '',
    '출력: JSON 만. {"sufficient":true|false,"gaps":["더 볼 것1",...],"reason":"한줄"}',
  ].join('\n');
}

/** 진행 판단 프롬프트(순수·테스트). */
export function verdictPrompt(e: StuckEvidence): string {
  return [
    '너는 미션 조율자다. 아래 **충분히 모은 증거** 위에서, 막힌 페이즈를 어떻게 진행할지 판단하라.',
    '',
    evidenceBlock(e),
    '',
    '판정(하나):',
    '- continue     : 증거상 재시도로 풀림 — 예산/접근만 조정하면 됨(구조/스코프 문제 아님).',
    '- arc-adjust   : 구조 문제 — 페이즈 분할/삭제/아크 done 등 아크 편집으로 풀림.',
    '- replan       : 접근/스코프가 어긋남 — 이 부분을 재설계(재분해)해야 함.',
    '- partial-stop : 증거상 더 못 감(외부 제약·근본 난제) — 여기까지 부분달성으로 정직 종결.',
    '',
    '원칙: **증거 기반**으로 판단하라. partial-stop 은 정말 더 못 갈 때만(핵심은 랜딩됐고 잔여가 근본 난제).',
    'continue 와 replan 을 혼동 마라 — 예산만 문제면 continue, 접근이 틀렸으면 replan.',
    '',
    '출력: JSON 만. {"action":"continue|arc-adjust|replan|partial-stop","reason":"한줄(증거 인용)"}',
  ].join('\n');
}

async function llmJson(prompt: string, envModel: string): Promise<Record<string, unknown>> {
  const { streamLLM } = await import('../llm.js');
  const { tierModel } = await import('../llm/model-defaults.js');
  const out = await streamLLM([{ role: 'user', content: prompt }], () => {}, { model: process.env[envModel] || tierModel('budget'), reasoningEffort: 'low' });
  return parseJsonObject(out);
}

export async function defaultSufficiencyResolve(e: StuckEvidence): Promise<RawSufficiency> {
  const o = await llmJson(sufficiencyPrompt(e), 'MONAD_SUFFICIENCY_MODEL');
  return {
    ...(typeof o.sufficient === 'boolean' ? { sufficient: o.sufficient } : {}),
    ...(Array.isArray(o.gaps) ? { gaps: o.gaps.filter((x): x is string => typeof x === 'string') } : {}),
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
  };
}

export async function defaultVerdictResolve(e: StuckEvidence): Promise<RawVerdict> {
  const o = await llmJson(verdictPrompt(e), 'MONAD_VERDICT_MODEL');
  return {
    ...(typeof o.action === 'string' ? { action: o.action } : {}),
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
  };
}

/** LLM 출력 → JSON 객체(순수·테스트). 코드펜스/설명 제거. 실패 시 {}. */
export function parseJsonObject(out: string): Record<string, unknown> {
  const stripped = out.replace(/^```[\w.-]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) return {};
  try {
    const o = JSON.parse(stripped.slice(start, end + 1));
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
