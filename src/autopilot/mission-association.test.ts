import { describe, it, expect } from 'bun:test';
import { associationScore, parseGroundingFiles, linkMissionAssociations, ASSOCIATION_THRESHOLD } from './mission-association.js';
import { openMissionEdgesDb, listMissionEdges } from './mission-edges.js';
import type { Database } from 'bun:sqlite';

const freshDb = (): Database => openMissionEdgesDb(':memory:');

describe('associationScore (Jaccard·순수)', () => {
  it('완전 동일 → 1', () => {
    expect(associationScore(['a', 'b'], ['a', 'b'])).toBe(1);
  });
  it('교집합 없음 → 0', () => {
    expect(associationScore(['a'], ['b'])).toBe(0);
  });
  it('부분 교집합 → Jaccard', () => {
    // {a,b,c} ∩ {b,c,d} = {b,c}=2, ∪=4 → 0.5
    expect(associationScore(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
  });
  it('빈 집합 → 0', () => {
    expect(associationScore([], ['a'])).toBe(0);
    expect(associationScore(['a'], [])).toBe(0);
  });
  it('중복·빈 문자열 정규화', () => {
    expect(associationScore(['a', 'a', ''], ['a'])).toBe(1);
  });
});

describe('parseGroundingFiles (순수)', () => {
  it('내부 grounding 섹션의 - 파일 추출', () => {
    const desc = '골: x\n\n## 내부 grounding — 기존 관련 파일 2 (재사용)\n- src/foo.ts\n- src/bar.ts\n\n## 다음 섹션\n- 무시';
    expect(parseGroundingFiles(desc)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });
  it('섹션 없으면 []', () => {
    expect(parseGroundingFiles('골만 있음')).toEqual([]);
    expect(parseGroundingFiles(null)).toEqual([]);
    expect(parseGroundingFiles(undefined)).toEqual([]);
  });
});

describe('linkMissionAssociations (엣지 링킹)', () => {
  it('임계 이상만 association 엣지·self 제외', () => {
    const db = freshDb();
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const others = [
      { id: 'M-self', files },                              // self → 제외
      { id: 'M-high', files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }, // score 1
      { id: 'M-low', files: ['src/z.ts'] },                 // score 0 → 제외
    ];
    const linked = linkMissionAssociations('M-self', files, others, { edgeDb: db, now: 1 });
    expect(linked.map((l) => l.toId)).toEqual(['M-high']);
    const edges = listMissionEdges({ kind: 'association' }, { db });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: 'M-self', toId: 'M-high', kind: 'association' });
  });

  it('빈 files → 무링크', () => {
    const db = freshDb();
    expect(linkMissionAssociations('M', [], [{ id: 'X', files: ['a'] }], { edgeDb: db })).toHaveLength(0);
    expect(listMissionEdges({}, { db })).toHaveLength(0);
  });

  it('threshold 조정', () => {
    const db = freshDb();
    const files = ['a', 'b', 'c', 'd'];
    const others = [{ id: 'X', files: ['a', 'b'] }]; // {a,b}∩=2 ∪={a,b,c,d}=4 → 0.5
    expect(linkMissionAssociations('M', files, others, { edgeDb: db, threshold: 0.6 })).toHaveLength(0);
    expect(linkMissionAssociations('M', files, others, { edgeDb: db, threshold: 0.4 })).toHaveLength(1);
  });

  it('ASSOCIATION_THRESHOLD 기본값 노출', () => {
    expect(ASSOCIATION_THRESHOLD).toBeGreaterThan(0);
    expect(ASSOCIATION_THRESHOLD).toBeLessThan(1);
  });
});
