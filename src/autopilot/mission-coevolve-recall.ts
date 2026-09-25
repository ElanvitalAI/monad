// ── 미션 간 공진화 회상 (E5-b · 미션 생태계 RFC §4.3 · 2026-07-18) ────────────────────
//
// 미션 A 의 학습(구현 이탈 deviation·회고·피드백)이 연관 미션(association)·계보(lineage)·이어가기
// (continuation)로 이어진 미션들의 분해에 회상 주입된다. "같은 코드영역에서 지난 미션이 이런 이탈을
// 겪었다·이렇게 회고됐다 → 이번 분해에 미리 반영하라". 단일 미션 공진화(분해기↔비평기)의 미션-간 상위 스케일.
//
// 회상 소스 2계열(상보):
//   ① 국소(E 트랙 소유): working-memory `deviation` — 구현 이탈.
//   ② 전역 해마(retrospection 트랙 소유): surface_events `mission.retro`(C1 회고·실패패턴 경계)·
//      `mission.feedback`(C2 피드백·정답라벨). ★ 읽기만 — 네임스페이스 계약(ALIGNMENT #4564) 준수.
//
// 안전: 읽기 전용 회상(집행 0·armed 아님). 없으면 '' — 분해에 무영향(비파괴).

import type { Database } from 'bun:sqlite';
import { listMissionEdges } from './mission-edges.js';
import { readWorkingMemory, type WorkingMemoryEntry } from './mission-working-memory.js';
import { openSurfaceEventsDb, queryEvents as defaultQueryEvents, type SurfaceEventRow } from '../domains/surface-events.js';

/** surface_events refs(JSON) 에서 missionId 추출(순수·retro 각인은 refs={missionId}). 없으면 null. */
function missionIdOfRefs(refs: string | null | undefined): string | null {
  if (!refs) return null;
  try { const o = JSON.parse(refs) as { missionId?: unknown }; return typeof o.missionId === 'string' ? o.missionId : null; }
  catch { return null; }
}

/** 이 미션과 연관된(4종 엣지 어느 방향이든) 미션들의 학습(구현 이탈 deviation + 회고/피드백 각인)을 회상해
 *  분해 프롬프트 블록으로 만든다. mission_edges 로 연관 미션을 찾고, ①워킹메모리 deviation ②surface_events
 *  mission.retro/mission.feedback(연관 missionId refs 필터·읽기만) 을 모은다. 순수(edgeDb·readWM·surfaceDb·
 *  queryEvents 주입 가능). 연관/학습 없으면 '' (분해 무영향). */
export function recallCoevolutionContext(
  missionId: string,
  deps: {
    edgeDb?: Database;
    readWM?: (id: string) => WorkingMemoryEntry[];
    surfaceDb?: Database;
    queryEvents?: (db: Database, opts: { category?: string; limit?: number }) => SurfaceEventRow[];
    maxMissions?: number;
  } = {},
): string {
  if (!missionId) return '';
  const readWM = deps.readWM ?? readWorkingMemory;
  const maxM = deps.maxMissions ?? 5;
  const edges = listMissionEdges({ missionId, direction: 'both' }, deps.edgeDb ? { db: deps.edgeDb } : {});

  // 연관 미션 id(자신 제외·중복 제거·엣지 최신순 보존).
  const related: string[] = [];
  const seen = new Set<string>([missionId]);
  for (const e of edges) {
    const other = e.fromId === missionId ? e.toId : e.fromId;
    if (!seen.has(other)) { seen.add(other); related.push(other); }
  }
  if (!related.length) return '';
  const scope = related.slice(0, maxM);
  const relatedSet = new Set(scope);

  const lines: string[] = [];
  // ① 국소 소스 — working-memory deviation(구현 이탈).
  for (const rid of scope) {
    const devs = readWM(rid).filter((e) => e.deviation).slice(0, 3);
    if (devs.length) {
      const summary = devs.map((d) => `${d.deviation!.kind}(${d.deviation!.note.slice(0, 60)})`).join('; ');
      lines.push(`- [${rid.slice(0, 40)}] 이탈: ${summary}`);
    }
  }

  // ② 전역 해마 소스(#4564 얼라인) — surface_events mission.retro/mission.feedback(읽기만·계약 준수).
  //   테스트(NODE_ENV=test)는 surfaceDb 명시 주입 시에만 조회(실 DB 접근 회피). 운영은 openSurfaceEventsDb.
  let surfaceDb: Database | null = deps.surfaceDb ?? null;
  let ownSurface = false;
  if (!surfaceDb && process.env.NODE_ENV !== 'test') {
    try { surfaceDb = openSurfaceEventsDb(); ownSurface = true; } catch { surfaceDb = null; }
  }
  if (surfaceDb) {
    try {
      const q = deps.queryEvents ?? defaultQueryEvents;
      for (const [cat, label] of [['mission.retro', '회고'], ['mission.feedback', '피드백']] as const) {
        for (const row of q(surfaceDb, { category: cat, limit: 50 })) {
          const rid = missionIdOfRefs(row.refs);
          if (rid && relatedSet.has(rid)) {
            lines.push(`- [${rid.slice(0, 40)}] ${label}: ${String(row.summary ?? row.text ?? '').replace(/\s+/g, ' ').slice(0, 100)}`);
          }
        }
      }
    } catch { /* fail-soft */ }
    finally { if (ownSurface && surfaceDb) { try { surfaceDb.close(); } catch { /* noop */ } } }
  }

  if (!lines.length) return '';
  return [
    '[연관 미션 학습(공진화·같은 코드영역/계보) — 지난 미션의 이탈·회고·피드백. 이번 분해에 미리 반영하라]',
    ...lines,
  ].join('\n');
}
