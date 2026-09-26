// ── 루프 에이전트 자산 원장 (PLAN-loop-agent-resource-management·2026-07-15) ────
//
// 대표 지시: 루프 에이전트(목표까지 반복하는 stateful 에이전트)를 자산으로 관리. 1회성 일반
// 에이전트는 비자산(관측만). 기존 capability 원장과 같은 저장소(surface_events domain=elanous)
// 재사용 — 신설 DB 0. kind='loop-agent'·loopId 로 dedup(append-supersede·최신이 현 상태).
//
// 3형태(loopKind): autonomous(ContinuationDriver)·contract(계약루프 3종)·coordinator(팬인 조율).
// 라이프사이클: permanent(정규장 크론·상시) vs ephemeral(goal TTL·30m/1h/1d 후 종료).

import { Database } from 'bun:sqlite';
import { debug } from '../debug/log.js';
import { openSurfaceEventsDb, recordEvent } from './surface-events.js';

export const LOOP_DOMAIN = 'elanous';
export const LOOP_KIND = 'loop-agent';
/** `elanous logs --category` category for loop registry registrations. */
export const LOOP_REGISTRY_LOG_CATEGORY = 'loops.registry';

export type LoopKind = 'autonomous' | 'contract' | 'coordinator';
export type LoopLifecycle = 'permanent' | 'ephemeral';
export type LoopStatus = 'active' | 'ended' | 'removed';

export interface LoopAgentInput {
  /** 루프 식별자(라이프사이클 키·같은 loopId = 같은 루프·supersede 대상). */
  loopId: string;
  /** 사람가독 이름. */
  name: string;
  /** 1-2줄 — 무슨 루프인가. */
  summary: string;
  loopKind: LoopKind;
  lifecycle: LoopLifecycle;
  /** ephemeral 이면 TTL(분) — 좀비 감지에 사용. */
  ttlMin?: number;
  /** 귀속 미션(apm_id·없으면 시스템/독립). */
  missionId?: string;
  /** 이 루프가 소비/생성한 크론(schedule id). */
  scheduleIds?: readonly string[];
  /** 이 루프가 소비/생성한 태스크(task id). */
  taskIds?: readonly string[];
  /** 이 루프를 만든 상위 루프(있으면·루프가 루프를 스폰). */
  createdByLoop?: string;
  /** 상태(기본 active). ended=정상 종료 · removed=논리 삭제. */
  status?: LoopStatus;
}

export interface LoopAgentRecord extends Omit<LoopAgentInput, 'scheduleIds' | 'taskIds' | 'status'> {
  ts: string;
  status: LoopStatus;
  scheduleIds: string[];
  taskIds: string[];
}

/** 루프 에이전트 1건 등록(append-supersede). 같은 loopId 재등록 = 상태 갱신. fail-soft 는 호출측. */
export function registerLoopAgent(db: Database, input: LoopAgentInput, opts: { now?: () => string } = {}): string {
  const refs: Record<string, unknown> = {
    loopId: input.loopId, loopKind: input.loopKind, lifecycle: input.lifecycle,
    status: input.status ?? 'active',
    ...(input.ttlMin != null ? { ttlMin: input.ttlMin } : {}),
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.scheduleIds?.length ? { scheduleIds: [...input.scheduleIds] } : {}),
    ...(input.taskIds?.length ? { taskIds: [...input.taskIds] } : {}),
    ...(input.createdByLoop ? { createdByLoop: input.createdByLoop } : {}),
    name: input.name,
  };
  const eventId = recordEvent(db, {
    surface: `loop:${input.loopKind}`, direction: 'inbound', kind: LOOP_KIND,
    text: input.summary, summary: input.summary, domain: LOOP_DOMAIN, category: 'awareness',
    importance: input.lifecycle === 'permanent' ? 6 : 4,
    refs: JSON.stringify(refs),
    ...(input.missionId ? { tags: `mission:${input.missionId}` } : {}),
    ...(opts.now ? { ts: opts.now() } : {}),
  });
  try {
    debug.log(LOOP_REGISTRY_LOG_CATEGORY, 'registered', {
      loopId: input.loopId,
      loopKind: input.loopKind,
      lifecycle: input.lifecycle,
      status: input.status ?? 'active',
      ...(input.missionId ? { missionId: input.missionId } : {}),
      scheduleIds: input.scheduleIds?.length ?? 0,
      taskIds: input.taskIds?.length ?? 0,
    });
  } catch { /* logging must not prevent a completed registry write */ }
  return eventId;
}

/** 정상 종료 표기(status='ended') — 같은 loopId 재등록. */
export function endLoopAgent(db: Database, loopId: string, opts: { now?: () => string } = {}): void {
  const cur = listLoopAgents(db, { includeEnded: true }).find((l) => l.loopId === loopId);
  if (!cur) return;
  registerLoopAgent(db, { ...cur, status: 'ended' }, opts);
}

/** 루프 에이전트 조회 — loopId dedup(최신). missionId/lifecycle 필터·좀비 제외. */
export function listLoopAgents(
  db: Database,
  opts: { missionId?: string; loopKind?: LoopKind; lifecycle?: LoopLifecycle; includeEnded?: boolean; standaloneOnly?: boolean; limit?: number } = {},
): LoopAgentRecord[] {
  const rows = db.prepare(
    `SELECT ts, summary, text, refs FROM events WHERE domain=? AND kind=? ORDER BY ts DESC, rowid DESC LIMIT ?`,
  ).all(LOOP_DOMAIN, LOOP_KIND, opts.limit ?? 500) as Array<{ ts: string; summary: string | null; text: string; refs: string | null }>;
  const byId = new Map<string, LoopAgentRecord>();
  const strArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  for (const r of rows) {
    let refs: Record<string, unknown> = {};
    try { refs = r.refs ? JSON.parse(r.refs) as Record<string, unknown> : {}; } catch { continue; }
    const loopId = typeof refs.loopId === 'string' ? refs.loopId : '';
    if (!loopId || byId.has(loopId)) continue;   // ts DESC → 첫 등장이 최신 상태
    const status = (refs.status === 'ended' || refs.status === 'removed') ? refs.status : 'active';
    byId.set(loopId, {
      ts: r.ts, loopId,
      name: typeof refs.name === 'string' ? refs.name : (r.summary ?? r.text),
      summary: (r.summary ?? r.text), status,
      loopKind: (refs.loopKind as LoopKind) ?? 'autonomous',
      lifecycle: (refs.lifecycle as LoopLifecycle) ?? 'ephemeral',
      ...(typeof refs.ttlMin === 'number' ? { ttlMin: refs.ttlMin } : {}),
      ...(typeof refs.missionId === 'string' ? { missionId: refs.missionId } : {}),
      scheduleIds: strArr(refs.scheduleIds), taskIds: strArr(refs.taskIds),
      ...(typeof refs.createdByLoop === 'string' ? { createdByLoop: refs.createdByLoop } : {}),
    });
  }
  let out = [...byId.values()];
  if (opts.missionId) out = out.filter((l) => l.missionId === opts.missionId);
  if (opts.standaloneOnly) out = out.filter((l) => !l.missionId);
  if (opts.loopKind) out = out.filter((l) => l.loopKind === opts.loopKind);
  if (opts.lifecycle) out = out.filter((l) => l.lifecycle === opts.lifecycle);
  if (!opts.includeEnded) out = out.filter((l) => l.status === 'active');
  return out;
}

/**
 * 좀비 감지(P3) — ephemeral 인데 TTL(분) 초과하고도 active 인 루프. now 주입(테스트).
 * 좀비 = 종료됐어야 하는데 원장상 살아있는 루프(정리 대상).
 */
export function detectZombieLoops(db: Database, nowMs: number): LoopAgentRecord[] {
  return listLoopAgents(db, { lifecycle: 'ephemeral' }).filter((l) => {
    if (l.ttlMin == null) return false;
    const ageMin = (nowMs - Date.parse(l.ts)) / 60_000;
    return Number.isFinite(ageMin) && ageMin > l.ttlMin;
  });
}

/**
 * ★ 역방향 정합성 감지(대표 2026-07-16·크론↔루프원장) — schedule_registry 의 loop 사이클 크론 중
 * loop-agent-registry 에 미등록인 것. detectZombieLoops(순방향·등록됐는데 stale)의 역방향("도는데
 * 미등록"). 이번 세션 실측 갭: market-posture-cycle 크론(5분주기)이 돌았으나 루프 원장 미등록이라 관측
 * 사각지대에 빠짐(사람이 점검해서 잡음). loopCrons 는 caller 가 "loop 사이클 크론"으로 미리 필터
 * (isSelfRegisteringLoopScript 로 registerLoopAgentSafe 호출 스크립트만 — 유지보수 크론 오탐 없음).
 * 순수 set-difference·테스트. 반환=등록된 어떤 루프의 scheduleIds 에도 없는 loop 크론.
 */
export function detectUnregisteredLoopCrons<T extends { id: string }>(
  loopRecords: readonly { scheduleIds: readonly string[] }[],
  loopCrons: readonly T[],
): T[] {
  const registered = new Set<string>();
  for (const l of loopRecords) for (const s of l.scheduleIds) registered.add(s);
  return loopCrons.filter((c) => !registered.has(c.id));
}

/**
 * 스크립트가 self-registering loop 인가 — 소스에 registerLoopAgentSafe 호출이 있으면 loop 사이클
 * (유지보수 크론은 호출 안 하니 제외·오탐 없음). command 에서 scripts/*.ts 경로를 뽑아 소스 read(주입).
 * fail-soft(읽기 실패=false). 역방향 감지의 "loop 크론" 판정 술어.
 */
export function isSelfRegisteringLoopScript(command: string, readSource: (path: string) => string | null): boolean {
  const m = command.match(/(scripts\/[\w.-]+\.ts)/);
  if (!m) return false;
  const src = readSource(m[1]!);
  return src != null && src.includes('registerLoopAgentSafe');
}

/** 편의 — 기본 DB 열어 등록(스크립트용·fail-soft). */
export function registerLoopAgentSafe(input: LoopAgentInput): void {
  try { const db = openSurfaceEventsDb(); try { registerLoopAgent(db, input); } finally { db.close(); } }
  catch { /* fail-soft — 원장 등록 실패가 루프를 막지 않음 */ }
}

/** 기본 DB에서 루프 종료 표기(fail-soft). */
export function endLoopAgentSafe(loopId: string): void {
  try { const db = openSurfaceEventsDb(); try { endLoopAgent(db, loopId); } finally { db.close(); } }
  catch { /* fail-soft — 원장 종료 실패가 루프를 막지 않음 */ }
}
