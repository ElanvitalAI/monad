// ★ I-21(2026-07-31) — **자동화에서만 나는 결함을 자동화에서 잰다.**
//
// `OBS-T3` 는 `elanous self log` 가 **17분 32초** 행이었던 사건이다. 원인은
// `if (!process.stdin.isTTY) { for await (const c of process.stdin) … }` 인데, 하니스의 stdin 은
// **닫히지 않는 unix 소켓**이라 EOF 가 영원히 안 온다. ⛔ 사람이 터미널에서 치면 `isTTY` 라 **안 난다.**
//
// ⚠️ 기존 단위 테스트(`piped-stdin.test.ts`)는 **가짜 스트림**으로 유휴 타임아웃을 잰다. 그것으로는
// *"진짜 소켓이 fd0 에 붙었을 때 프로세스가 끝나는가"* 를 못 잰다 — 소켓이라는 사실 자체가
// `fstat` 층에서 생기기 때문이다. ⇒ 이 파일은 **진짜 소켓을 fd0 에 붙여 자식을 띄운다.**
//
// ⭐⭐ **이 파일의 절반은 탐지기의 음성 대조다.** ***늘 초록을 내는 스모크는 아무것도 증명하지 않는다.***
import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { connect, createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 자식이 *"이제 stdin 을 기다린다"* 를 알리는 표식. ⛔ 이것 없이 미종료만 보면 **기동이 느린 것**과
 *  **정말 stdin 에서 멈춘 것**이 구분되지 않는다(리뷰 1R must-fix — 거짓 초록 경로였다). */
const READY = 'READY';

interface SocketStdinRun {
  /** 관찰 구간 안에 끝났나. ⛔ `false` = **행**(실패가 아니다 — 그래서 어느 카운터에도 안 잡힌다). */
  exited: boolean;
  /** ⛔ `close` 까지 기다린 뒤의 값이다 — `exit` 직후엔 stdout 이 아직 안 비워졌을 수 있다. */
  stdout: string;
  stderr: string;
  /** `awaitReady` 를 쓴 경우 표식이 실제로 왔나. */
  ready: boolean;
}

interface RunOptions {
  /** 자식이 끝나기를 기다리는 상한. */
  timeoutMs: number;
  /** ⭐ 표식을 먼저 기다린 뒤 **짧게** 관찰한다 — 음성 대조가 쓰는 모드. */
  awaitReady?: { readyTimeoutMs: number; observeMs: number };
}

/**
 * 자식을 띄우되 **fd0 에 연결된 unix 소켓**을 붙인다 — 하니스가 주는 것과 같은 모양이다.
 * ⛔ 파이프(`stdio: 'pipe'`)로 하면 FIFO 라 **이 결함이 재현되지 않는다**(그래서 종전 테스트가 못 잡았다).
 * 쓰는 쪽은 **아무것도 안 쓰고 닫지도 않는다** — EOF 가 안 오는 조건을 그대로 만든다.
 */
async function runWithSocketStdin(source: string, options: RunOptions): Promise<SocketStdinRun> {
  const dir = mkdtempSync(join(tmpdir(), 'obs-t3-smoke-'));
  const sockPath = join(dir, 's');
  const scriptPath = join(dir, 'child.ts');
  writeFileSync(scriptPath, source);
  const server = createServer();
  let client: Socket | undefined;
  let childStdin: Socket | undefined;
  try {
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));
    const accepted = new Promise<Socket>((resolve) => server.once('connection', resolve));
    client = connect(sockPath);
    childStdin = await accepted;

    const child = spawn(process.execPath, [scriptPath], { stdio: [childStdin, 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let ready = false;
    let onReady: (() => void) | undefined;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!ready && stdout.includes(READY)) { ready = true; onReady?.(); }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    // ⛔ spawn 자체가 실패하면 `close` 가 와도 원인이 안 남는다 — 이유를 stderr 로 모은다.
    child.on('error', (error: Error) => { stderr += `\n[spawn-error] ${error.message}`; });

    // ⛔ `exit` 이 아니라 `close` 를 기다린다 — `exit` 직후엔 파이프가 아직 안 비워졌을 수 있다.
    let closed = false;
    const closeSignal = new Promise<void>((resolve) => child.once('close', () => { closed = true; resolve(); }));

    // ⛔ 진 타이머를 반드시 해제한다 — 안 하면 게이트에 핸들이 남는다(리뷰 3R).
    const raceWithTimeout = async (ms: number, extra?: Promise<void>): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
      try {
        await Promise.race(extra ? [closeSignal, extra, deadline] : [closeSignal, deadline]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    if (options.awaitReady) {
      const { readyTimeoutMs, observeMs } = options.awaitReady;
      await raceWithTimeout(readyTimeoutMs, new Promise<void>((resolve) => { if (ready) resolve(); else onReady = resolve; }));
      // ⭐ 표식을 받은 뒤에는 **짧게만** 본다 — 고정 대기를 길게 두면 게이트 시간을 먹는다(리뷰 1R).
      await raceWithTimeout(observeMs);
    } else {
      await raceWithTimeout(options.timeoutMs);
    }

    // ⛔⭐ **판정값을 kill 전에 스냅샷한다.** `closed` 는 아래 `kill` → `close` 로 반드시 참이 되므로
    //    `return` 에서 읽으면 **모든 행이 "끝났다" 로 뒤집힌다.** 리워크 중 실제로 그렇게 넣었고
    //    음성 대조가 잡았다(그 테스트가 없었으면 이 스모크는 영원히 초록이었을 것이다).
    const exited = closed;
    if (!closed) { child.kill('SIGKILL'); await closeSignal; }
    return { exited, stdout: stdout.trim(), stderr: stderr.trim(), ready };
  } finally {
    client?.destroy();
    childStdin?.destroy();
    // ⛔ `close` 를 기다린다 — 콜백 없이 두면 게이트에 리스닝 핸들이 남는다(리뷰 3R).
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

const SEAM = join(import.meta.dir, 'piped-stdin.ts');

describe('OBS-T3 회귀 — 진짜 소켓 stdin 에서 끝나는가 (I-21)', () => {
  // ⛔⭐⭐ **음성 대조가 먼저다.** 이것이 통과해야 아래 초록이 뜻을 갖는다 —
  //    탐지기가 행을 못 잡으면 *"안 멈춘다"* 는 판정도 못 낸다.
  test('⛔ 음성 대조 — 옛 `!isTTY` 패턴을 쓰는 자식은 소켓 stdin 에서 끝나지 않는다', async () => {
    const old = `
      const chunks: Buffer[] = [];
      console.log(${JSON.stringify(READY)});          // ⭐ 여기까지 왔다 = 기동은 끝났다
      if (!process.stdin.isTTY) { for await (const c of process.stdin) chunks.push(c as Buffer); }
      console.log('DONE');
    `;
    const run = await runWithSocketStdin(old, { timeoutMs: 8000, awaitReady: { readyTimeoutMs: 6000, observeMs: 700 } });
    // ⛔ 셋을 함께 본다 — ①기동은 됐고 ②그 뒤로 안 끝났고 ③`DONE` 에 도달하지 못했다.
    //    ①이 없으면 **자식이 느리게 뜬 것**을 *"행"* 으로 오판한다(리뷰 1R must-fix).
    expect(run.ready).toBe(true);
    expect(run.exited).toBe(false);
    expect(run.stdout).not.toContain('DONE');
  }, 20000);

  test('⭐ 지금 심(`readPipedStdin`)은 같은 조건에서 끝나고 빈 본문을 돌려준다', async () => {
    const fixed = `
      import { readPipedStdin } from ${JSON.stringify(SEAM)};
      const body = await readPipedStdin();
      console.log('DONE:' + JSON.stringify(body));
    `;
    const run = await runWithSocketStdin(fixed, { timeoutMs: 8000 });
    expect(run.exited).toBe(true);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('DONE:""');   // ⛔ 소켓은 읽지 않는다 — 행보다 미수신이 낫다
  }, 20000);

  // ⛔⭐⭐ **이 테스트는 음성 대조가 만들어 냈다**(원장 `OBS-T5`). 위 테스트만 있을 때 FIFO 게이트를
  //    `return true` 로 되돌려 봤더니 **여전히 초록**이었다 — 유휴 타임아웃(2000ms)이 대신 살려서
  //    자식이 그래도 끝나기 때문이다. ⇒ *"끝났는가"* 만 보면 **두 겹이 안 갈린다.**
  //    ⭐ 갈리는 것은 **시간**이다: 게이트가 살아 있으면 소켓을 아예 안 읽어 곧바로 끝나고,
  //    게이트가 죽으면 유휴 타임아웃까지 **2000ms 를 더** 기다린다(실측 2064.91ms).
  test('⭐⭐ FIFO 게이트가 살아 있다 — 소켓을 읽으려 시도조차 하지 않는다(유휴 타임아웃에 기대지 않는다)', async () => {
    // ⭐ **자식 안에서 `readPipedStdin` 구간만 잰다**(리뷰 2R should-fix). 프로세스 기동 시간이
    //    섞이면 혼잡한 게이트에서 흔들리는데, 여기서 재면 **게이트 유무의 차이(2000ms)만** 남는다.
    const fixed = `
      import { readPipedStdin } from ${JSON.stringify(SEAM)};
      // ⛔ 단조 시계를 쓴다 — \`Date.now()\` 는 시스템 시각 보정에 흔들려 **거짓 초록**을 낼 수 있다(리뷰 3R).
      const t0 = process.hrtime.bigint();
      await readPipedStdin();
      console.log('ELAPSED:' + Number((process.hrtime.bigint() - t0) / 1000000n));
    `;
    const run = await runWithSocketStdin(fixed, { timeoutMs: 8000 });
    expect(run.exited).toBe(true);
    const elapsed = Number(/ELAPSED:(\d+)/.exec(run.stdout)?.[1]);
    expect(Number.isFinite(elapsed)).toBe(true);
    // ⛔ 임계값 근거: 게이트가 죽으면 이 구간에 **유휴 상한 2000ms 가 통째로** 붙는다(실측 2056ms).
    //    게이트가 살아 있으면 `fstat` 한 번이라 **한 자릿수 ms** 다. 500 은 그 사이의 넉넉한 선이고
    //    ⛔ 기동 시간을 포함하지 않으므로 부하에 흔들리지 않는다. ⛔ *"2000 의 절반"* 이 아니다.
    expect(elapsed).toBeLessThan(500);
  }, 20000);

  test('⭐ 소켓 stdin 은 FIFO 가 아니다 — 결함이 여기서 갈렸다', async () => {
    const probe = `
      import { fstatSync } from 'node:fs';
      const s = fstatSync(0);
      console.log(JSON.stringify({ isTTY: !!process.stdin.isTTY, fifo: s.isFIFO(), socket: s.isSocket() }));
    `;
    const run = await runWithSocketStdin(probe, { timeoutMs: 8000 });
    expect(run.exited).toBe(true);
    // ⛔ `!isTTY` 가 참인데 FIFO 는 거짓이다 — 종전 코드가 이 둘을 뭉갰다.
    expect(JSON.parse(run.stdout)).toEqual({ isTTY: false, fifo: false, socket: true });
  }, 20000);
});
