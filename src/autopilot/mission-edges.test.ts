import { describe, it, expect } from 'bun:test';
import { openMissionEdgesDb, addMissionEdge, listMissionEdges, type MissionEdgeKind } from './mission-edges.js';
import type { Database } from 'bun:sqlite';

const freshDb = (): Database => openMissionEdgesDb(':memory:');

describe('mission-edges (E2 그래프 스토어·별도 mission_edges DB)', () => {
  it('addMissionEdge + listMissionEdges 왕복', () => {
    const db = freshDb();
    addMissionEdge('A', 'B', 'lineage', 'derived', { db, now: 1 });
    const edges = listMissionEdges({}, { db });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: 'A', toId: 'B', kind: 'lineage', evidence: 'derived', createdAt: 1 });
  });

  it('dedup (from,to,kind) — evidence 갱신·createdAt 최초 보존', () => {
    const db = freshDb();
    addMissionEdge('A', 'B', 'lineage', 'v1', { db, now: 1 });
    addMissionEdge('A', 'B', 'lineage', 'v2', { db, now: 2 });
    const e = listMissionEdges({}, { db });
    expect(e).toHaveLength(1);
    expect(e[0]?.evidence).toBe('v2');
    expect(e[0]?.createdAt).toBe(1);
  });

  it('같은 from,to 라도 kind 다르면 별개 엣지', () => {
    const db = freshDb();
    addMissionEdge('A', 'B', 'lineage', '', { db, now: 1 });
    addMissionEdge('A', 'B', 'coevolution', '', { db, now: 2 });
    expect(listMissionEdges({}, { db })).toHaveLength(2);
  });

  it('self-loop·빈 id·미상 kind 는 무시', () => {
    const db = freshDb();
    addMissionEdge('A', 'A', 'lineage', '', { db });
    addMissionEdge('', 'B', 'lineage', '', { db });
    addMissionEdge('A', '', 'lineage', '', { db });
    addMissionEdge('A', 'B', 'weird' as MissionEdgeKind, '', { db });
    expect(listMissionEdges({}, { db })).toHaveLength(0);
  });

  it('direction out/in/both', () => {
    const db = freshDb();
    addMissionEdge('A', 'B', 'lineage', '', { db, now: 1 });
    addMissionEdge('C', 'A', 'continuation', '', { db, now: 2 });
    expect(listMissionEdges({ missionId: 'A', direction: 'out' }, { db })).toHaveLength(1);
    expect(listMissionEdges({ missionId: 'A', direction: 'in' }, { db })).toHaveLength(1);
    expect(listMissionEdges({ missionId: 'A', direction: 'both' }, { db })).toHaveLength(2);
    expect(listMissionEdges({ missionId: 'A' }, { db })).toHaveLength(2); // 기본 both
  });

  it('kind 필터', () => {
    const db = freshDb();
    addMissionEdge('A', 'B', 'lineage', '', { db, now: 1 });
    addMissionEdge('A', 'C', 'coevolution', '', { db, now: 2 });
    const co = listMissionEdges({ kind: 'coevolution' }, { db });
    expect(co).toHaveLength(1);
    expect(co[0]?.toId).toBe('C');
  });

  it('최신순(created_at DESC) 정렬', () => {
    const db = freshDb();
    addMissionEdge('A', 'B', 'lineage', '', { db, now: 1 });
    addMissionEdge('A', 'C', 'lineage', '', { db, now: 5 });
    expect(listMissionEdges({}, { db })[0]?.toId).toBe('C');
  });
});
