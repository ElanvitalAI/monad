// ★ OBS-T3 회귀 — CLI 파이프 읽기가 **무한 대기하지 않는다**.
// 실측 근거: `monad self log` 가 하니스 stdin(닫히지 않는 unix 소켓)에서 17분 넘게 행,
// 같은 명령이 `< /dev/null` 에서는 0.43초 완주. 에러가 아니라 행이라 기록이 조용히 유실됐다.
import { describe, expect, test } from 'bun:test';
import { debug } from '../debug/log.js';
import { readPipedStdin, stdinLooksPiped, type PipedStdinSource } from './piped-stdin.js';

// ⭐ 이 더블은 **계약을 지킨다** — `destroy()` 가 읽기를 실제로 끊는다(`process.stdin` 과 같다).
//    ⛔ destroy 를 무시하는 더블로 두면 *"호출됐다"* 만 검증되고 **정리 완료는 검증되지 않는다**(리뷰 3R).
function sourceOf(chunks: string[], opts: { endless?: boolean; delayMs?: number } = {}): PipedStdinSource & { destroyed: boolean; finished: boolean } {
  let release: (() => void) | undefined;
  const state = {
    destroyed: false,
    finished: false,
    destroy() { state.destroyed = true; release?.(); },
    async *[Symbol.asyncIterator]() {
      try {
        for (const c of chunks) {
          if (state.destroyed) return;
          if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
          yield Buffer.from(c);
        }
        // ⛔ 결함의 핵심 — 쓰는 쪽이 안 닫으면 EOF 가 안 온다. destroy 만이 이것을 끊는다.
        if (opts.endless) await new Promise<void>((r) => { release = r; });
      } finally {
        state.finished = true;
      }
    },
  };
  return state as PipedStdinSource & { destroyed: boolean; finished: boolean };
}

/** 타임아웃 후 읽기 정리가 **완료**되는지 보기 위한 한 틱. readPipedStdin 은 정리를 기다리지 않는다
 *  (기다리면 destroy 가 안 먹는 스트림에서 다시 행이 된다) — 그래서 검증은 여기서 한다. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe('stdinLooksPiped — 비-TTY 를 파이프로 오인하지 않는다', () => {
  test('TTY 면 파이프가 아니다', () => {
    expect(stdinLooksPiped({ isTTY: true, fstat: () => ({ isFIFO: () => true }) })).toBe(false);
  });

  test('⭐ 비-TTY 라도 FIFO 가 아니면 파이프가 아니다(소켓·리다이렉션 — 종전 결함의 자리)', () => {
    expect(stdinLooksPiped({ isTTY: false, fstat: () => ({ isFIFO: () => false }) })).toBe(false);
  });

  test('비-TTY 이고 FIFO 면 파이프다', () => {
    expect(stdinLooksPiped({ isTTY: false, fstat: () => ({ isFIFO: () => true }) })).toBe(true);
  });

  test('잴 수 없으면 읽지 않는다(행보다 미수신이 낫다)', () => {
    expect(stdinLooksPiped({ isTTY: false, fstat: () => { throw new Error('EBADF'); } })).toBe(false);
  });
});

describe('readPipedStdin', () => {
  test('파이프가 아니면 스트림을 건드리지 않고 즉시 빈 문자열', async () => {
    const src = sourceOf(['절대 읽히면 안 된다']);
    expect(await readPipedStdin({ isPiped: false, stream: src })).toBe('');
    expect(src.destroyed).toBe(false);
  });

  test('파이프가 닫히면 본문을 이어 붙여 돌려준다', async () => {
    expect(await readPipedStdin({ isPiped: true, stream: sourceOf(['상세 ', '본문\n']) })).toBe('상세 본문');
  });

  test('⭐⭐ 끝나지 않는 파이프에서도 무한 대기하지 않고 받은 만큼 돌려주며 그것을 관측에 남긴다(OBS-T3 회귀)', async () => {
    const src = sourceOf(['부분 수신'], { endless: true });
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((_c, event, data) => {
      events.push({ event, data: data as Record<string, unknown> });
    }) as typeof debug.log;

    const started = Bun.nanoseconds();
    let got: string;
    try {
      got = await readPipedStdin({ isPiped: true, stream: src, idleTimeoutMs: 60 });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    expect(got).toBe('부분 수신');
    expect(elapsedMs).toBeLessThan(3000);   // ⛔ 종전 구현은 여기서 영원히 멈춘다
    expect(src.destroyed).toBe(true);       // 핸들을 놓아야 프로세스가 종료할 수 있다
    await tick();
    expect(src.finished).toBe(true);        // ⭐ 호출됐다가 아니라 **실제로 끝났다**
    // ⭐ 조용한 절단 금지 — 잘렸다는 사실이 관측에 남고, `bytes` 는 **수신 바이트**여야 한다.
    expect(events).toContainEqual(expect.objectContaining({
      event: 'piped-read-idle-timeout',
      data: expect.objectContaining({ idleTimeoutMs: 60, bytes: Buffer.byteLength('부분 수신') }),
    }));
  });

  test('⭐ 쓰는 쪽이 처음부터 완전히 침묵해도 끊고 빈 문자열을 돌려준다(FIFO 인데 아무도 안 쓰는 경우)', async () => {
    const src = sourceOf([], { endless: true });   // 청크 0 · EOF 없음
    const started = Bun.nanoseconds();
    const got = await readPipedStdin({ isPiped: true, stream: src, idleTimeoutMs: 60 });

    expect(got).toBe('');
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(3000);
    expect(src.destroyed).toBe(true);
    await tick();
    expect(src.finished).toBe(true);
  });

  test('⛔ 타임아웃이 아닌 진짜 I/O 오류는 삼키지 않고 전파한다(부분 입력이 성공으로 둔갑하지 않게)', async () => {
    const boom = new Error('EIO');
    const failing = {
      destroy() { /* noop */ },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('앞부분');
        throw boom;
      },
    } as unknown as PipedStdinSource;

    // ⛔ await 없이 쓰면 실패해도 통과한다(떠 있는 단언).
    await expect(readPipedStdin({ isPiped: true, stream: failing, idleTimeoutMs: 5000 })).rejects.toThrow('EIO');
  });

  test('⭐ 유휴 상한은 총 시간이 아니다 — 청크가 계속 오면 리셋되어 잘리지 않는다', async () => {
    // 청크 간격(30ms) < 유휴 상한(80ms) 이지만 총 시간(≈120ms) > 상한. 총 시간 상한이면 잘린다.
    const got = await readPipedStdin({
      isPiped: true,
      stream: sourceOf(['가', '나', '다', '라'], { delayMs: 30 }),
      idleTimeoutMs: 80,
    });
    expect(got).toBe('가나다라');
  });
});
