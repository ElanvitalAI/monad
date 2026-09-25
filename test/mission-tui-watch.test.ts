// ── mission-tui-watch 순수 판정 테스트 (C-b-2 PR① · 2026-07-12) ─────────────
// takeMissionReadySnapshot(I/O)은 대상 밖 — advanceMissionWatch/렌더 순수 함수만.

import { describe, expect, test } from 'bun:test';
import {
  advanceMissionWatch,
  createMissionWatchState,
  renderMissionPhaseBoardLines,
  missionDescriptionDigest,
  MISSION_WATCH_TIMEOUT_MS,
  advanceMissionRunWatch,
  createMissionRunWatchState,
  renderMissionRunPhaseLine,
  renderMissionRunFooter,
  renderMissionRunReportLines,
  MISSION_FOOTER_PREFIX,
  MISSION_RUN_WATCH_TIMEOUT_MS,
  type MissionReadySnapshot,
  type MissionRunSnapshot,
  type MissionRunPhase,
} from '../src/autopilot/mission-tui-watch.js';
import type { PhaseView } from '../src/autopilot/mission-adjust.js';

const phase = (index: number, title: string, status = 'backlog'): PhaseView =>
  ({ index, id: `task:p${index}`, title, status, dependsOn: [] });

const snap = (over: Partial<MissionReadySnapshot> = {}): MissionReadySnapshot => ({
  exists: true, goal: '테스트 골', status: 'proposed', description: '', phases: [],
  executionModel: 'walker', tier: 'light', ...over,
});

describe('advanceMissionWatch', () => {
  test('조회 실패(null)는 무이벤트 계속 — gone 으로 오판하지 않는다', () => {
    const st = createMissionWatchState(snap(), 0);
    const r = advanceMissionWatch(st, null, 3_000);
    expect(r.done).toBe(false);
    expect(r.events).toEqual([]);
  });

  test('미션 삭제 → gone·종료', () => {
    const st = createMissionWatchState(snap(), 0);
    const r = advanceMissionWatch(st, snap({ exists: false }), 3_000);
    expect(r.done).toBe(true);
    expect(r.events).toEqual([{ kind: 'gone' }]);
  });

  test('proposed 이탈(타 서피스 승인 등) → resolved-elsewhere·종료', () => {
    const st = createMissionWatchState(snap(), 0);
    const r = advanceMissionWatch(st, snap({ status: 'running' }), 3_000);
    expect(r.done).toBe(true);
    expect(r.events).toEqual([{ kind: 'resolved-elsewhere', status: 'running' }]);
  });

  test('description 변화 = 준비완료(ready) — 스냅샷 동반·종료', () => {
    const st = createMissionWatchState(snap(), 0);
    const ready = snap({ description: '골: x\n## 분해 (3 페이즈)', phases: [phase(0, 'a')] });
    const r = advanceMissionWatch(st, ready, 3_000);
    expect(r.done).toBe(true);
    expect(r.events).toEqual([{ kind: 'ready', snapshot: ready }]);
  });

  test('revise 재준비 — baseline description 과 같으면 ready 아님·달라지면 ready', () => {
    const baseline = snap({ description: '이전 준비 맥락', phases: [phase(0, 'a')] });
    const st = createMissionWatchState(baseline, 0);
    const same = advanceMissionWatch(st, baseline, 3_000);
    expect(same.done).toBe(false);
    const revised = snap({ description: '재분해된 새 맥락', phases: [phase(0, 'b')] });
    const r = advanceMissionWatch(st, revised, 6_000);
    expect(r.done).toBe(true);
    expect(r.events[0]?.kind).toBe('ready');
  });

  test('페이즈 수 전이 시에만 phases 이벤트 — 같은 수면 무소음', () => {
    const st0 = createMissionWatchState(snap(), 0);
    const withPhases = snap({ phases: [phase(0, 'a'), phase(1, 'b')] });
    const r1 = advanceMissionWatch(st0, withPhases, 3_000);
    expect(r1.done).toBe(false);
    expect(r1.events).toEqual([{ kind: 'phases', count: 2 }]);
    // 다음 틱 — 페이즈 수 그대로면 이벤트 없음(전이 시에만 라인).
    const r2 = advanceMissionWatch(r1.state, withPhases, 6_000);
    expect(r2.events).toEqual([]);
  });

  test('타임아웃 → timeout·종료 (진행 중 phases 이벤트와 병행 가능)', () => {
    const st = createMissionWatchState(snap(), 0);
    const r = advanceMissionWatch(st, snap(), MISSION_WATCH_TIMEOUT_MS + 3_000);
    expect(r.done).toBe(true);
    expect(r.events).toEqual([{ kind: 'timeout' }]);
  });
});

describe('renderMissionPhaseBoardLines', () => {
  test('빈 플랜은 단일 태스크 안내 1줄', () => {
    expect(renderMissionPhaseBoardLines([])).toEqual(['(페이즈 없음 — 단일 태스크 미션)']);
  });
  test('index·status·title 을 실행순서대로', () => {
    const lines = renderMissionPhaseBoardLines([phase(0, '조사'), phase(1, '구현', 'scheduled')]);
    expect(lines).toEqual([' 0. [backlog] 조사', ' 1. [scheduled] 구현']);
  });
  test('light placeholder(페이즈 1건 = 골 에코)는 골 반복 대신 승인 효과 안내', () => {
    const lines = renderMissionPhaseBoardLines([phase(0, '테스트 골')], { goal: '테스트 골' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('단일 태스크');
    expect(lines[0]).toContain('detached 1턴 실행');
  });
  test('페이즈 1건이라도 골과 다르면(실 분해) 보드 그대로', () => {
    expect(renderMissionPhaseBoardLines([phase(0, '조사')], { goal: '테스트 골' }))
      .toEqual([' 0. [backlog] 조사']);
  });
});

// ── PR ② — 실행 워처 순수 판정 ────────────────────────────────────────────────

const runPhase = (index: number, title: string, status: string, prUrl?: string): MissionRunPhase =>
  ({ index, id: `task:p${index}`, title, status, dependsOn: [], ...(prUrl ? { prUrl } : {}) });

const runSnap = (phases: MissionRunPhase[], over: Partial<MissionRunSnapshot> = {}): MissionRunSnapshot =>
  ({ exists: true, goal: '실행 골', status: 'running', phases, runLockActive: false, ...over });
/** run-mission 프로세스 생존 중 스냅샷 — 종결 판정 확정에 lock 관찰이 필요. */
const locked = (phases: MissionRunPhase[]): MissionRunSnapshot => runSnap(phases, { runLockActive: true });

describe('advanceMissionRunWatch', () => {
  test('approve 직후(ready) baseline → running 전이 시에만 phase 이벤트', () => {
    const st0 = createMissionRunWatchState(runSnap([runPhase(0, 'a', 'ready'), runPhase(1, 'b', 'backlog')]), 0);
    // 같은 상태 재관찰 — 무소음.
    const r0 = advanceMissionRunWatch(st0, runSnap([runPhase(0, 'a', 'ready'), runPhase(1, 'b', 'backlog')]), 5_000);
    expect(r0.done).toBe(false);
    expect(r0.events).toEqual([]);
    // p0 running 진입 — phase 이벤트 1건.
    const r1 = advanceMissionRunWatch(r0.state, runSnap([runPhase(0, 'a', 'running'), runPhase(1, 'b', 'backlog')]), 10_000);
    expect(r1.done).toBe(false);
    expect(r1.events).toHaveLength(1);
    expect(r1.events[0]).toMatchObject({ kind: 'phase', phase: { id: 'task:p0', status: 'running' }, total: 2 });
  });

  test('backlog→ready 승격은 무소음(집행 개시는 running 이 알린다)', () => {
    const st = createMissionRunWatchState(runSnap([runPhase(0, 'a', 'running'), runPhase(1, 'b', 'backlog')]), 0);
    const r = advanceMissionRunWatch(st, runSnap([runPhase(0, 'a', 'running'), runPhase(1, 'b', 'ready')]), 5_000);
    expect(r.events).toEqual([]);
    expect(r.done).toBe(false);
  });

  test('전부 done + lock release → phase(done) + finished·종료', () => {
    const st = createMissionRunWatchState(locked([runPhase(0, 'a', 'running')]), 0);
    const cur = runSnap([runPhase(0, 'a', 'done', 'https://github.com/o/r/pull/1')]);
    const r = advanceMissionRunWatch(st, cur, 5_000);
    expect(r.done).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(['phase', 'finished']);
  });

  test('실패 중단(failed + 잔여 backlog·active 0) + lock release → finished', () => {
    const st = createMissionRunWatchState(locked([runPhase(0, 'a', 'running'), runPhase(1, 'b', 'backlog')]), 0);
    const cur = runSnap([runPhase(0, 'a', 'failed'), runPhase(1, 'b', 'backlog')]);
    const r = advanceMissionRunWatch(st, cur, 5_000);
    expect(r.done).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(['phase', 'finished']);
  });

  test('rerun 리셋 창(backlog-only·lock 미획득·grace 내) → 종결 보류', () => {
    // rerunMission 은 backlog 리셋 후 detached spawn — 부팅 전엔 active 0 + lock 없음.
    const reset = runSnap([runPhase(0, 'a', 'backlog'), runPhase(1, 'b', 'backlog')]);
    const st = createMissionRunWatchState(reset, 0);
    const r = advanceMissionRunWatch(st, reset, 5_000);
    expect(r.done).toBe(false);
    expect(r.events).toEqual([]);
    // 부팅 후 lock 관찰 → 이후 done + lock release 에서 즉시 종결.
    const r2 = advanceMissionRunWatch(r.state, locked([runPhase(0, 'a', 'running'), runPhase(1, 'b', 'backlog')]), 10_000);
    expect(r2.state.sawRunLock).toBe(true);
    const r3 = advanceMissionRunWatch(r2.state, runSnap([runPhase(0, 'a', 'done'), runPhase(1, 'b', 'done')]), 15_000);
    expect(r3.done).toBe(true);
    expect(r3.events[r3.events.length - 1]?.kind).toBe('finished');
  });

  test('lock 을 끝내 못 봐도 grace(20s) 경과 후 no-active 면 finished (spawn 실패/이미 종결 미션 attach)', () => {
    const idle = runSnap([runPhase(0, 'a', 'done'), runPhase(1, 'b', 'failed')]);
    const st = createMissionRunWatchState(idle, 0);
    expect(advanceMissionRunWatch(st, idle, 5_000).done).toBe(false);
    const r = advanceMissionRunWatch(st, idle, 20_000);
    expect(r.done).toBe(true);
    expect(r.events[r.events.length - 1]?.kind).toBe('finished');
  });

  test('페이즈 0건(예약/단일턴) → 즉시 finished', () => {
    const st = createMissionRunWatchState(runSnap([]), 0);
    const r = advanceMissionRunWatch(st, runSnap([]), 5_000);
    expect(r.done).toBe(true);
    expect(r.events).toEqual([{ kind: 'finished', snapshot: runSnap([]) }]);
  });

  test('타임아웃(4h) → timeout·종료 · 조회 실패(null)는 계속', () => {
    const active = runSnap([runPhase(0, 'a', 'running')]);
    const st = createMissionRunWatchState(active, 0);
    expect(advanceMissionRunWatch(st, null, 5_000).done).toBe(false);
    const r = advanceMissionRunWatch(st, active, MISSION_RUN_WATCH_TIMEOUT_MS + 5_000);
    expect(r.done).toBe(true);
    expect(r.events).toEqual([{ kind: 'timeout' }]);
  });
});

describe('페이즈 내부 진행 미러(#3919)', () => {
  const withNote = (p: MissionRunPhase, note: string): MissionRunPhase => ({ ...p, progressNote: note });

  test('running 페이즈 [PROGRESS] note 변화 → progress 이벤트 · 같은 note 재관찰은 무소음', () => {
    const running = runPhase(0, '구현', 'running');
    const st = createMissionRunWatchState(locked([running]), 0);
    const cur = locked([withNote(running, '🔁 150턴 실패 → 예산 상향 300턴 재시도')]);
    const r1 = advanceMissionRunWatch(st, cur, 5_000);
    expect(r1.events).toEqual([{ kind: 'progress', phase: cur.phases[0]!, total: 1, note: '🔁 150턴 실패 → 예산 상향 300턴 재시도' }]);
    // 같은 note 재관찰 — 무소음.
    const r2 = advanceMissionRunWatch(r1.state, cur, 10_000);
    expect(r2.events).toEqual([]);
    // 새 변곡점 — 다시 1건.
    const cur3 = locked([withNote(running, '🛡️ opus 4.8 폴백 시도')]);
    const r3 = advanceMissionRunWatch(r2.state, cur3, 15_000);
    expect(r3.events.map((e) => e.kind)).toEqual(['progress']);
  });

  test('status 전이와 같은 틱이면 phase 이벤트만(중복 라인 생략)', () => {
    const st = createMissionRunWatchState(locked([runPhase(0, '구현', 'ready')]), 0);
    const cur = locked([withNote(runPhase(0, '구현', 'running'), '🔧 격리 구현 중(시도 1/4)')]);
    const r = advanceMissionRunWatch(st, cur, 5_000);
    expect(r.events.map((e) => e.kind)).toEqual(['phase']);
    // note 는 state 에 흡수 — 다음 틱 같은 note 는 무소음.
    expect(advanceMissionRunWatch(r.state, cur, 10_000).events).toEqual([]);
  });

  test('footer — running 페이즈에 note 있으면 골 대신 현재 국면', () => {
    const f = renderMissionRunFooter(runSnap([
      runPhase(0, 'a', 'done'),
      withNote(runPhase(1, '구현', 'running'), '🔁 예산 상향 300턴 재시도'),
    ]));
    expect(f).toContain('🔁 예산 상향 300턴 재시도');
    expect(f).not.toContain('실행 골');
  });
});

describe('실행 워처 렌더', () => {
  test('phase line — 텔레그램 동형(아이콘·n/총·바·PR)', () => {
    const line = renderMissionRunPhaseLine({ phase: runPhase(2, '구현', 'done', 'https://github.com/o/r/pull/9'), total: 7, doneCount: 3 });
    expect(line).toContain('✅ 페이즈 3/7');
    expect(line).toContain('43%');
    expect(line).toContain('PR https://github.com/o/r/pull/9');
  });
  test('footer — 소유권 접두 + 진행바 + 현재 페이즈', () => {
    const f = renderMissionRunFooter(runSnap([runPhase(0, 'a', 'done'), runPhase(1, '구현 페이즈', 'running')]));
    expect(f.startsWith(MISSION_FOOTER_PREFIX)).toBe(true);
    expect(f).toContain('50%');
    expect(f).toContain('2/2 구현 페이즈');
  });
  test('종결 리포트 — 상태표 + 롤업 + 실패 시 재개 안내', () => {
    const lines = renderMissionRunReportLines(runSnap([
      runPhase(0, 'a', 'done', 'https://github.com/o/r/pull/1'),
      runPhase(1, 'b', 'failed'),
      runPhase(2, 'c', 'backlog'),
    ]));
    expect(lines[0]).toContain('✅  0. [done] a · PR');
    expect(lines[1]).toContain('❌  1. [failed] b');
    expect(lines[3]).toContain('done 1 · failed 1 · 미실행 1 / 3');
    expect(lines[4]).toContain('재개');
  });
  test('종결 리포트 — 페이즈 0건은 예약/단일턴 안내', () => {
    expect(renderMissionRunReportLines(runSnap([]))[0]).toContain('예약/단일턴');
  });
  test('종결 리포트 — 비평 지적 페이즈 요약 + rereflect 안내(#3923 패리티)', () => {
    const critiqued: MissionRunPhase = {
      ...runPhase(1, '구현', 'done', 'https://github.com/o/r/pull/2'),
      critiqueVerdict: 'WARN',
      critiqueFindings: ['에러 핸들링 누락 — catch 가 조용히 삼킴', '테스트 미보강'],
    };
    const lines = renderMissionRunReportLines(runSnap([runPhase(0, '조사', 'done'), critiqued]));
    const joined = lines.join('\n');
    expect(joined).toContain('🔎 비평 지적 1 페이즈');
    expect(joined).toContain('[WARN] 구현 — 에러 핸들링 누락');
    expect(joined).toContain('(+1)');
    expect(joined).toContain('/mission rereflect');
  });
  test('종결 리포트 — 비평 없으면 rereflect 안내 생략', () => {
    const lines = renderMissionRunReportLines(runSnap([runPhase(0, 'a', 'done')]));
    expect(lines.join('\n')).not.toContain('rereflect');
  });
});

describe('missionDescriptionDigest', () => {
  const desc = [
    '골: x', '분류: tier=light · heavy=false', '',
    '## 분해 (3 페이즈)', '  0. a', '  1. b', '',
    '## 외부조사 (보강 2 · 교정 1)', '- 보강: 최신 스펙 y', '- 보강: z', '- 교정: w', '',
    '## 내부 grounding — 기존 관련 파일 6 (재사용·확장·중복금지)',
    '- src/a.ts', '- src/b.ts', '- src/c.ts', '- src/d.ts', '- src/e.ts', '- src/f.ts',
  ].join('\n');

  test('헤딩 + 항목 발췌 · 프리앰블(골/분류)과 분해 섹션(보드 중복)은 제외', () => {
    const lines = missionDescriptionDigest(desc);
    const joined = lines.join('\n');
    expect(joined).not.toContain('골: x');
    expect(joined).not.toContain('분해');
    expect(joined).toContain('외부조사 (보강 2 · 교정 1)');
    expect(joined).toContain('  - 보강: 최신 스펙 y');
    expect(joined).toContain('  - src/a.ts');
  });
  test('섹션당 maxItems 초과는 "… 외 N" 롤업', () => {
    const lines = missionDescriptionDigest(desc, 4);
    expect(lines).toContain('  … 외 2'); // grounding 6 중 4 표시.
    expect(lines.join('\n')).not.toContain('src/f.ts');
  });
  test('빈 description 은 빈 배열', () => {
    expect(missionDescriptionDigest('')).toEqual([]);
  });
});
