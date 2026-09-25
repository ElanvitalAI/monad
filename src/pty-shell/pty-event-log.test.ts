// PLAN §11 F3 (#5) — 크로스-프로세스 이벤트 로그 + wait 프리미티브.
// 격리 tmp MONAD_STATE_DIR(store) + 주입 deps(wait·db/시간 무관). herdr events_after/wait_for_agent 계약.
import { afterAll, beforeEach, test, expect, describe } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ⚠️ 첫 db() 전에 격리 경로를 강제하고, 종료 시 호출 전 환경을 복원한다.
const previousStateDir = process.env.MONAD_STATE_DIR;
const stateDir = mkdtempSync(join(tmpdir(), 'pty-eventlog-'));
process.env.MONAD_STATE_DIR = stateDir;

afterAll(() => {
  resetPtyEventLogForTesting();
  if (previousStateDir === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = previousStateDir;
  rmSync(stateDir, { recursive: true, force: true });
});

const {
  ptyEventLogDbPath, resetPtyEventLogForTesting, appendPtyEvent, readPtyEventsAfter, readPtyEventsAfterAt, currentPtyEventSeq,
  latestSurfaceState, recordSurfaceStateTransition, purgePtyEventsBefore,
  eventMatchesWait, eventIsForWait, waitForSurfaceState,
} = await import('./pty-event-log.js');
import type { PtyEventRow, SurfaceStateWaitSpec } from './pty-event-log.js';

beforeEach(() => {
  resetPtyEventLogForTesting();
});

describe('pty-event-log store (크로스-프로세스)', () => {
  test('경로가 MONAD_STATE_DIR 스코프(격리)', () => {
    expect(ptyEventLogDbPath()).toContain(process.env.MONAD_STATE_DIR!);
    expect(ptyEventLogDbPath()).toEndWith('pty/events.db');
  });

  test('append → 단조 seq 반환 + readAfter 오름차순', () => {
    const s1 = appendPtyEvent({ instance: 'prod', surfaceId: 'tui:1', kind: 'state', state: 'working', now: 100 });
    const s2 = appendPtyEvent({ instance: 'prod', surfaceId: 'tui:1', kind: 'state', state: 'idle', now: 200 });
    expect(s2).toBeGreaterThan(s1);
    const after = readPtyEventsAfter(s1 - 1, { surfaceId: 'tui:1' });
    expect(after.map((e) => e.state)).toEqual(['working', 'idle']);
    expect(readPtyEventsAfter(s1, { surfaceId: 'tui:1' }).map((e) => e.seq)).toEqual([s2]); // seq 이후만
  });

  test('selected ledger reader distinguishes missing from unreadable without changing the local reader', () => {
    const missing = readPtyEventsAfterAt(join(stateDir, 'pty', 'missing.db'), 0);
    expect(missing).toEqual({ status: 'missing' });
    const corrupt = join(stateDir, 'pty', 'corrupt.db');
    mkdirSync(join(stateDir, 'pty'), { recursive: true });
    writeFileSync(corrupt, 'not a sqlite database');
    expect(readPtyEventsAfterAt(corrupt, 0)).toEqual({ status: 'unreadable' });
    const selected = readPtyEventsAfterAt(ptyEventLogDbPath(), 0, { surfaceId: 'tui:1' });
    expect(selected).toMatchObject({ status: 'ok' });
    expect(selected.status === 'ok' ? selected.rows : []).toEqual(readPtyEventsAfter(0, { surfaceId: 'tui:1' }));
  });

  test('currentPtyEventSeq = 최대 seq', () => {
    const cur = currentPtyEventSeq();
    const s = appendPtyEvent({ instance: 'prod', surfaceId: 'tui:x', kind: 'state', state: 'done', now: 1 });
    expect(s).toBe(cur + 1);
    expect(currentPtyEventSeq()).toBe(s);
  });

  test('payload JSON 왕복', () => {
    appendPtyEvent({ instance: 'prod', surfaceId: 'tui:p', kind: 'state', state: 'blocked', payload: { reason: 'approval' }, now: 1 });
    const [ev] = readPtyEventsAfter(0, { surfaceId: 'tui:p' });
    expect(JSON.parse(ev!.payload!)).toEqual({ reason: 'approval' });
  });

  test('recordSurfaceStateTransition — 변화만 append(전이 로그)', () => {
    const a = recordSurfaceStateTransition({ instance: 'prod', surfaceId: 'tui:t', state: 'working', now: 1 });
    expect(a).not.toBeNull();
    const b = recordSurfaceStateTransition({ instance: 'prod', surfaceId: 'tui:t', state: 'working', now: 2 }); // 미변화
    expect(b).toBeNull();
    const c = recordSurfaceStateTransition({ instance: 'prod', surfaceId: 'tui:t', state: 'idle', now: 3 });    // 변화
    expect(c).not.toBeNull();
    expect(readPtyEventsAfter(0, { surfaceId: 'tui:t', kind: 'state' }).map((e) => e.state)).toEqual(['working', 'idle']);
  });

  test('recordSurfaceStateTransition — agent 만 바뀌어도 전이(재사용 surface 식별)', () => {
    recordSurfaceStateTransition({ instance: 'prod', surfaceId: 'tui:a', state: 'idle', agent: 'monad', now: 1 });
    const changed = recordSurfaceStateTransition({ instance: 'prod', surfaceId: 'tui:a', state: 'idle', agent: 'codex', now: 2 });
    expect(changed).not.toBeNull();
    expect(latestSurfaceState('tui:a')).toMatchObject({ state: 'idle', agent: 'codex' });
  });

  test('latestSurfaceState — 최신 lifecycle 행이 있어도 마지막 state만 반환한다', () => {
    recordSurfaceStateTransition({ instance: 'prod', surfaceId: 'tui:lifecycle-after-state', state: 'working', now: 1 });
    appendPtyEvent({
      instance: 'prod', surfaceId: 'tui:lifecycle-after-state', kind: 'lifecycle',
      payload: { event: 'removed' }, now: 2,
    });
    expect(latestSurfaceState('tui:lifecycle-after-state')).toMatchObject({ state: 'working' });
  });

  test('latestSurfaceState — 이력 없으면 null', () => {
    expect(latestSurfaceState('tui:none')).toBeNull();
  });

  test('purgePtyEventsBefore — TTL 초과 이벤트 삭제(무제한 증가 방지·review should-fix)', () => {
    const now = 10_000_000;
    appendPtyEvent({ instance: 'prod', surfaceId: 'tui:old', kind: 'state', state: 'idle', now: now - 20_000 });
    appendPtyEvent({ instance: 'prod', surfaceId: 'tui:new', kind: 'state', state: 'idle', now: now - 1_000 });
    const deleted = purgePtyEventsBefore(now, 10_000); // 10s TTL → old(20s) 삭제·new(1s) 유지
    expect(deleted).toBeGreaterThanOrEqual(1);
    const remaining = readPtyEventsAfter(0, { surfaceId: 'tui:old' });
    expect(remaining.length).toBe(0);
    expect(readPtyEventsAfter(0, { surfaceId: 'tui:new' }).length).toBe(1);
  });
});

// ── wait 프리미티브 (주입 deps — db/시간 무관) ──

function ev(over: Partial<PtyEventRow>): PtyEventRow {
  return { seq: 1, tsMs: 0, instance: 'prod', surfaceId: 'tui:1', kind: 'state', state: 'idle', agent: null, payload: null, ...over };
}

describe('eventMatchesWait (순수 매처·identity 핀)', () => {
  const base: SurfaceStateWaitSpec = { surfaceId: 'tui:1', afterSeq: 0, timeoutMs: 1000 };
  test('until 기본(idle|done|blocked) 매치', () => {
    expect(eventMatchesWait(ev({ state: 'idle' }), base)).toBe(true);
    expect(eventMatchesWait(ev({ state: 'working' }), base)).toBe(false); // until 밖
  });
  test('surfaceId 불일치 거부', () => {
    expect(eventMatchesWait(ev({ surfaceId: 'other' }), base)).toBe(false);
  });
  test('agent 핀 — 지정 시 정확 일치만(재시작 자식 오만족 차단)', () => {
    const spec = { ...base, agent: 'codex' };
    expect(eventMatchesWait(ev({ agent: 'codex' }), spec)).toBe(true);
    expect(eventMatchesWait(ev({ agent: 'monad' }), spec)).toBe(false); // 다른 점유자
    expect(eventMatchesWait(ev({ agent: null }), spec)).toBe(false);    // unknown 도 거부
  });
  test('instance 핀', () => {
    expect(eventMatchesWait(ev({ instance: 'test' }), { ...base, instance: 'prod' })).toBe(false);
  });
  test('non-state kind 거부', () => {
    expect(eventMatchesWait(ev({ kind: 'message', state: null }), base)).toBe(false);
  });
  test('eventIsForWait — identity 대상 판정(until 무관)', () => {
    const spec = { ...base, agent: 'codex' };
    expect(eventIsForWait(ev({ agent: 'codex', state: 'working' }), spec)).toBe(true); // until 밖이어도 identity 대상
    expect(eventIsForWait(ev({ agent: 'monad' }), spec)).toBe(false);                  // 타 점유자 아님
  });
});

describe('waitForSurfaceState', () => {
  // 주입 clock/sleep — sleep 이 시계를 pollMs 만큼 전진(결정론).
  function harness(queue: PtyEventRow[][]) {
    let t = 0;
    let tick = 0;
    const deps = {
      readAfter: (afterSeq: number) => (queue[tick] ?? []).filter((e) => e.seq > afterSeq),
      now: () => t,
      sleep: async (ms: number) => { t += ms; tick += 1; },
    };
    return deps;
  }

  test('matched — 목표 상태 전이 도착 시 즉시', async () => {
    const deps = harness([[], [ev({ seq: 5, state: 'done' })]]);
    const r = await waitForSurfaceState({ surfaceId: 'tui:1', afterSeq: 0, until: ['done'], timeoutMs: 10_000, pollMs: 100 }, deps);
    expect(r).toEqual({ outcome: 'matched', state: 'done', seq: 5 });
  });

  test('afterSeq — 커서 이전 stale 상태는 무시', async () => {
    // seq 3 done 은 afterSeq=3 이라 read 에서 제외 → timeout.
    const deps = harness([[ev({ seq: 3, state: 'done' })]]);
    const r = await waitForSurfaceState({ surfaceId: 'tui:1', afterSeq: 3, until: ['done'], timeoutMs: 50, pollMs: 100 }, deps);
    expect(r.outcome).toBe('timeout');
  });

  test('stalled — stallMs 내 어떤 상태 이벤트도 없으면 안티행', async () => {
    const deps = harness([[], [], []]); // 계속 빈 이벤트
    const r = await waitForSurfaceState({ surfaceId: 'tui:1', afterSeq: 0, until: ['done'], timeoutMs: 10_000, pollMs: 100, stallMs: 250 }, deps);
    expect(r.outcome).toBe('stalled');
  });

  test('stall 은 상태 활동으로 리셋(working 관측 → 계속 대기 → 결국 done)', async () => {
    const deps = harness([
      [ev({ seq: 1, state: 'working' })], // 활동 → stall 리셋
      [],
      [ev({ seq: 2, state: 'done' })],
    ]);
    const r = await waitForSurfaceState({ surfaceId: 'tui:1', afterSeq: 0, until: ['done'], timeoutMs: 10_000, pollMs: 100, stallMs: 250 }, deps);
    expect(r).toMatchObject({ outcome: 'matched', state: 'done' });
  });

  test('timeout — 아무 매치 없이 시간 초과', async () => {
    const deps = harness([[ev({ seq: 1, state: 'working' })], [ev({ seq: 2, state: 'working' })]]);
    const r = await waitForSurfaceState({ surfaceId: 'tui:1', afterSeq: 0, until: ['done'], timeoutMs: 150, pollMs: 100 }, deps);
    expect(r.outcome).toBe('timeout');
  });

  test('stall 은 타 점유자(agent 불일치) 이벤트로 리셋되지 않음 (review must-fix ②)', async () => {
    // 같은 surface 에 다른 agent(monad) 이벤트가 계속 와도, codex 로 핀된 wait 는 stall 진행.
    const deps = harness([[ev({ seq: 5, state: 'working', agent: 'monad' })], [], [], []]);
    const r = await waitForSurfaceState(
      { surfaceId: 'tui:1', afterSeq: 0, agent: 'codex', until: ['done'], timeoutMs: 10_000, pollMs: 100, stallMs: 250 },
      deps,
    );
    expect(r.outcome).toBe('stalled');
  });

  test('stall 은 identity 일치 이벤트로 리셋(codex working → 계속 → done)', async () => {
    const deps = harness([
      [ev({ seq: 1, state: 'working', agent: 'codex' })], // 대상 활동 → 리셋
      [],
      [ev({ seq: 2, state: 'done', agent: 'codex' })],
    ]);
    const r = await waitForSurfaceState(
      { surfaceId: 'tui:1', afterSeq: 0, agent: 'codex', until: ['done'], timeoutMs: 10_000, pollMs: 100, stallMs: 250 },
      deps,
    );
    expect(r).toMatchObject({ outcome: 'matched', state: 'done' });
  });
});
