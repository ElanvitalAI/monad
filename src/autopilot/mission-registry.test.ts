import { test, expect, describe } from 'bun:test';
import {
  openAutopilotMissionsDb, createMission, createMissionWithSlug, getMission, listMissions,
  updateMissionStatus, attachRunId, mintMissionId, slugify,
  attachChildMission, getChildMissionIds, setMissionDescription, extractSlugSource,
  carveDiscoveryMission,
} from './mission-registry.js';
import { openMissionEdgesDb, listMissionEdges } from './mission-edges.js';

const at = new Date(2026, 6, 9, 8, 30, 0); // 로컬 2026-07-09 08:30

describe('slugify', () => {
  test('공백/기호 → dash, 한글 유지, max 자름', () => {
    expect(slugify('삼성전자 매력도 백테스트')).toBe('삼성전자-매력도-백테스트');
    expect(slugify('Add caching to X!!!')).toBe('add-caching-x'); // 'to' 불용어 제거
    expect(slugify('   ')).toBe('goal');
    expect(slugify('averyverylongwordthatexceedslimit', 10)).toBe('averyveryl');
  });
  test('불용어(조사·주어) 제거로 핵심 명사만', () => {
    expect(slugify('monad 가 대화 기억을 무한히 쌓지')).toBe('대화-기억을-무한히-쌓지'); // monad·가 제거
  });
  test('extractSlugSource — 따옴표 핵심어 우선', () => {
    expect(extractSlugSource('monad 가 "기억 생애주기" 시스템 설계')).toBe('기억 생애주기');
    expect(slugify(extractSlugSource('monad 가 "기억 생애주기" 시스템'))).toBe('기억-생애주기');
    expect(extractSlugSource('따옴표 없는 골')).toBe('따옴표 없는 골'); // 없으면 원문
  });
  test('mintMissionId slugOverride(LLM slug) 사용 · hash 는 골 기반 불변', () => {
    const id = mintMissionId('아주 긴 한국어 골 문장 여러가지', at, '', 'memory-lifecycle');
    expect(id).toMatch(/^apm_memory-lifecycle_[0-9a-f]{6}$/);
    // slug 가 달라도 hash 는 골+ts 기반이라 동일(유일성 slug 무관)
    const h1 = mintMissionId('동일 골', at, '', 'slug-a').split('_').pop();
    const h2 = mintMissionId('동일 골', at, '', 'slug-b').split('_').pop();
    expect(h1).toBe(h2);
  });
});

describe('mintMissionId', () => {
  test('apm_<slug>_<hash> 형식(시간값 없음)·결정론', () => {
    const id = mintMissionId('Add caching', at);
    expect(id).toMatch(/^apm_add-caching_[0-9a-f]{6}$/);
    expect(mintMissionId('Add caching', at)).toBe(id); // 동일 입력 → 동일 id
  });
  test('골이 다르면 hash 다름', () => {
    expect(mintMissionId('A', at)).not.toBe(mintMissionId('B', at));
  });
});

describe('createMissionWithSlug — 영문 id 단일 창구(2026-07-14)', () => {
  test('slug 미지정 → slugFn(LLM seam) 영문 title 로 id 발급', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = await createMissionWithSlug(db, { goal: '한글 골 제출', source: 'human-intent', now: at },
      { slugFn: async () => 'english-kebab-title' });
    expect(m.id).toMatch(/^apm_english-kebab-title_[0-9a-f]{6}$/);
    db.close();
  });
  test('slug 지정(사전 생성) → slugFn 호출 없이 그대로 사용', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    let called = 0;
    const m = await createMissionWithSlug(db, { goal: '한글 골', source: 'human-intent', now: at, slug: 'pre-made' },
      { slugFn: async () => { called++; return 'never'; } });
    expect(m.id).toMatch(/^apm_pre-made_[0-9a-f]{6}$/);
    expect(called).toBe(0);
    db.close();
  });
  test('slugFn 이 빈 문자열 반환 → 휴리스틱 fallback(기존 계약 유지)', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = await createMissionWithSlug(db, { goal: 'Add caching', source: 'manual', now: at },
      { slugFn: async () => '' });
    expect(m.id).toMatch(/^apm_add-caching_[0-9a-f]{6}$/);
    db.close();
  });
});

describe('mission registry CRUD', () => {
  test('create → get 라운드트립(triage 포함)', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, {
      goal: '반도체 섹터 매일 아침 리포트',
      source: 'human-intent',
      triage: { executionModel: 'scheduler', tier: 'light', engine: 'schedule_manage', rationale: '주기·상시', confidence: 'high' },
      now: at,
    });
    expect(m.id).toContain('apm_');
    expect(m.status).toBe('proposed');
    expect(m.execution_model).toBe('scheduler');
    const got = getMission(db, m.id)!;
    expect(got.goal).toBe('반도체 섹터 매일 아침 리포트');
    expect(got.engine).toBe('schedule_manage');
  });

  test('setMissionDescription 은 준비 맥락을 저장하고 조회에 노출(회상/추적용)', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: 'memory-lifecycle 복원', source: 'human-intent', now: at });
    expect(getMission(db, m.id)!.description ?? '').toBe(''); // 준비 전엔 비어있음
    const desc = '골: memory-lifecycle 복원\n## 외부조사 (보강 2)\n- 보강: cron 재등록\n- 교정: 작업디렉터리 확인';
    setMissionDescription(db, m.id, desc);
    expect(getMission(db, m.id)!.description).toBe(desc); // 저장 + MissionRow 노출
  });

  test('list 필터(status·source) + 최신순', () => {
    const db = openAutopilotMissionsDb(':memory:');
    createMission(db, { goal: 'g1', source: 'human-intent', now: new Date(2026, 6, 9, 8, 0) });
    const m2 = createMission(db, { goal: 'g2', source: 'discovery', now: new Date(2026, 6, 9, 9, 0) });
    updateMissionStatus(db, m2.id, 'armed');
    expect(listMissions(db).length).toBe(2);
    expect(listMissions(db)[0]!.goal).toBe('g2'); // 최신 먼저
    expect(listMissions(db, { source: 'discovery' }).length).toBe(1);
    expect(listMissions(db, { status: 'armed' })[0]!.id).toBe(m2.id);
  });

  test('updateMissionStatus', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: 'g', source: 'manual', now: at });
    updateMissionStatus(db, m.id, 'running');
    expect(getMission(db, m.id)!.status).toBe('running');
  });

  test('★ building 상태소유(대표 2026-07-21) — proposed→building→복원 persist round-trip', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: 'youtube absorb 설계', source: 'human-intent', now: at });
    expect(m.status).toBe('proposed');
    updateMissionStatus(db, m.id, 'building'); // 조율자 build 진입
    expect(getMission(db, m.id)!.status).toBe('building'); // ops 가 '빌드 중' 표시 가능
    expect(listMissions(db, { status: 'building' })[0]!.id).toBe(m.id); // 필터도 인식
    updateMissionStatus(db, m.id, 'proposed'); // build 완료 → 이전 상태 복원(승인대기)
    expect(getMission(db, m.id)!.status).toBe('proposed');
  });

  test('attachRunId — 중복 무시·복수 누적', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: 'g', source: 'human-intent', now: at });
    attachRunId(db, m.id, 'run_1');
    attachRunId(db, m.id, 'run_1'); // 중복
    attachRunId(db, m.id, 'run_2');
    expect(JSON.parse(getMission(db, m.id)!.run_ids!)).toEqual(['run_1', 'run_2']);
  });
});

describe('coordinator 계층 (child mission · C0)', () => {
  test('attachChildMission → childMissionIds + 자식 parentMissionId(중복 무시)', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const parent = createMission(db, { goal: '포트폴리오 조율', source: 'human-intent', triage: { executionModel: 'coordinator' }, now: at });
    const childA = createMission(db, { goal: '삼성캡스톤 계약', source: 'human-intent', now: at });
    const childB = createMission(db, { goal: '한국레버 계약', source: 'human-intent', now: at });
    attachChildMission(db, parent.id, childA.id);
    attachChildMission(db, parent.id, childB.id);
    attachChildMission(db, parent.id, childA.id); // 중복
    expect(getChildMissionIds(db, parent.id).sort()).toEqual([childA.id, childB.id].sort());
    // 자식엔 parentMissionId(양방향).
    expect(db.getMission(childA.id)?.autopilot?.parentMissionId).toBe(parent.id);
    // ★ 가시성 갭 수정(대표 2026-07-16) — registry getMission(MissionRow) 이 링크 노출.
    const parentRow = getMission(db, parent.id);
    expect(JSON.parse(parentRow!.child_mission_ids!).sort()).toEqual([childA.id, childB.id].sort());
    expect(getMission(db, childA.id)?.parent_mission_id).toBe(parent.id);
    expect(getMission(db, childB.id)?.parent_mission_id).toBe(parent.id);
    // 링크 없는 미션은 null(노이즈 없음).
    const solo = createMission(db, { goal: '독립 미션', source: 'human-intent', now: at });
    expect(getMission(db, solo.id)?.parent_mission_id).toBeNull();
    expect(getMission(db, solo.id)?.child_mission_ids).toBeNull();
  });
  test('self-attach 무시', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: 'x', source: 'human-intent', now: at });
    attachChildMission(db, m.id, m.id);
    expect(getChildMissionIds(db, m.id)).toEqual([]);
  });
  test('비-coordinator 미션은 childMissionIds 부재(회귀 0)', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: 'g', source: 'human-intent', now: at });
    expect(getChildMissionIds(db, m.id)).toEqual([]);
  });
});

describe('carveDiscoveryMission (E3 발견→파생 미션·미션 생태계 §4.2)', () => {
  test('발견 → 파생 미션(proposed·discovery) + parentMissionId + continuation 엣지', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const parent = createMission(db, { goal: '부모 미션', source: 'human-intent', now: at });
    const edgeDb = openMissionEdgesDb(':memory:');
    const childId = carveDiscoveryMission(db, parent.id, { goal: '구현 중 발견한 리팩토링', evidence: 'X 모듈 중복 발견' }, { now: at, edgeDb });
    expect(childId).toBeTruthy();
    // 파생 미션 = proposed·discovery·양방향 계보
    const childRow = getMission(db, childId!);
    expect(childRow?.status).toBe('proposed');
    expect(childRow?.source).toBe('discovery');
    expect(childRow?.parent_mission_id).toBe(parent.id);
    expect(getChildMissionIds(db, parent.id)).toContain(childId!);
    // continuation 엣지(발견 흐름·evidence) 그래프 기록
    const cont = listMissionEdges({ missionId: parent.id, kind: 'continuation' }, { db: edgeDb });
    expect(cont).toHaveLength(1);
    expect(cont[0]?.toId).toBe(childId!);
    expect(cont[0]?.evidence).toBe('X 모듈 중복 발견');
  });

  test('부모 없거나 빈 골 → null(무생성)', () => {
    const db = openAutopilotMissionsDb(':memory:');
    expect(carveDiscoveryMission(db, 'nonexistent', { goal: 'x' })).toBeNull();
    const p = createMission(db, { goal: 'p', source: 'manual', now: at });
    expect(carveDiscoveryMission(db, p.id, { goal: '   ' })).toBeNull();
    expect(getChildMissionIds(db, p.id)).toEqual([]); // 빈 골이면 파생 안 됨
  });
});
