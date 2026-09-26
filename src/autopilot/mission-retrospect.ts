// 미션 안착 점검 (회고 에이전트 C1 · P2 · 2026-07-18)
//
// 미션이 완료/안착한 뒤 **최초 골 대비 실제 구현이 정합한가**를 결정론으로 요약한다.
// 페이즈 단위 `critiquePhaseDeterministic`(범위이탈·Goodhart)의 미션-전체 확장 — 아크
// 완성도·검증 갭·범위 축소(descoped)·소비되지 않는 산출(dead-arc)을 점검하고 REFLECTION 을
// surface_events(해마)에 각인한다. 각인은 다음 미션 분해 시 능동회상(ANS 축B)으로 재사용.
//
// ⚠️ 미션 DB **읽기 전용** — 각인은 surface_events 에만(미션 DB 무접촉). armed=false·집행0.
// 상위 설계 = PLAN-retrospection-taste-substrate §5 Layer1 C1 · 엄브렐라 RFC §4.4(빌드결과=정답신호).

import { openSurfaceEventsDb, recordEvent, surfaceEventsDbPath, queryEvents, type SurfaceEventRow } from '../domains/surface-events.js';
import { readWorkingMemory, type WorkingMemoryEntry } from './mission-working-memory.js';
import type { MissionRetroAgg } from '../domains/retro-aggregate.js';
import { debug } from '../debug/log.js';
import type { Database } from 'bun:sqlite';

/** 회고 입력 아크(미션 registry autopilot.arcs 의 부분집합·읽기 전용). */
export interface RetroArc {
  arcId?: string;
  name?: string;
  status?: string; // done | descoped | verifying | proposed | running | ...
  verifyResult?: { ok?: boolean } | null;
  dependsOnArcs?: string[];
}

export interface MissionForRetro {
  id: string;
  goal: string;
  arcs: RetroArc[];
}

export interface MissionReflection {
  missionId: string;
  goal: string;
  verdict: 'coherent' | 'partial' | 'incoherent';
  arcs: {
    total: number;
    done: number;
    verified: number;
    descoped: number;
    incomplete: string[];
    unverified: string[];
    deadArcs: string[];
  };
  findings: string[];
}

function arcLabel(a: RetroArc): string {
  return a.name ?? a.arcId ?? '?';
}

/** ★ 결정론 미션 회고 — 순수함수. 골↔아크 정합·검증 갭·descoped·dead-arc 를 flag. */
export function retrospectMission(m: MissionForRetro): MissionReflection {
  const arcs = Array.isArray(m.arcs) ? m.arcs : [];
  const done = arcs.filter((a) => a.status === 'done');
  const descoped = arcs.filter((a) => a.status === 'descoped');
  const verified = done.filter((a) => a.verifyResult?.ok === true);
  const incomplete = arcs.filter((a) => a.status !== 'done' && a.status !== 'descoped');
  const unverified = done.filter((a) => a.verifyResult?.ok !== true);

  // dead-arc — 다른 아크의 dependsOnArcs 에 등장하지 않고(소비 안 됨) 마지막 아크도 아닌 done 아크.
  // = 산출물이 후속 아크에 통합되지 않는 의심(고아 산출·엄브렐라 §4.1 dead-code 탐지의 아크판).
  const referenced = new Set<string>();
  for (const a of arcs) for (const d of a.dependsOnArcs ?? []) referenced.add(d);
  const lastArcId = arcs[arcs.length - 1]?.arcId;
  const deadArcs = arcs
    .filter((a) => a.arcId && a.arcId !== lastArcId && !referenced.has(a.arcId) && a.status === 'done')
    .map(arcLabel);

  const findings: string[] = [];
  if (arcs.length === 0) findings.push('아크 0 — 분해 실패(골이 실행 계획으로 안 펼쳐짐)');
  if (incomplete.length) findings.push(`미완 아크 ${incomplete.length}: ${incomplete.map(arcLabel).slice(0, 3).join(', ')}`);
  if (unverified.length) findings.push(`검증 안 된 done 아크 ${unverified.length}(구현했으나 verify 미통과 — 정합 불명)`);
  if (descoped.length) findings.push(`축소(descoped) 아크 ${descoped.length}: ${descoped.map(arcLabel).slice(0, 3).join(', ')} — 골 대비 범위 축소`);
  if (deadArcs.length) findings.push(`소비되지 않는 산출 의심 ${deadArcs.length}: ${deadArcs.slice(0, 3).join(', ')}(dead-arc?)`);
  if (findings.length === 0) findings.push('전 아크 done+verified — 골↔구현 정합(안착)');

  const verdict: MissionReflection['verdict'] =
    arcs.length === 0 || incomplete.length > done.length
      ? 'incoherent'
      : incomplete.length || unverified.length || descoped.length || deadArcs.length
        ? 'partial'
        : 'coherent';

  return {
    missionId: m.id,
    goal: m.goal,
    verdict,
    arcs: {
      total: arcs.length,
      done: done.length,
      verified: verified.length,
      descoped: descoped.length,
      incomplete: incomplete.map(arcLabel),
      unverified: unverified.map(arcLabel),
      deadArcs,
    },
    findings,
  };
}

const VERDICT_EMOJI = { coherent: '✅', partial: '⚠️', incoherent: '🔴' } as const;

/** REFLECTION 마크다운 렌더 — 각인 본문 + HITL 표시용. */
export function renderMissionReflection(r: MissionReflection): string {
  const a = r.arcs;
  return [
    `${VERDICT_EMOJI[r.verdict]} 미션 안착 점검 — ${r.verdict}`,
    `골: ${r.goal}`,
    `아크: ${a.done}/${a.total} done · ${a.verified} verified · ${a.descoped} descoped`,
    ...r.findings.map((f) => `- ${f}`),
  ].join('\n');
}

const VERDICT_IMPORTANCE = { coherent: 4, partial: 6, incoherent: 8 } as const;

/** REFLECTION 을 surface_events(해마)에 각인 → 다음 분해 시 능동회상 재사용. eventId 반환.
 *  미션 DB 무접촉(surface_events 만). db 주입 seam(테스트). */
export function imprintMissionReflection(r: MissionReflection, db?: Database): string {
  const database = db ?? openSurfaceEventsDb(surfaceEventsDbPath());
  // 제1원칙 관측(logs.db) — surface_events 각인과 별개로 회고 결정을 logs.db 에 남겨
  // `elanous logs --category mission.retro` 로 조회 가능하게(엄브렐라 RFC "logs.db+각인 3박자").
  debug.log('mission.retro', `imprint.${r.verdict}`, {
    missionId: r.missionId,
    verdict: r.verdict,
    arcs: `${r.arcs.done}/${r.arcs.total}`,
    verified: r.arcs.verified,
    descoped: r.arcs.descoped,
    deadArcs: r.arcs.deadArcs.length,
  });
  return recordEvent(database, {
    surface: 'cli',
    direction: 'outbound',
    kind: 'mission-retro',
    category: 'mission.retro',
    domain: 'elanous',
    text: renderMissionReflection(r),
    summary: `미션 회고 ${r.missionId}: ${r.verdict}(아크 ${r.arcs.done}/${r.arcs.total} done·${r.arcs.verified} verified${r.arcs.descoped ? `·${r.arcs.descoped} descoped` : ''})`,
    importance: VERDICT_IMPORTANCE[r.verdict],
    refs: JSON.stringify({ missionId: r.missionId }),
    tags: `mission:${r.missionId},verdict:${r.verdict}`,
  });
}

// ── C2. 진행 간 피드백 회고 (P3 · 2026-07-18) ──────────────────────────────
//
// 미션 진행 중 대표가 남긴 정정·가이드·HITL 결정을 모아 "이 미션에서 사용자가 **불편해한
// 곳**(friction)·**강하게 의지를 표한 곳**(will)"을 요약한다. = taste 광맥(Layer2 D 로 흐름).
// 소스 = 미션 워킹메모리 provenance: external(대표 주입 가이드/교정) · reconcile(현실 vs
// self-perception 갭 = 불편/정정) · decision(HITL 결정 = 의지). self(페이즈 자기작업)는 제외.

export interface MissionFeedbackReflection {
  missionId: string;
  frictionPoints: string[];   // reconcile — 현실 정정(불편·가장 중요·대표 지목)
  willSignals: string[];      // decision — HITL 결정(강한 의지)
  externalGuidance: string[]; // external — 대표 주입 가이드/교정
  count: number;
}

function entryText(e: WorkingMemoryEntry): string {
  const parts = [e.summary, ...(e.decisions ?? [])].map((s) => (s ?? '').trim()).filter(Boolean);
  return parts.join(' · ').slice(0, 200);
}

/** ★ 결정론 피드백 회고 — 워킹메모리 provenance 별 분류. 순수(entries 주입 seam). */
export function retrospectMissionFeedback(missionId: string, entries?: WorkingMemoryEntry[]): MissionFeedbackReflection {
  const all = entries ?? readWorkingMemory(missionId);
  const frictionPoints: string[] = [];
  const willSignals: string[] = [];
  const externalGuidance: string[] = [];
  for (const e of all) {
    const t = entryText(e);
    if (!t) continue;
    switch (e.provenance) {
      case 'reconcile': frictionPoints.push(t); break;
      case 'decision': willSignals.push(t); break;
      case 'external': externalGuidance.push(t); break;
      default: break; // 'self' = 페이즈 자기작업(피드백 아님)
    }
  }
  return {
    missionId,
    frictionPoints,
    willSignals,
    externalGuidance,
    count: frictionPoints.length + willSignals.length + externalGuidance.length,
  };
}

/** 피드백 REFLECTION 마크다운 렌더. */
export function renderMissionFeedback(r: MissionFeedbackReflection): string {
  const lines = [`🗣️ 미션 진행 피드백 회고 — ${r.missionId}`];
  if (r.frictionPoints.length) lines.push(`⚠️ 불편·정정 ${r.frictionPoints.length}:`, ...r.frictionPoints.slice(0, 5).map((f) => `  - ${f}`));
  if (r.willSignals.length) lines.push(`✊ HITL 의지 ${r.willSignals.length}:`, ...r.willSignals.slice(0, 5).map((f) => `  - ${f}`));
  if (r.externalGuidance.length) lines.push(`📌 대표 가이드 ${r.externalGuidance.length}:`, ...r.externalGuidance.slice(0, 3).map((f) => `  - ${f}`));
  if (r.count === 0) lines.push('(외부 피드백 신호 없음 — 자율 진행 미션)');
  return lines.join('\n');
}

/** 피드백 REFLECTION 을 surface_events 에 각인(taste 광맥). friction 있으면 high importance. */
export function imprintMissionFeedback(r: MissionFeedbackReflection, db?: Database): string {
  const importance = r.frictionPoints.length ? 7 : r.willSignals.length ? 5 : 3;
  debug.log('mission.retro', 'feedback', {
    missionId: r.missionId, friction: r.frictionPoints.length, will: r.willSignals.length, guidance: r.externalGuidance.length,
  });
  const database = db ?? openSurfaceEventsDb(surfaceEventsDbPath());
  return recordEvent(database, {
    surface: 'cli',
    direction: 'outbound',
    kind: 'mission-feedback',
    category: 'mission.feedback',
    domain: 'elanous',
    text: renderMissionFeedback(r),
    summary: `미션 피드백 ${r.missionId}: 불편 ${r.frictionPoints.length}·의지 ${r.willSignals.length}·가이드 ${r.externalGuidance.length}`,
    importance,
    refs: JSON.stringify({ missionId: r.missionId }),
    tags: `mission:${r.missionId},friction:${r.frictionPoints.length}`,
  });
}

// ── C4. 회고 조정 sweep — 완료 미션 자동 회고 (우아한 폐루프 · 2026-07-18) ──────
//
// 미션 완료훅에 회고를 직접 결합하지 않고(실행 핫패스 무결합·미션코드 조율 회피), 주기 sweep 으로
// "완료됐지만 mission.retro 각인이 없는 미션"을 backfill 한다 = catch-up/reconciliation 패턴
// (누락·기능 off 기간 미션까지 자기치유). idempotent(dedup)·fail-soft(미션별 격리)·읽기+각인만
// (미션 DB 무접촉). 일일 memory-lifecycle 크론이 호출 → 미션 완료 다음 사이클에 회고 루프가 닫힌다.

export interface RetroSweepResult { scanned: number; retrospected: string[]; skipped: number }

/** 이미 mission.retro 각인된 missionId 집합(dedup 근거·refs.missionId). 순수(db 조회). */
export function existingRetroMissionIds(db: Database): Set<string> {
  const set = new Set<string>();
  for (const e of queryEvents(db, { category: 'mission.retro', limit: 2000 })) {
    try {
      const r = JSON.parse(e.refs ?? '{}') as { missionId?: string };
      if (r.missionId) set.add(r.missionId);
    } catch { /* 깨진 refs skip */ }
  }
  return set;
}

/** 완료 미션 중 미각인 건을 C1(안착)+C2(피드백) 회고 후 각인. missions 미주입 시 registry done 로드.
 *  idempotent(이미 각인=skip)·fail-soft(미션 1건 실패가 sweep 을 막지 않음)·읽기+각인만. */
export async function sweepMissionRetrospectives(
  deps: { missions?: MissionForRetro[]; db?: Database; limit?: number } = {},
): Promise<RetroSweepResult> {
  const db = deps.db ?? openSurfaceEventsDb(surfaceEventsDbPath());
  const missions = deps.missions ?? (await loadDoneMissionsForRetro(deps.limit ?? 50));
  const already = existingRetroMissionIds(db);
  const retrospected: string[] = [];
  let skipped = 0;
  for (const m of missions) {
    if (already.has(m.id)) { skipped++; continue; }
    try {
      imprintMissionReflection(retrospectMission(m), db);
      imprintMissionFeedback(retrospectMissionFeedback(m.id), db);
      retrospected.push(m.id);
    } catch { skipped++; /* fail-soft */ }
  }
  debug.log('mission.retro', 'sweep', { scanned: missions.length, retrospected: retrospected.length, skipped });
  return { scanned: missions.length, retrospected, skipped };
}

/** registry 완료(done/completed) 미션 → MissionForRetro. fail-soft·동적 import(순환 회피). */
async function loadDoneMissionsForRetro(limit: number): Promise<MissionForRetro[]> {
  try {
    const { openAutopilotMissionsDb, listMissions } = await import('./mission-registry.js');
    const store = openAutopilotMissionsDb();
    try {
      const done = listMissions(store, { limit: limit * 4 }).filter((r) => r.status === 'done' || r.status === 'completed');
      return done.slice(0, limit).map((row) => {
        const raw = store.getMission(row.id) as { autopilot?: { arcs?: RetroArc[] } } | null;
        return { id: row.id, goal: row.goal, arcs: Array.isArray(raw?.autopilot?.arcs) ? raw!.autopilot!.arcs! : [] };
      });
    } finally { (store as unknown as { close?: () => void }).close?.(); }
  } catch { return []; }
}

// ── C3. 주간 회고 소스 — 기간 내 미션 회고 집계 (P3 · retro-cycle 확장) ────────
//
// C1(mission.retro)·C2(mission.feedback) 각인을 기간 창으로 집계해 retro-cycle 주간 리포트에
// 미션 축을 합류시킨다(RetroDeps.missions 로 주입·비파괴). taste 신호(friction) 총합 포함.

function tagValue(tags: string | null, key: string): string | null {
  if (!tags) return null;
  for (const t of tags.split(',')) {
    const [k, v] = t.split(':');
    if (k === key) return v ?? null;
  }
  return null;
}

/** 기간[from,to] 내 미션 회고/피드백 각인 집계. 없으면 null(섹션 생략). db 주입 seam. */
export function aggregateMissionRetros(from: string, to: string, db?: Database): MissionRetroAgg | null {
  const database = db ?? openSurfaceEventsDb(surfaceEventsDbPath());
  const sinceHours = Math.max(1, Math.ceil((Date.parse(to) - Date.parse(from)) / 3_600_000) + 1);
  const inWindow = (r: SurfaceEventRow): boolean => r.ts >= from && r.ts <= to;
  const retros = queryEvents(database, { category: 'mission.retro', sinceHours, limit: 500 }).filter(inWindow);
  const feedbacks = queryEvents(database, { category: 'mission.feedback', sinceHours, limit: 500 }).filter(inWindow);
  if (retros.length === 0 && feedbacks.length === 0) return null;

  let coherent = 0, partial = 0, incoherent = 0;
  for (const r of retros) {
    const v = tagValue(r.tags, 'verdict');
    if (v === 'coherent') coherent++;
    else if (v === 'partial') partial++;
    else if (v === 'incoherent') incoherent++;
  }
  let frictionTotal = 0;
  for (const f of feedbacks) {
    const n = Number(tagValue(f.tags, 'friction'));
    if (Number.isFinite(n)) frictionTotal += n;
  }
  const topFindings = [...retros, ...feedbacks]
    .slice(0, 5)
    .map((r) => r.summary ?? r.text.slice(0, 80))
    .filter((s): s is string => Boolean(s));

  return { count: retros.length, coherent, partial, incoherent, feedbackCount: feedbacks.length, frictionTotal, topFindings };
}
