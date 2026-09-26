// ── 미션 중복 체크 게이트 (대표 지시 2026-07-11) ─────────────────────────────
//
// 대표: "이미 등록된 미션·태스크와의 비교 체크. 미션·태스크 카탈로그가 조회 가능하고 잘 등록돼
// 있어야 하며, 비교해서 기존 미션과의 중복을 이야기하고 통합 방안을 다시 되물어봐야 한다."
//
// 새 미션의 골을 기존 등록 미션(+태스크 제목)과 비교(LLM sol/high 리즈닝) → 중복/겹침 발견 시
// 통합 방안과 함께 플랜 초안(HITL 서피스)에 기록 → 대표가 통합할지 되묻는다. 전부 주입 seam.
// fail-soft(비교 실패로 미션 안 막음). 자동 통합/삭제 없음 — 수렴점은 사람 확인.

import { tierModel } from '../llm/model-defaults.js';
import { getMission, listMissions } from './mission-registry.js';
import { TaskStore } from '../task-orchestrator/store.js';
import { proposalDraftPath } from './build/build-target.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OverlapMatch {
  /** 기존 미션 id 또는 task id. */
  id: string;
  /** 기존 미션 goal 또는 task title. */
  label: string;
  kind: 'mission' | 'task';
  /** 왜 겹치는가(한 줄). */
  overlap: string;
  /** 통합 제안(한 줄). */
  consolidation: string;
}

export interface DedupResult {
  ok: boolean;
  overlaps: OverlapMatch[];
  /** 비교 대상(기존 미션/태스크) 수. */
  comparedCount: number;
  note?: string;
  error?: string;
}

/** 비교 후보 항목(카탈로그). */
export interface CatalogItem { id: string; label: string; kind: 'mission' | 'task'; status: string }
/** LLM 비교 seam(기본 sol/high). 새 골 vs 카탈로그 → 겹치는 항목 id + 사유 + 통합안. */
export type CompareOverlap = (
  goal: string, catalog: CatalogItem[],
) => Promise<Array<{ id: string; overlap: string; consolidation: string }>>;

const DMODEL = () => process.env.ELANOUS_DECOMPOSE_MODEL || tierModel('better');
const DEFFORT = () => (process.env.ELANOUS_DECOMPOSE_EFFORT || 'high') as 'minimal'|'low'|'medium'|'high'|'xhigh'|'max';

async function defaultCompare(goal: string, catalog: CatalogItem[]): Promise<Array<{ id: string; overlap: string; consolidation: string }>> {
  const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
  const model = DMODEL();
  const provider = resolveDefaultProvider(model);
  const list = catalog.map((c) => `- [${c.kind}:${c.id}] (${c.status}) ${c.label}`).join('\n');
  const prompt = [
    'You detect whether a NEW mission overlaps/duplicates any EXISTING mission or task, so a human can consolidate.',
    '', `NEW mission goal:\n${goal}`, '', `EXISTING missions/tasks (catalog):\n${list}`, '',
    'Return ONLY items that genuinely overlap (same target/scope/intent). For each, suggest how to consolidate',
    '(merge into existing, make dependent, or supersede). Be conservative — do not flag unrelated items.',
    'Respond with ONE JSON object, no fences:',
    '{"overlaps": [{"id": "<catalog id>", "overlap": "<one line>", "consolidation": "<one line>"}, ...]}',
  ].join('\n');
  let full = '';
  await streamLLM([{ role: 'user', content: prompt }], (_d, all) => { full = all; },
    { model, reasoningEffort: DEFFORT(), ...(provider ? { provider } : {}) });
  return parseOverlaps(full);
}

/** 비교 응답 파싱(fence/prose 관대). 실패 시 빈 배열(중복 없음으로 안전). */
export function parseOverlaps(raw: string): Array<{ id: string; overlap: string; consolidation: string }> {
  if (typeof raw !== 'string') return [];
  const s = raw.replace(/```(?:json)?/g, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return [];
  try {
    const j = JSON.parse(s.slice(a, b + 1)) as { overlaps?: unknown };
    if (!Array.isArray(j.overlaps)) return [];
    return j.overlaps
      .map((o) => o as Record<string, unknown>)
      .filter((o) => typeof o.id === 'string')
      .map((o) => ({ id: o.id as string, overlap: typeof o.overlap === 'string' ? o.overlap : '', consolidation: typeof o.consolidation === 'string' ? o.consolidation : '' }));
  } catch { return []; }
}

export interface DedupDeps { store?: TaskStore; compare?: CompareOverlap; maxCatalog?: number }

/** 미션 중복 체크 — 기존 활성 미션(+backlog/ready 태스크)과 비교 → 겹치면 통합안과 함께
 *  플랜 초안(HITL)에 기록. 자동 통합 없음(사람 확인). */
export async function checkMissionOverlap(missionId: string, deps: DedupDeps = {}): Promise<DedupResult> {
  const store = deps.store ?? new TaskStore();
  const owns = !deps.store;
  try {
    const m = getMission(store, missionId);
    if (!m) return { ok: false, overlaps: [], comparedCount: 0, error: `미션 없음: ${missionId}` };

    // 카탈로그: 활성 미션(done/failed/disarmed 제외·자신 제외) + 그 미션들의 backlog/ready 태스크.
    const activeStatuses = new Set(['proposed', 'armed', 'running', 'planning']);
    const missions = listMissions(store, {}).filter((x) => x.id !== m.id && activeStatuses.has(String(x.status ?? '')));
    const cap = deps.maxCatalog ?? 40;
    const catalog: CatalogItem[] = [];
    for (const x of missions.slice(0, cap)) catalog.push({ id: x.id, label: x.goal, kind: 'mission', status: String(x.status ?? '') });
    // 미션 소속 아닌 독립 backlog/ready 태스크도 일부 포함(중복 후보).
    for (const t of store.listTasks({}).filter((t) => (t.status === 'backlog' || t.status === 'ready') && t.goalSlug !== m.id).slice(0, cap)) {
      catalog.push({ id: t.id, label: t.title, kind: 'task', status: t.status });
    }
    if (catalog.length === 0) return { ok: true, overlaps: [], comparedCount: 0, note: '기존 미션/태스크 없음(중복 없음)' };

    let raw: Array<{ id: string; overlap: string; consolidation: string }>;
    try { raw = await (deps.compare ?? defaultCompare)(m.goal, catalog); }
    catch (e) { return { ok: false, overlaps: [], comparedCount: catalog.length, error: e instanceof Error ? e.message.slice(0, 150) : String(e) }; }

    const byId = new Map(catalog.map((c) => [c.id, c]));
    const overlaps: OverlapMatch[] = raw
      .filter((o) => byId.has(o.id))
      .map((o) => ({ id: o.id, label: byId.get(o.id)!.label, kind: byId.get(o.id)!.kind, overlap: o.overlap, consolidation: o.consolidation }));

    if (overlaps.length > 0) recordOverlap(m.id, m.goal, overlaps);
    return { ok: true, overlaps, comparedCount: catalog.length };
  } finally {
    if (owns) store.close();
  }
}

function recordOverlap(missionId: string, goal: string, overlaps: OverlapMatch[]): void {
  if (process.env.NODE_ENV === 'test') return; // 테스트 격리 — 실 FS(플랜 초안) 미기록.
  try {
    const path = proposalDraftPath(missionId);
    mkdirSync(dirname(path), { recursive: true });
    const lines = [
      '', '---', `## ♻️ 기존 미션·태스크 중복 체크 (HITL — 통합 여부 확인)`, `> 골: ${goal}`, '',
      `기존과 겹치는 항목 ${overlaps.length}건:`,
      ...overlaps.map((o) => `- [${o.kind}:${o.id}] "${o.label}"\n    · 겹침: ${o.overlap}\n    · 통합안: ${o.consolidation}`),
      '', '이 미션을 새로 진행할지, 기존과 통합/의존/대체할지 확인해 주세요.',
    ];
    appendFileSync(path, lines.join('\n'));
  } catch { /* fail-soft */ }
}
