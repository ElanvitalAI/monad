// ── 미션 아크 A6-c — 연관 미션 fabric (friend/associate) ──────────────────────
// RFC-mission-arcs §9 · PLAN-mission-arc-a6-goal-altitude-anti-inflation §6.
//
// parent/child(성숙도 후속·조율 하위)와 별개인 **동급(peer) 관계**를 CRUD·추적·경보한다:
//   friend    = 동일 골 계보의 재실행/변형(형제). 예: rerun·arc-revise 로 파생.
//   associate = 다른 골이나 자원·산출 공유(같은 파일 → 충돌 경보).
//
// ★ 영속화 규율(#4143 교훈) — executor 의 copy-mutation 트랩(resolveArcs 복사본 status 를 바꾸고
//   saveMission 안 함 → 증발)을 피한다. 모든 관계 mutation 은 in-memory 변경이 아니라 store.saveMission
//   되쓰기로만 성립(attachChildMission·mission-registry.ts:311 검증된 패턴 미러). 동급이라 **양방향**.
//
// 제1원칙 준수 — 관계 변경을 ops_events(mission_linked)로 관측(monad ops timeline·autopilot trace fan-in).

import type { TaskStore } from '../task-orchestrator/store.js';
import type { MissionRelationLink } from '../task-orchestrator/mission.js';
import { upsertRelationLink, removeRelationLink } from './mission-arc.js';
import { recordOpsEventSafe } from '../domains/ops-log.js';
import { debug } from '../debug/log.js';

/** 한 미션의 연관 링크 목록(없으면 []). */
export function getAssociatedMissions(store: TaskStore, id: string): MissionRelationLink[] {
  const m = store.getMission(id);
  return m?.autopilot?.associatedMissionIds ? [...m.autopilot.associatedMissionIds] : [];
}

/** 한 미션의 associatedMissionIds 를 갱신 후 saveMission 되쓰기(영속화 규율). fail-soft 아님(호출측 가드). */
function writeLinks(store: TaskStore, id: string, links: readonly MissionRelationLink[], now: Date): void {
  const m = store.getMission(id);
  if (!m) return;
  store.saveMission({
    ...m,
    autopilot: { ...(m.autopilot ?? { origin: 'manual' }), associatedMissionIds: [...links] },
    updatedAt: now.getTime(),
  });
}

/**
 * 두 미션을 동급 관계로 연결(양방향). 중복(같은 id+relation)은 upsert 로 갱신.
 * self-link·미존재 미션은 무시. 관계 변경은 ops_events(mission_linked)로 추적.
 */
export function attachAssociatedMission(
  store: TaskStore,
  id: string,
  targetId: string,
  relation: MissionRelationLink['relation'],
  note?: string,
  now: Date = new Date(),
): void {
  if (id === targetId) return;
  const a = store.getMission(id);
  const b = store.getMission(targetId);
  if (!a || !b) return;
  const link: MissionRelationLink = note ? { id: targetId, relation, note } : { id: targetId, relation };
  const backLink: MissionRelationLink = note ? { id, relation, note } : { id, relation };
  writeLinks(store, id, upsertRelationLink(a.autopilot?.associatedMissionIds, link), now);
  writeLinks(store, targetId, upsertRelationLink(b.autopilot?.associatedMissionIds, backLink), now);
  debug.log('mission.link', 'attach', { id, targetId, relation, note });
  recordOpsEventSafe({
    entityType: 'mission', entityId: id, event: 'mission_linked',
    rationale: `${relation} → ${targetId}${note ? ` (${note})` : ''}`,
    actor: 'manual', refs: { relation, targetId, direction: 'attach', ...(note ? { note } : {}) },
    now: () => now.toISOString(),
  });
}

/** 동급 관계 해제(양방향). relation 미지정 시 그 targetId 로의 모든 관계 제거. */
export function removeAssociatedMission(
  store: TaskStore,
  id: string,
  targetId: string,
  relation?: MissionRelationLink['relation'],
  now: Date = new Date(),
): void {
  const a = store.getMission(id);
  const b = store.getMission(targetId);
  if (a) writeLinks(store, id, removeRelationLink(a.autopilot?.associatedMissionIds, targetId, relation), now);
  if (b) writeLinks(store, targetId, removeRelationLink(b.autopilot?.associatedMissionIds, id, relation), now);
  if (!a && !b) return;
  debug.log('mission.link', 'remove', { id, targetId, relation });
  recordOpsEventSafe({
    entityType: 'mission', entityId: id, event: 'mission_linked',
    rationale: `unlink ${relation ?? '*'} ✗ ${targetId}`,
    actor: 'manual', refs: { relation: relation ?? null, targetId, direction: 'remove' },
    now: () => now.toISOString(),
  });
}

// ── associate 충돌 경보 — 같은 파일을 건드리는 미션끼리 동시 개발 파괴 방지(read-only 경보) ──
// se-mission-prepare 가 description 에 심는 "## 내부 grounding — 기존 관련 파일 …" 섹션의 `- <file>`
// 라인을 파싱해 두 미션의 grounding 파일 교집합을 낸다. fail-soft(파싱 불가 시 빈 배열).

/** description 의 grounding 섹션에서 파일 경로를 추출(순수). */
export function parseGroundingFiles(description: string | null | undefined): string[] {
  if (!description) return [];
  const lines = description.split('\n');
  const start = lines.findIndex((l) => l.includes('## 내부 grounding'));
  if (start < 0) return [];
  const files: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l.startsWith('## ')) break;                 // 다음 섹션에서 종료
    const m = /^-\s+(\S.*)$/.exec(l);
    if (m) files.push(m[1]!.trim());
  }
  return files;
}

/** 두 파일 목록의 교집합(정규화·순수). */
export function associateFileOverlap(filesA: readonly string[], filesB: readonly string[]): string[] {
  const norm = (f: string) => f.replace(/^\.\//, '').trim();
  const setB = new Set(filesB.map(norm));
  return [...new Set(filesA.map(norm))].filter((f) => setB.has(f));
}

/** 두 미션의 grounding 파일 겹침(associate 충돌 후보). fail-soft(빈 배열). */
export function detectAssociateConflicts(store: TaskStore, id: string, targetId: string): string[] {
  try {
    const a = store.getMission(id);
    const b = store.getMission(targetId);
    if (!a || !b) return [];
    return associateFileOverlap(parseGroundingFiles(a.description), parseGroundingFiles(b.description));
  } catch { return []; }
}
