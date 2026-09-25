import { describe, it, expect } from 'bun:test';
import { openAutopilotMissionsDb, createMission } from './mission-registry.js';
import {
  attachAssociatedMission, removeAssociatedMission, getAssociatedMissions,
  parseGroundingFiles, associateFileOverlap, detectAssociateConflicts,
} from './mission-associate.js';

const AT = new Date('2026-07-14T00:00:00Z');

function twoMissions() {
  const db = openAutopilotMissionsDb(':memory:');
  const a = createMission(db, { goal: '골 A', source: 'manual', now: AT, slug: 'goal-a' });
  const b = createMission(db, { goal: '골 B', source: 'manual', now: AT, slug: 'goal-b' });
  return { db, a: a.id, b: b.id };
}

describe('A6-c 연관 미션 fabric', () => {
  it('attach 는 양방향으로 링크하고 영속화(saveMission 왕복)한다', () => {
    const { db, a, b } = twoMissions();
    attachAssociatedMission(db, a, b, 'friend', '재실행 변형', AT);
    const la = getAssociatedMissions(db, a);
    const lb = getAssociatedMissions(db, b);
    expect(la).toEqual([{ id: b, relation: 'friend', note: '재실행 변형' }]);
    expect(lb).toEqual([{ id: a, relation: 'friend', note: '재실행 변형' }]);
  });

  it('self-link·미존재 미션은 무시', () => {
    const { db, a } = twoMissions();
    attachAssociatedMission(db, a, a, 'friend', undefined, AT);       // self
    attachAssociatedMission(db, a, 'apm_nope', 'associate', undefined, AT); // 미존재
    expect(getAssociatedMissions(db, a)).toEqual([]);
  });

  it('중복 attach 는 upsert(같은 id+relation 1건 유지)', () => {
    const { db, a, b } = twoMissions();
    attachAssociatedMission(db, a, b, 'associate', 'v1', AT);
    attachAssociatedMission(db, a, b, 'associate', 'v2', AT);
    expect(getAssociatedMissions(db, a)).toEqual([{ id: b, relation: 'associate', note: 'v2' }]);
  });

  it('다른 relation 은 공존(friend + associate)', () => {
    const { db, a, b } = twoMissions();
    attachAssociatedMission(db, a, b, 'friend', undefined, AT);
    attachAssociatedMission(db, a, b, 'associate', undefined, AT);
    expect(getAssociatedMissions(db, a).map((l) => l.relation).sort()).toEqual(['associate', 'friend']);
  });

  it('remove 는 양방향 해제(relation 지정)', () => {
    const { db, a, b } = twoMissions();
    attachAssociatedMission(db, a, b, 'friend', undefined, AT);
    attachAssociatedMission(db, a, b, 'associate', undefined, AT);
    removeAssociatedMission(db, a, b, 'friend', AT);
    expect(getAssociatedMissions(db, a)).toEqual([{ id: b, relation: 'associate' }]);
    expect(getAssociatedMissions(db, b)).toEqual([{ id: a, relation: 'associate' }]);
  });

  it('remove relation 미지정 시 그 대상과의 모든 관계 제거', () => {
    const { db, a, b } = twoMissions();
    attachAssociatedMission(db, a, b, 'friend', undefined, AT);
    attachAssociatedMission(db, a, b, 'associate', undefined, AT);
    removeAssociatedMission(db, a, b, undefined, AT);
    expect(getAssociatedMissions(db, a)).toEqual([]);
    expect(getAssociatedMissions(db, b)).toEqual([]);
  });
});

describe('A6-c associate 충돌 경보 helper', () => {
  it('parseGroundingFiles 는 "## 내부 grounding" 섹션의 파일만 추출', () => {
    const desc = [
      '골: X', '', '## 분해 (2 페이즈)', '  0. 조사',
      '', '## 내부 grounding — 기존 관련 파일 2 (재사용·확장·중복금지)',
      '- src/foo.ts', '- src/bar.ts',
      '', '## 중복 (0건)',
    ].join('\n');
    expect(parseGroundingFiles(desc)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('parseGroundingFiles 는 grounding 섹션 없으면 []', () => {
    expect(parseGroundingFiles('골: X\n## 분해\n- 페이즈')).toEqual([]);
    expect(parseGroundingFiles(null)).toEqual([]);
  });

  it('associateFileOverlap 은 정규화 교집합', () => {
    expect(associateFileOverlap(['./src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/c.ts'])).toEqual(['src/a.ts']);
    expect(associateFileOverlap(['src/a.ts'], ['src/b.ts'])).toEqual([]);
  });

  it('detectAssociateConflicts 는 두 미션 grounding 겹침을 낸다', () => {
    const { db, a, b } = twoMissions();
    const mkDesc = (f: string) => `골\n\n## 내부 grounding — 기존 관련 파일 1\n- ${f}`;
    const ma = db.getMission(a)!; db.saveMission({ ...ma, description: mkDesc('src/shared.ts') });
    const mb = db.getMission(b)!; db.saveMission({ ...mb, description: mkDesc('src/shared.ts') });
    expect(detectAssociateConflicts(db, a, b)).toEqual(['src/shared.ts']);
  });
});
