// task#22 · runHeadlessGoalLoopPty — implement seam PTY 호스팅 완료감지 + 셸이스케이프 (2026-07-21).
// startPty 를 fake 로 주입 — 실 PTY/프로세스 무접촉.

import { afterAll, describe, it, expect, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ⭐P3 — isolate pty-manifest SQLite BEFORE any manifest access (frame
// convergence test reads it). ELANOUS_STATE_DIR 규율 = logsDbPath 동형.
// beforeAll 로 세우기는 못 씀 — 모듈 로드 시점에 이미 읽힌다. 세우기 전 값은
// 기억해 두고 afterAll 에서 복원(없었으면 삭제)한다. 안 하면 같은 프로세스의
// 뒤 시험이 이 임시 디렉터리를 본다.
const prevEnv = process.env.ELANOUS_STATE_DIR;
const p3DriverTestStateDir = mkdtempSync(join(tmpdir(), 'elanous-p3-driver-test-'));
process.env.ELANOUS_STATE_DIR = p3DriverTestStateDir;

import { runHeadlessGoalLoopPty, shSingleQuote } from '../src/self-implement/headless-elanous-driver.js';
import { upsertPtyManifest, getPtyManifest, setPtyManifestDbPathForTesting } from '../src/pty-shell/pty-manifest.js';
import { resetPtyEventLogForTesting } from '../src/pty-shell/pty-event-log.js';
import { debug as debugLog } from '../src/debug/log.js';

afterAll(() => {
  setPtyManifestDbPathForTesting(null);
  resetPtyEventLogForTesting();
  if (prevEnv === undefined) delete process.env.ELANOUS_STATE_DIR;
  else process.env.ELANOUS_STATE_DIR = prevEnv;
  rmSync(p3DriverTestStateDir, { recursive: true, force: true });
});

/** poll 마다 drainDelta 호출 — aliveForPolls 회 후 exitCode 세팅(프로세스 종료 시뮬). */
function makeFake(cfg: { aliveForPolls?: number; exitCode?: number; snapshot?: string; deltas?: string[]; mutateLastArg?: (value: string) => string }) {
  let poll = 0;
  const captured: { opts?: unknown } = {};
  const handle = {
    id: 'pty_test', cmd: 'bun', workdir: '/w', startedAt: 0, lastActivityAt: 0, detach: false,
    exitCode: null as number | null, exitSignal: undefined,
    isAlive() { return handle.exitCode === null; },
    appendOutput() {},
    drainDelta() {
      poll += 1;
      if (poll >= (cfg.aliveForPolls ?? Number.POSITIVE_INFINITY)) handle.exitCode = cfg.exitCode ?? 0;
      return cfg.deltas?.[poll - 1] ?? '';
    },
    snapshot() { return cfg.snapshot ?? ''; },
    write() {}, kill() {}, resize() {},
    renderScreen: async () => '', renderScreenPng: async () => null,
  };
  const spawn = ((o: unknown) => {
    // ⭐ 반증용 심 — 마지막 인자(featurePrompt)를 «일부러 변형»해, 「원문 그대로 전달」 시험이
    //   정말 무는지 시험 안에서 확인한다(손으로 소스를 고쳐 재던 것을 상설화).
    const options = o as { args?: string[] };
    if (cfg.mutateLastArg && options.args) {
      options.args = [...options.args.slice(0, -1), cfg.mutateLastArg(options.args.at(-1) ?? '')];
    }
    captured.opts = options;
    return handle;
  }) as never;
  return { handle, spawn, captured };
}

describe('shSingleQuote — startPty sh -c 셸랩 대비 이스케이프', () => {
  it('일반 문자열 → 단일따옴표 감쌈', () => {
    expect(shSingleQuote('feat X')).toBe("'feat X'");
  });
  it('내부 단일따옴표 → 닫고-이스케이프-열기', () => {
    expect(shSingleQuote("a'b")).toBe("'a'\\''b'");
  });
  it('멀티라인·특수문자 보존(셸 파싱 안 깨짐)', () => {
    const s = 'line1\n- `x`; $(rm -rf /) && echo';
    const q = shSingleQuote(s);
    expect(q.startsWith("'")).toBe(true);
    expect(q.endsWith("'")).toBe(true);
    expect(q).toContain('\n');        // 줄바꿈 보존
    expect(q).toContain('$(rm -rf /)'); // 위험 토큰이 따옴표 안(비활성)
  });
});

describe('runHeadlessGoalLoopPty — 완료 감지', () => {
  it('프로세스 exit(0) → 완료·타임아웃 아님·툴콜 카운트', async () => {
    const { spawn } = makeFake({ aliveForPolls: 2, exitCode: 0, snapshot: '⏺ Read(a)\n⏺ Edit(b)\n작업 종료' });
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20,
      spawn, ptyAvailable: () => true,
    });
    expect(r.ok).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.reachedCompletion).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.toolCalls).toBe(2);
    expect(r.ptyId).toBe('pty_test');
  });

  it('maxWait 소진(exit·GOAL-COMPLETE 없음) → 타임아웃·미완', async () => {
    const { spawn } = makeFake({ snapshot: '작업 중…(변화 없음)' }); // 절대 exit 안 함
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 3,
      spawn, ptyAvailable: () => true,
    });
    expect(r.timedOut).toBe(true);
    expect(r.reachedCompletion).toBe(false);
  });

  it('GOAL-COMPLETE 스냅샷(프로세스 잔존) → 완료·타임아웃 아님', async () => {
    const { spawn } = makeFake({ snapshot: '⏺ Grep(x)\nGOAL-COMPLETE' }); // alive 지만 마커
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20,
      spawn, ptyAvailable: () => true,
    });
    expect(r.reachedCompletion).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  // ⛔⭐⭐⭐ 외부 쓰기 출처(`RUN-S25`) — 리뷰 must-fix ③ 이 지목한 «핵심 수용기준» 검증.
  //   종전 검사는 Map 조회만 봤다. 여기서 ***완료 선언 관측 한 줄에 실리는가*** 를 실제 드라이버로 문다.
  describe('완료 선언 관측에 «밖에서 쓴 이력»이 실린다', () => {
    /** `headless.completion-declared` 한 줄만 골라 낸다. */
    const PROV = { externalWrites: 2, externalWriteAgoMs: 1_500, externalWriteActor: 'human' };

    async function declaredEvent(prov?: typeof PROV): Promise<Record<string, unknown> | undefined> {
      const rows: Record<string, unknown>[] = [];
      const spy = spyOn(debugLog, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
        if (event === 'headless.completion-declared') rows.push((data ?? {}) as Record<string, unknown>);
      }) as typeof debugLog.log);
      try {
        const { spawn } = makeFake({ snapshot: '⏺ Grep(x)\nGOAL-COMPLETE' });
        await runHeadlessGoalLoopPty({
          binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20,
          spawn, ptyAvailable: () => true,
          externalWriteProvenance: () => prov,
        });
      } finally { spy.mockRestore(); }
      return rows[0];
    }

    it('⛔ 이력이 «없으면» 그 칸을 만들지 않는다 (빈 필드 금지)', async () => {
      const ev = await declaredEvent(undefined);
      expect(ev).toBeDefined();
      expect(ev!.line).toBe('GOAL-COMPLETE');
      expect(ev).not.toHaveProperty('externalWrites');
    });

    it('⭐ 밖에서 쓴 뒤 마커가 물리면 그 이력이 «같은 줄»에 실린다', async () => {
      const ev = await declaredEvent(PROV);
      expect(ev!.externalWrites).toBe(2);
      expect(ev!.externalWriteActor).toBe('human');
      expect(ev!.externalWriteAgoMs).toBe(1_500);
      expect(ev!.line).toBe('GOAL-COMPLETE');   // 끊은 근거도 그대로 남는다
    });

    it('⛔ 그래도 «판정»은 안 바뀐다 — 이력이 있어도 완료로 친다', async () => {
      const { spawn } = makeFake({ snapshot: '⏺ Grep(x)\nGOAL-COMPLETE' });
      const r = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20,
        spawn, ptyAvailable: () => true,
        externalWriteProvenance: () => PROV,
      });
      expect(r.reachedCompletion).toBe(true);
      expect(r.timedOut).toBe(false);
    });
  });

  it('PTY 미가용 → ok:false(호출측 spawnSync 폴백 신호)', async () => {
    const { spawn } = makeFake({});
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', spawn, ptyAvailable: () => false,
    });
    expect(r.ok).toBe(false);
    expect(r.ptyId).toBe('');
  });

  it('★ #21 — 시작 전 이미 abort → 즉시 kill·조기종료(타임아웃 아님·완료 아님)', async () => {
    let killed = 0;
    const { spawn, handle } = makeFake({ snapshot: '작업 중…' }); // 절대 exit 안 함 → abort 없으면 타임아웃
    handle.kill = () => { killed += 1; };
    const ac = new AbortController();
    ac.abort(); // 시작 전 취소
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 100,
      spawn, ptyAvailable: () => true, signal: ac.signal,
    });
    expect(killed).toBeGreaterThan(0);       // /cancel → PTY kill
    expect(r.timedOut).toBe(false);          // maxWait 소진 아님(조기 종료)
    expect(r.reachedCompletion).toBe(false); // 취소 ≠ 완료
  });

  it('★ #21 — 폴 도중 abort → 조기 kill(maxWait 훨씬 전 종료)', async () => {
    let killed = 0;
    const ac = new AbortController();
    const { spawn, handle } = makeFake({ snapshot: '작업 중…' });
    handle.kill = () => { killed += 1; };
    let polls = 0;
    handle.drainDelta = () => { polls += 1; if (polls === 2) ac.abort(); return ''; };
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 100,
      spawn, ptyAvailable: () => true, signal: ac.signal,
    });
    expect(killed).toBeGreaterThan(0);
    expect(r.timedOut).toBe(false);
    expect(polls).toBeLessThan(10); // maxWait(100 폴) 훨씬 전에 종료
  });

  it('★ 타임아웃 adaptive — soft 초과해도 출력활동 지속 시 hard 까지 연장 후 완료', async () => {
    const { spawn, handle } = makeFake({});
    let poll = 0;
    handle.drainDelta = () => { poll += 1; if (poll >= 8) handle.exitCode = 0; return `chunk${poll}`; }; // 매 poll 활동
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 2,
      maxWaitSec: 3, maxHardWaitSec: 60, activityGraceSec: 5, // soft(3) < 완료(8) < hard(60)
      spawn, ptyAvailable: () => true,
    });
    expect(r.timedOut).toBe(false);         // soft 초과했지만 활동 → 연장 → 완료(안 잘림)
    expect(r.reachedCompletion).toBe(true); // exit 0
    expect(poll).toBeGreaterThanOrEqual(8); // soft(3) 넘어 계속 폴
  });

  it('★ 타임아웃 adaptive — 무활동(출력 없음)이면 soft 에서 종료(연장 안 함·hard 안 감)', async () => {
    const { spawn, handle } = makeFake({});
    let poll = 0;
    handle.drainDelta = () => { poll += 1; return ''; }; // 무활동·절대 exit 안 함
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 2,
      maxWaitSec: 4, maxHardWaitSec: 500, activityGraceSec: 10,
      spawn, ptyAvailable: () => true,
    });
    expect(r.timedOut).toBe(true);
    expect(poll).toBeLessThan(10); // soft(4)에서 끊김 — hard(500) 근처 안 감
  });

  it('★ 타임아웃 adaptive — 활동 후 무활동 grace 경과 → 종료(hard 훨씬 전)', async () => {
    const { spawn, handle } = makeFake({});
    let poll = 0;
    handle.drainDelta = () => { poll += 1; return poll <= 3 ? `x${poll}` : ''; }; // 3폴 활동 후 무활동
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 2,
      maxWaitSec: 2, maxHardWaitSec: 500, activityGraceSec: 5,
      spawn, ptyAvailable: () => true,
    });
    expect(r.timedOut).toBe(true);
    expect(poll).toBeLessThan(20); // 마지막 활동+grace 에서 종료 — hard(500) 훨씬 전
  });

  it('signal 미주입 → 종전대로 동작(무회귀)', async () => {
    const { spawn } = makeFake({ aliveForPolls: 2, exitCode: 0, snapshot: '⏺ Read(a)\nGOAL-COMPLETE' });
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20,
      spawn, ptyAvailable: () => true,
    });
    expect(r.reachedCompletion).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  // ⭐P3 — forwarded 렌더 프레임이 pty-manifest frame 컬럼으로 수렴(크로스-프로세스 관측).
  //   startPty 는 row+snapshot(원시)을 이미 쓰므로 fake spawn 도 upsert 로 mimic → 드라이버의
  //   updatePtyManifestFrame 이 그 row 를 갱신하는지 실 매니페스트로 검증.
  function makeFrameFake(cfg: { id: string; frame: string; renderFn?: () => Promise<string> }) {
    const handle = {
      id: cfg.id, cmd: 'bun', workdir: '/w', startedAt: 0, lastActivityAt: 0, detach: false,
      exitCode: null as number | null, exitSignal: undefined,
      isAlive() { return handle.exitCode === null; },
      appendOutput() {},
      drainDelta() { return ''; },
      snapshot() { return 'GOAL-COMPLETE'; },   // tick0: frame write 후 GOAL-COMPLETE 로 종료
      write() {}, kill() {}, resize() {},
      renderScreen: cfg.renderFn ?? (async () => cfg.frame),
      renderScreenPng: async () => null,
    };
    const spawn = ((_o: unknown) => {
      // mimic startPty 의 매니페스트 등록(registry.ts:409) — 없으면 updatePtyManifestFrame 은 no-op.
      upsertPtyManifest({ id: cfg.id, kind: 'pty', cmd: 'bun', startedAt: Date.now(), now: Date.now() });
      return handle;
    }) as never;
    return { handle, spawn };
  }

  it('★P3 — 렌더 프레임이 manifest frame 컬럼으로 수렴(사람이 보는 화면 크로스-프로세스)', async () => {
    const id = 'pty_p3converge';
    const frame = '┌ elanous 자식 goal-loop ┐\n│ ⏺ Edit(foo.ts) │\n└────────────────┘';
    const { spawn } = makeFrameFake({ id, frame });
    await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20,
      spawn, ptyAvailable: () => true,
    });
    // 드라이버가 h.renderScreen() 결과를 이 PTY 의 manifest frame 으로 씀.
    expect(getPtyManifest(id)?.frame).toBe(frame);
    expect(getPtyManifest(id)?.frameAt).toBeGreaterThan(0);
  });

  it('★P3 — renderScreen 예외는 격리(자식 goal-loop 무해·loop 정상 완료·frame 미기록)', async () => {
    const id = 'pty_p3throw';
    const { spawn } = makeFrameFake({ id, frame: '', renderFn: async () => { throw new Error('render boom'); } });
    // 예외가 loop 밖으로 전파되지 않고 완료 도달(관측 fail-soft 불변식).
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20,
      spawn, ptyAvailable: () => true,
    });
    expect(r.reachedCompletion).toBe(true);   // GOAL-COMPLETE 로 정상 종료(예외에 안 죽음)
    expect(getPtyManifest(id)?.frame).toBe(''); // 렌더 실패 → frame 미기록(초기값)
  });

  it('★P3 — renderScreen 첫 실패 후 1.5s 잠금 없이 다음 tick 즉시 재시도·성공(throttle 성공후갱신)', async () => {
    const id = 'pty_p3retry';
    let renderCalls = 0;
    const good = 'RECOVERED-SCREEN';
    // 1회차 render 실패(throttle 갱신 안 됨) → 다음 poll tick(≈5ms<1.5s)에 재시도 성공.
    const renderFn = async () => { renderCalls += 1; if (renderCalls === 1) throw new Error('transient'); return good; };
    const handle = {
      id, cmd: 'bun', workdir: '/w', startedAt: 0, exitCode: null as number | null, exitSignal: undefined,
      isAlive() { return handle.exitCode === null; },
      appendOutput() {},
      // 3 poll 후 exit(0) — render 재시도 여지 확보(GOAL-COMPLETE 로 tick0 종료 방지).
      drainDelta() { renderCallsTick(); return ''; },
      snapshot() { return ''; },   // GOAL-COMPLETE 없음 → 조기종료 안 함
      write() {}, kill() {}, resize() {},
      renderScreen: renderFn, renderScreenPng: async () => null,
    };
    let ticks = 0;
    function renderCallsTick() { ticks += 1; if (ticks >= 3) handle.exitCode = 0; }
    const spawn = ((_o: unknown) => { upsertPtyManifest({ id, kind: 'pty', cmd: 'bun', startedAt: Date.now(), now: Date.now() }); return handle; }) as never;
    await runHeadlessGoalLoopPty({ binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20, spawn, ptyAvailable: () => true });
    // 첫 실패가 throttle 을 잠갔다면 frame 은 '' 로 남음. 성공후갱신이면 재시도 프레임이 기록됨.
    expect(getPtyManifest(id)?.frame).toBe(good);
    expect(renderCalls).toBeGreaterThanOrEqual(2);   // 최소 1 실패 + 1 성공
  });

  it('★P3 — frame 은 해당 PTY id 로만 격리 기록(다른 PTY 오염 없음)', async () => {
    const { spawn: sA } = makeFrameFake({ id: 'pty_pA', frame: 'A-SCREEN' });
    const { spawn: sB } = makeFrameFake({ id: 'pty_pB', frame: 'B-SCREEN' });
    await runHeadlessGoalLoopPty({ binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20, spawn: sA, ptyAvailable: () => true });
    await runHeadlessGoalLoopPty({ binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 20, spawn: sB, ptyAvailable: () => true });
    expect(getPtyManifest('pty_pA')?.frame).toBe('A-SCREEN');
    expect(getPtyManifest('pty_pB')?.frame).toBe('B-SCREEN');
  });

  it('spawn delivers featurePrompt as the exact final direct argv token', async () => {
    const featurePrompt = "구현: a'b\n멀티라인";
    const { spawn, captured } = makeFake({ aliveForPolls: 1, exitCode: 0 });
    await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', configDir: '/cfg', featurePrompt, pollMs: 5, maxWaitSec: 10,
      spawn, ptyAvailable: () => true,
    });
    const o = captured.opts as { cmd: string; args: string[]; workdir: string };
    expect(o.cmd).toBe('bun');
    expect(o.workdir).toBe('/w');
    const childFeaturePrompt = o.args.at(-1);
    expect(childFeaturePrompt).toBe(featurePrompt);
    expect(childFeaturePrompt).toContain("a'b");
    expect(childFeaturePrompt).toContain('\n');
  });

  it('반증 — 자식이 받은 featurePrompt에서 개행을 제거하면 원문 동일성 검사가 실패한다', async () => {
    const featurePrompt = "구현: a'b\n멀티라인";
    const { spawn, captured } = makeFake({
      aliveForPolls: 1,
      exitCode: 0,
      mutateLastArg: (value) => value.replaceAll('\n', ''),
    });
    await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', configDir: '/cfg', featurePrompt, pollMs: 5, maxWaitSec: 10,
      spawn, ptyAvailable: () => true,
    });
    const childFeaturePrompt = (captured.opts as { args: string[] }).args.at(-1);
    expect(() => expect(childFeaturePrompt).toBe(featurePrompt)).toThrow();
  });
});

// ── K run-identity 공백 방어 (2026-07-26 실측 갭) ────────────────────────────────
//   라이브 관측에서 `run-identity propagate {"runId":""}` 가 찍혔다 — 관측 계약은 있는데 값이 안 실려
//   `elanous self run <runId>` 사후 join 이 그 run 에는 불가능했다. 근본 = space 합성/조회가 env 를 그대로
//   읽어(harness-space:92) 상속이 없으면 ''. 계약: 호출자 지정 > 상속 > canonical mint — **항상 비어있지 않다**.
describe('runHeadlessGoalLoopPty — run-identity 는 비어 있을 수 없다', () => {
  const RUN_ID_ENV = 'ELANOUS_RUN_ID';
  const withRunIdEnv = async <T>(value: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const prev = process.env[RUN_ID_ENV];
    if (value === undefined) delete process.env[RUN_ID_ENV];
    else process.env[RUN_ID_ENV] = value;
    try { return await fn(); } finally {
      if (prev === undefined) delete process.env[RUN_ID_ENV];
      else process.env[RUN_ID_ENV] = prev;
    }
  };
  const childRunId = (captured: { opts?: unknown }): string | undefined =>
    (captured.opts as { env?: Record<string, string> } | undefined)?.env?.[RUN_ID_ENV];

  it('★ 상속 없고 호출자 미지정 → 빈 값이 아니라 mint 된 runId 를 자식에 전파(종전엔 "")', async () => {
    const { spawn, captured } = await withRunIdEnv(undefined, async () => {
      const f = makeFake({ aliveForPolls: 1, exitCode: 0 });
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 10,
        spawn: f.spawn, ptyAvailable: () => true,
      });
      return f;
    });
    void spawn;
    const rid = childRunId(captured);
    expect(rid).toBeDefined();
    expect(rid).not.toBe('');
    expect(rid).toMatch(/^run-[A-Za-z0-9-]+$/); // canonical mintRunId 형식
  });

  it('★ 호출자 지정 runId 가 최우선 — 리워크 라운드가 하나의 run 을 공유하는 계약', async () => {
    const { captured } = await withRunIdEnv('run-inherited', async () => {
      const f = makeFake({ aliveForPolls: 1, exitCode: 0 });
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 10,
        runId: 'run-owner',
        spawn: f.spawn, ptyAvailable: () => true,
      });
      return f;
    });
    expect(childRunId(captured)).toBe('run-owner');
  });

  it('★ 명시 runId 가 빈/공백이면 채택하지 않고 상속·mint 로 폴백(리뷰 must-fix)', async () => {
    for (const bad of ['', '   ', '///']) {
      const { captured } = await withRunIdEnv(undefined, async () => {
        const f = makeFake({ aliveForPolls: 1, exitCode: 0 });
        await runHeadlessGoalLoopPty({
          binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 10,
          runId: bad,
          spawn: f.spawn, ptyAvailable: () => true,
        });
        return f;
      });
      const rid = childRunId(captured);
      expect(rid).toBeTruthy();
      expect(rid).toMatch(/^run-[A-Za-z0-9-]+$/);
    }
  });

  it('호출자 미지정 + 상속 있음 → 상속값 채택(중첩 run 계보 유지)', async () => {
    const { captured } = await withRunIdEnv('run-inherited', async () => {
      const f = makeFake({ aliveForPolls: 1, exitCode: 0 });
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 10,
        spawn: f.spawn, ptyAvailable: () => true,
      });
      return f;
    });
    expect(childRunId(captured)).toBe('run-inherited');
  });
});

// ── S4 P0-② 수리 회귀 (대표 결정 2026-07-26 "agent write 는 허용해야 합니다") ────────────
//   자율 self-dev PTY 의 소유자는 사람이 아니라 감독(brain)이다. 종전엔 accessMode 미지정 → 기본
//   'write'(사람 소유) → arbiter 가 agent write 를 거부해 S4 개입이 구조적으로 불가했다.
describe('runHeadlessGoalLoopPty — PTY 소유권은 brain(auto)', () => {
  it('★ accessMode=auto 로 스폰한다(agent write 허용·사람은 takeover 로 회수)', async () => {
    const f = makeFake({ aliveForPolls: 1, exitCode: 0 });
    await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 10,
      spawn: f.spawn, ptyAvailable: () => true,
    });
    const o = f.captured.opts as { accessMode?: string };
    expect(o.accessMode).toBe('auto');
  });

  it('arbiter 계약 대조 — auto 에서 agent write 는 허용, write 에서는 거부(수리의 근거)', async () => {
    const { resolveWriteDecision } = await import('../src/pty-shell/pty-write-arbiter.js');
    expect(resolveWriteDecision('auto', 'agent').allow).toBe(true);   // 수리 후
    expect(resolveWriteDecision('write', 'agent').allow).toBe(false); // 수리 전(기본값)
    // 사람은 takeover 로 회수 가능해야 한다(안전 계약).
    const { resolveTakeover } = await import('../src/pty-shell/pty-write-arbiter.js');
    expect(resolveTakeover('auto', 'human', 'open').allow).toBe(true);
  });
});

// ── S4 P1 통합 회귀 (리뷰 should-fix) ─────────────────────────────────────────────
//   이 수리의 핵심은 "분류 관측이 **PNG 성공과 독립**"이다. 순수 함수 테스트는 그 배선을 증명하지
//   못하므로 드라이버를 실제로 돌려 PNG 가 null 인 상태에서도 frame-state 가 남는지 본다.
describe('runHeadlessGoalLoopPty — 분류 관측은 PNG 실패와 독립(P1 배선)', () => {
  it('★ renderScreenPng 가 null 이어도 frame-state 를 남긴다(종전엔 PNG 성공에 종속돼 유실)', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Array<{ event: string; data: unknown }> = [];
    let pngCalls = 0;
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      seen.push({ event, data });
    }) as never);
    try {
      const f = makeFake({ aliveForPolls: 3, exitCode: 0, snapshot: 'goal screen' });
      // 화면은 렌더되지만 PNG 는 항상 실패(null) — 종전 배선이면 분류 로그가 하나도 안 남는다.
      //   ⭐ PNG 호출 횟수를 센다(리뷰 should-fix) — 안 불렸으면 "실패 경로를 탔다"는 전제가 성립하지 않아
      //   이 테스트가 아무것도 증명하지 못한다. blocked 프롬프트 화면으로 키프레임 전이를 확실히 유도한다.
      const blockedScreen = 'building…\n\nDo you want to proceed?\n  1. yes\n  2. no';
      (f.handle as unknown as { renderScreen: () => Promise<string> }).renderScreen = async () => blockedScreen;
      (f.handle as unknown as { renderScreenPng: () => Promise<Buffer | null> }).renderScreenPng = async () => {
        pngCalls += 1; return null;
      };
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 5, maxWaitSec: 10,
        spawn: f.spawn, ptyAvailable: () => true,
      });
    } finally {
      spy.mockRestore();
    }
    const frameStates = seen.filter((e) => e.event === 'frame-state');
    expect(frameStates.length).toBeGreaterThan(0);
    // 첫 관측은 from=null 전이이고 to 는 분류된 상태다(PNG 와 무관).
    expect(frameStates[0]!.data).toMatchObject({ from: null });
    // ⭐ PNG 실패 경로를 실제로 탔다(안 불렸으면 이 테스트는 무의미).
    expect(pngCalls).toBeGreaterThan(0);
    // 키프레임 PNG 는 실패했으므로 keyframe-capture 는 없다 — 두 경로가 독립임을 대조로 확인.
    expect(seen.some((e) => e.event === 'keyframe-capture')).toBe(false);
    // 종료 관측도 남는다(우측 절단 해소).
    expect(seen.some((e) => e.event === 'frame-state-final')).toBe(true);
  });
});

// ⭐ 리뷰 should-fix — 정적 `idle` 프롬프트는 정지가 정상(자식이 턴을 끝내고 입력 대기)이라
//   warn 으로 올리면 운영 로그가 오염된다. 관측은 남기고 레벨만 낮춘다.
describe('frame-stall 레벨 정책 — idle 정지는 warn 아님', () => {
  it('★ idle 화면이 오래 멈춰도 warn 이 아니다(관측은 남는다)', async () => {
    const { debug } = await import('../src/debug/log.js');
    const calls: Array<{ event: string; data: unknown; opts: unknown }> = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown, opts?: unknown) => {
      calls.push({ event, data, opts });
    }) as never);
    try {
      const { observeFrame, INITIAL_FRAME_OBSERVATION, STALL_RUNGS_MS } = await import('../src/capture/frame-observation.js');
      // 드라이버의 레벨 결정을 그대로 재현(같은 식) — idle 은 rung 이 높아도 debug.
      const o = observeFrame(
        observeFrame(INITIAL_FRAME_OBSERVATION, { state: 'idle', screen: '❯ ', atMs: 0 }).next,
        { state: 'idle', screen: '❯ ', atMs: STALL_RUNGS_MS[1]! + 1 },
      );
      expect(o.stall).toBeDefined();                       // 관측은 발생
      const level = o.stall!.state !== 'idle' && o.stall!.rung >= 1 ? 'warn' : 'debug';
      expect(level).toBe('debug');                          // 그러나 warn 아님
      // 대조: working 의 같은 정지는 warn 이어야 한다.
      const w = observeFrame(
        observeFrame(INITIAL_FRAME_OBSERVATION, { state: 'working', screen: 'x', atMs: 0 }).next,
        { state: 'working', screen: 'x', atMs: STALL_RUNGS_MS[1]! + 1 },
      );
      const wLevel = w.stall!.state !== 'idle' && w.stall!.rung >= 1 ? 'warn' : 'debug';
      expect(wLevel).toBe('warn');
    } finally {
      spy.mockRestore();
    }
    void calls;
  });
});

// ── 완료 선언 판정 · 종료 사유 관측 (2026-07-27 실측 결함 회귀) ──────────────────
//
// 결함: poll 루프가 `includes('GOAL-COMPLETE')` 로 끊어, 자식이 **자기 소스나 산문에서 마커를
// 언급**하기만 해도 부모가 나갔다. 실측 서명 = timedOut:false ⊕ reachedCompletion:false ⊕ 자식 생존
// (run-16161538 · run-6572db2c). 자기를 개발하는 시스템이라 self-dev 골 자체가 이 함정을 밟는다.
describe('runHeadlessGoalLoopPty — 완료 선언 vs 언급', () => {
  it('⭐ 자식이 마커를 **언급**만 하면 끊지 않는다(자기 소스·산문)', async () => {
    const screen = [
      '  ⏺ Grep({"pattern":"GOAL-COMPLETE"})',
      '     ↳ 550: if (hasCompletionMarker(stripAnsi(snap))) { ... }',
      '따라서 워킹트리 변경은 미검증·불완전 상태이며 GOAL-COMPLETE를 선언하지 않습니다.',
    ].join('\n');
    const { spawn } = makeFake({ snapshot: screen });   // 자식은 계속 살아 있다
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 3, activityGraceSec: 0,
      spawn, ptyAvailable: () => true,
    });
    // 종전 동작이면 여기서 exitReason='completion-marker' · timedOut=false 로 즉시 나갔다.
    expect(r.exitReason).not.toBe('completion-marker');
    expect(r.reachedCompletion).toBe(false);
    expect(r.timedOut).toBe(true);            // 끊지 않고 자기 상한까지 갔다
  });

  it('단독 줄 마커 = 선언 → completion-marker 로 끊고 완료로 친다', async () => {
    const { spawn } = makeFake({ snapshot: '요약 …\nGOAL-COMPLETE\n' });
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 30,
      spawn, ptyAvailable: () => true,
    });
    expect(r.exitReason).toBe('completion-marker');
    expect(r.reachedCompletion).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  it('우측 패딩이 붙은 선언도 인정한다(터미널 실화면·놓침 방지)', async () => {
    const { spawn } = makeFake({ snapshot: `done\nGOAL-COMPLETE${' '.repeat(120)}\n` });
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 30,
      spawn, ptyAvailable: () => true,
    });
    expect(r.exitReason).toBe('completion-marker');
    expect(r.reachedCompletion).toBe(true);
  });
});

describe('runHeadlessGoalLoopPty — 종료 사유 관측(어느 갈래로 나갔나)', () => {
  it('자식 종료 → child-exit', async () => {
    const { spawn } = makeFake({ aliveForPolls: 2, exitCode: 0, snapshot: '끝' });
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 30,
      spawn, ptyAvailable: () => true,
    });
    expect(r.exitReason).toBe('child-exit');
  });

  it('soft 상한 ⊕ 무활동 → soft-timeout', async () => {
    const { spawn } = makeFake({ snapshot: '작업 중…' });
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 2, activityGraceSec: 0,
      spawn, ptyAvailable: () => true,
    });
    expect(r.exitReason).toBe('soft-timeout');
    expect(r.timedOut).toBe(true);
  });

  it('부모 취소 → abort', async () => {
    const { spawn } = makeFake({ snapshot: '작업 중…' });
    const ac = new AbortController();
    ac.abort();
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 30,
      spawn, ptyAvailable: () => true, signal: ac.signal,
    });
    expect(r.exitReason).toBe('abort');
    expect(r.timedOut).toBe(false);
  });
});

// ── 관측 배선 (리뷰 must-fix) — 반환값이 아니라 **로그 payload** 를 고정한다 ──────────
//
// ⚠️ 반환값만 검사하면 `headless.done` 배선이 끊겨도 테스트가 통과한다. 이 PR 의 산출이
// **관측**이므로, 소비자가 실제로 받는 payload 를 직접 본다(선례: 아래 frame-state 스파이).
describe('headless.done payload — 종료 사유가 로그로 나간다', () => {
  async function captureDone(cfg: Parameters<typeof makeFake>[0], opts: Record<string, unknown> = {}) {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      const { spawn } = makeFake(cfg);
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 30,
        spawn, ptyAvailable: () => true, ...opts,
      } as Parameters<typeof runHeadlessGoalLoopPty>[0]);
    } finally { spy.mockRestore(); }
    expect(seen.length).toBe(1);
    return seen[0]!;
  }

  it('완료 선언 → exitReason:completion-marker 가 payload 에 실린다', async () => {
    const d = await captureDone({ snapshot: '요약\nGOAL-COMPLETE\n' });
    expect(d.exitReason).toBe('completion-marker');
    expect(d.reachedCompletion).toBe(true);
    expect(d.markerMentionedOnly).toBe(false);
  });

  it('자식 성공 종료는 공개 child-exit을 유지하면서 이벤트에 child-exit-success를 기록한다', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      const { spawn } = makeFake({ aliveForPolls: 2, exitCode: 0, snapshot: '끝' });
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 30, spawn, ptyAvailable: () => true,
      });
      expect(result).toMatchObject({ exitReason: 'child-exit', exitCode: 0, timedOut: false });
    } finally { spy.mockRestore(); }
    expect(seen).toContainEqual(expect.objectContaining({ exitReason: 'child-exit-success', exit: 0, timedOut: false }));
  });

  it('자식 실패 종료 → 이벤트 child-exit-failure ⊕ exit 값 보존', async () => {
    const d = await captureDone({ aliveForPolls: 2, exitCode: 1, snapshot: '실패' });
    expect(d.exitReason).toBe('child-exit-failure');
    expect(d.exit).toBe(1);
    expect(d.reachedCompletion).toBe(false);
    expect(d.timedOut).toBe(false);
  });

  it('soft 타임아웃 → exitReason:soft-timeout ⊕ exit 은 null 유지', async () => {
    const d = await captureDone({ snapshot: '작업 중…' }, { maxWaitSec: 2, activityGraceSec: 0 });
    expect(d.exitReason).toBe('soft-timeout');
    expect(d.timedOut).toBe(true);
    expect(d.exit).toBe(null);
  });

  it('⭐ 이 결함의 서명 — 언급만 있는 화면은 markerMentionedOnly:true 이면서 completion-marker 로 나가지 않는다', async () => {
    const d = await captureDone(
      { snapshot: '…미검증·불완전 상태이며 GOAL-COMPLETE를 선언하지 않습니다.\n' },
      { maxWaitSec: 2, activityGraceSec: 0 },
    );
    expect(d.markerMentionedOnly).toBe(true);
    expect(d.exitReason).not.toBe('completion-marker');   // 참인 채로 이 값이면 부분일치가 되살아난 것
  });

  it('terminal verdict joins the sibling final frame by the same runId without changing prior fields', async () => {
    const { debug } = await import('../src/debug/log.js');
    const observations = new Map<string, Record<string, unknown>>();
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.done' || event === 'frame-state-final') observations.set(event, data ?? {});
    }) as never);
    try {
      const { spawn } = makeFake({ snapshot: 'GOAL-COMPLETE\n' });
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-terminal-join', pollMs: 1, maxWaitSec: 30,
        spawn, ptyAvailable: () => true,
      });
    } finally {
      spy.mockRestore();
    }
    const done = observations.get('headless.done');
    const finalFrame = observations.get('frame-state-final');
    expect(done).toEqual({
      ptyId: 'pty_test', runId: 'run-terminal-join', reachedCompletion: true, timedOut: false,
      exitReason: 'completion-marker', exit: null, toolCalls: 0, chars: 'GOAL-COMPLETE\n'.length,
      markerMentionedOnly: false,
      surfaceProgressTotal: 1, surfaceProgressHandedToCallback: 0,
      surfaceProgressUnwired: 1, surfaceProgressCallbackFailed: 0,
    });
    expect(finalFrame?.runId).toBe(done?.runId);
  });

  it('records a minted runId instead of omitting the terminal identity when none is supplied', async () => {
    const done = await captureDone({ snapshot: 'GOAL-COMPLETE\n' });
    expect(done).toHaveProperty('runId');
    expect(done.runId).toMatch(/^run-[A-Za-z0-9-]+$/);
  });

  it('loop exhaustion keeps the public loop-exhausted contract while naming the event outcome', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      const { spawn } = makeFake({ snapshot: 'working', deltas: ['active'] });
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-exhausted', pollMs: 1,
        maxWaitSec: 1, maxHardWaitSec: 1, activityGraceSec: 100, spawn, ptyAvailable: () => true,
      });
      expect(result.exitReason).toBe('loop-exhausted');
    } finally { spy.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({
      runId: 'run-exhausted', exitReason: 'loop-exhausted-without-completion', timedOut: true,
    })]);
  });

  it('a dead child without an exit code is not falsely classified as failure', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      const { spawn, handle } = makeFake({ snapshot: 'stopped' });
      handle.isAlive = () => false;
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-no-exit-code', pollMs: 1,
        maxWaitSec: 5, spawn, ptyAvailable: () => true,
      });
      expect(result).toMatchObject({ exitReason: 'child-exit', exitCode: null, timedOut: false });
    } finally { spy.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({
      runId: 'run-no-exit-code', exitReason: 'child-exit-code-unavailable', exit: null,
    })]);
  });

  it('spawn errors emit exactly one terminal event with the resolved runId before propagating', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      await expect(runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-spawn-error',
        spawn: (() => { throw new Error('spawn exploded'); }) as never, ptyAvailable: () => true,
      })).rejects.toThrow('spawn exploded');
    } finally { spy.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({
      runId: 'run-spawn-error', exitReason: 'spawn-error', error: 'spawn exploded',
    })]);
  });

  it('PTY probe errors emit exactly one terminal event with the resolved runId before propagating', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      await expect(runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-probe-error',
        spawn: (() => { throw new Error('spawn must not run'); }) as never,
        ptyAvailable: () => { throw new Error('probe exploded'); },
      })).rejects.toThrow('probe exploded');
    } finally { spy.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({
      runId: 'run-probe-error', exitReason: 'pty-probe-error', error: 'probe exploded',
    })]);
  });

  it('spawn 후 initialization errors emit once and clean up the spawned PTY', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    let kills = 0;
    const { handle } = makeFake({});
    handle.kill = () => { kills += 1; };
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: unknown) => {
      if (event === 'headless.spawn') throw new Error('initialization exploded');
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      await expect(runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-init-error',
        spawn: (() => handle) as never, ptyAvailable: () => true,
      })).rejects.toThrow('initialization exploded');
    } finally { spy.mockRestore(); }
    expect(kills).toBe(1);
    expect(seen).toEqual([expect.objectContaining({
      runId: 'run-init-error', exitReason: 'initialization-error', error: 'initialization exploded',
    })]);
  });

  it('snapshot errors emit exactly one terminal event with the resolved runId before propagating', async () => {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.done') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    const { spawn, handle } = makeFake({});
    handle.snapshot = () => { throw new Error('snapshot exploded'); };
    try {
      await expect(runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-snapshot-error', pollMs: 1,
        maxWaitSec: 5, spawn, ptyAvailable: () => true,
      })).rejects.toThrow('snapshot exploded');
    } finally { spy.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({
      runId: 'run-snapshot-error', exitReason: 'snapshot-error', error: 'snapshot exploded',
    })]);
  });
});

describe('lifecycle screen scoreboard observation — shadow only', () => {
  async function captureScoreboard(
    readLifecycle?: (childPtyId: string) => ReturnType<NonNullable<Parameters<typeof runHeadlessGoalLoopPty>[0]['readLifecycle']>>,
    readPublisherStateDir?: Parameters<typeof runHeadlessGoalLoopPty>[0]['readPublisherStateDir'],
  ) {
    const { debug } = await import('../src/debug/log.js');
    const seen: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: unknown) => {
      if (event === 'headless.lifecycle-screen-scoreboard') seen.push((data ?? {}) as Record<string, unknown>);
    }) as never);
    try {
      const { spawn, captured } = makeFake({ aliveForPolls: 1, exitCode: 0, snapshot: 'done' });
      const readLifecycleForChild: Parameters<typeof runHeadlessGoalLoopPty>[0]['readLifecycle'] = (stateDir, runId) =>
        readLifecycle?.((captured.opts as { env: Record<string, string> }).env.ELANOUS_PTY_ID) ?? [];
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-scoreboard', stateDir: tmpdir(),
        pollMs: 1, maxWaitSec: 30, spawn, ptyAvailable: () => true, readLifecycle: readLifecycleForChild, readPublisherStateDir,
      });
      const childPtyId = (captured.opts as { env: Record<string, string> }).env.ELANOUS_PTY_ID;
      return { result, seen, childPtyId };
    } finally { spy.mockRestore(); }
  }

  it('emits exactly one scoreboard observation that preserves complete/agreement and classified scope fields', async () => {
    const { seen, childPtyId } = await captureScoreboard(
      (subjectPtyId) => [{ id: 1, record: {
        runId: 'run-scoreboard', ptyId: subjectPtyId, subjectPtyId, depth: 1, role: 'child' as const, seq: 1, at: 1,
        class: 'progress' as const, name: 'complete' as const, payload: { summary: 'done', changedFiles: [] }, truncated: false as const,
      } }],
      () => tmpdir(),
    );
    expect(childPtyId).toMatch(/^self_/);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      runId: 'run-scoreboard', classification: 'agree',
      screen: { exitReason: 'child-exit', reachedCompletion: true, timedOut: false },
      signal: {
        recordCount: 1, observedNames: ['complete'], excluded: { byRunId: 0, bySubjectPtyId: 0 },
        ended: true, outcome: 'complete', subjectPtyId: childPtyId, unit: 'round', scopeStatus: 'scoped',
      },
    });
  });

  it('emits a classified unavailable observation when no lifecycle records are available', async () => {
    const { seen } = await captureScoreboard(() => []);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      classification: 'screen-only',
      signal: { recordCount: 0, scopeStatus: 'unavailable' },
      lifecycleRead: { source: 'unresolved', emptyReason: 'publisher-root-unreported' },
    });
  });

  it('a throwing reader leaves the poll result identical field by field', async () => {
    const baseline = await captureScoreboard();
    const throwing = await captureScoreboard(() => { throw new Error('reader unavailable'); });
    expect(throwing.result).toEqual(baseline.result);
    expect(throwing.seen[0]).toMatchObject({ classification: 'screen-only' });
  });

  it('a throwing scoreboard logger leaves the poll result identical field by field', async () => {
    const baseline = await captureScoreboard();
    const { debug } = await import('../src/debug/log.js');
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string) => {
      if (event === 'headless.lifecycle-screen-scoreboard') throw new Error('logger unavailable');
    }) as never);
    try {
      const { spawn } = makeFake({ aliveForPolls: 1, exitCode: 0, snapshot: 'done' });
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-scoreboard', stateDir: '/child-state',
        pollMs: 1, maxWaitSec: 30, spawn, ptyAvailable: () => true,
      });
      expect(result).toEqual(baseline.result);
    } finally {
      log.mockRestore();
    }
  });
});

describe('PTY 미가용 조기 반환 — 거짓 관측 금지 (리뷰 must-fix)', () => {
  it('poll 루프에 진입조차 안 했으면 not-started (loop-exhausted 로 위장하지 않는다)', async () => {
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x',
      spawn: (() => { throw new Error('spawn 되면 안 된다'); }) as never,
      ptyAvailable: () => false,
    });
    expect(r.ok).toBe(false);
    expect(r.exitReason).toBe('not-started');
  });
});

describe('정상 완료 무회귀 — 종전 3필드 보존 (수용 기준)', () => {
  it('exit(0) 완료 런의 reachedCompletion·timedOut·exitCode 가 종전 그대로', async () => {
    const { spawn } = makeFake({ aliveForPolls: 2, exitCode: 0, snapshot: '⏺ Read(a)\n작업 종료' });
    const r = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 20,
      spawn, ptyAvailable: () => true,
    });
    expect(r.reachedCompletion).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
  });
});
