// SVG→PNG 서브프로세스 격리 — Pango abort crash-safety 계약 회귀 가드.
// 핵심 불변식: 자식이 어떤 식으로 죽어도(SIGABRT·비-0 exit·spawn오류·timeout·stdin EPIPE·stdout error)
// 부모는 **null**(never-throw·크래시 없음).
import { describe, it, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { renderSvgToPngIsolated } from './svg-png-isolated.js';

/** 가짜 자식 — stdout/stdin(EventEmitter)·on(exit/error)·kill. 이벤트를 스케줄러로 발화. */
function makeFakeChild(): {
  child: any;
  emitData: (b: Buffer) => void;
  emitExit: (code: number | null, signal: string | null) => void;
  emitError: () => void;
  emitStdinError: () => void;
  emitStdoutError: () => void;
} {
  const stdout = new EventEmitter();
  const stdin: any = new EventEmitter();
  stdin.write = (): void => {};
  stdin.end = (): void => {};
  const ev = new EventEmitter();
  const child: any = {
    stdout, stdin,
    on: (name: string, cb: (...a: any[]) => void) => ev.on(name, cb),
    kill: (): void => {},
  };
  return {
    child,
    emitData: (b) => stdout.emit('data', b),
    // 실제 자식은 'exit'(코드/시그널) 후 'close'(stdio 닫힘) 를 발화 — 부모는 조립을 'close' 에서 함.
    emitExit: (code, signal) => { ev.emit('exit', code, signal); ev.emit('close', code, signal); },
    emitError: () => ev.emit('error', new Error('spawn fail')),
    emitStdinError: () => stdin.emit('error', new Error('EPIPE')),
    emitStdoutError: () => stdout.emit('error', new Error('stream fail')),
  };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('renderSvgToPngIsolated — fail-soft 계약(DI spawn)', () => {
  it('정상(exit 0·PNG stdout) → Buffer 반환', async () => {
    const f = makeFakeChild();
    const p = renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any });
    queueMicrotask(() => { f.emitData(PNG_MAGIC); f.emitExit(0, null); });
    const out = await p;
    expect(out).not.toBeNull();
    expect(out!.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it('⭐ Pango abort(SIGABRT) → null(부모 무해·핵심 계약)', async () => {
    const f = makeFakeChild();
    const p = renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any });
    queueMicrotask(() => { f.emitData(PNG_MAGIC); f.emitExit(null, 'SIGABRT'); });
    expect(await p).toBeNull(); // 데이터가 있어도 signal 종료면 신뢰 불가 → null
  });

  it('⭐ 자식 조기종료 stdin EPIPE → 흡수(부모 크래시 없음·must-fix)', async () => {
    const f = makeFakeChild();
    const p = renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any });
    // stdin 'error'(EPIPE) 를 부모가 처리 안 하면 미처리 error 로 프로세스 크래시 → 테스트 자체가 죽는다.
    queueMicrotask(() => { f.emitStdinError(); f.emitExit(null, 'SIGABRT'); });
    expect(await p).toBeNull(); // 크래시 없이 null 로 귀결
  });

  it('stdout 스트림 error → kill + null(미처리 error 방지 + 고아 자식 방지·must-fix)', async () => {
    const f = makeFakeChild();
    let killed = false;
    f.child.kill = (): void => { killed = true; };
    const p = renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any });
    queueMicrotask(() => f.emitStdoutError());
    expect(await p).toBeNull();
    expect(killed).toBe(true); // 조기 귀결 시 자식을 종료(프로세스 누수 방지)
  });

  it("child 'error' 도 kill + null(고아 자식 방지)", async () => {
    const f = makeFakeChild();
    let killed = false;
    f.child.kill = (): void => { killed = true; };
    const p = renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any });
    queueMicrotask(() => f.emitError());
    expect(await p).toBeNull();
    expect(killed).toBe(true);
  });

  it('비-0 exit(잡힌 오류) → null', async () => {
    const f = makeFakeChild();
    const p = renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any });
    queueMicrotask(() => f.emitExit(1, null));
    expect(await p).toBeNull();
  });

  it('exit 0 이나 stdout 비어있음 → null(부분/무산출)', async () => {
    const f = makeFakeChild();
    const p = renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any });
    queueMicrotask(() => f.emitExit(0, null));
    expect(await p).toBeNull();
  });

  it('spawn 자체가 throw → null(never-throw)', async () => {
    const out = await renderSvgToPngIsolated('<svg/>', { spawnFn: (() => { throw new Error('no exec'); }) as any });
    expect(out).toBeNull();
  });

  it('timeout(자식 무응답) → kill + null', async () => {
    const f = makeFakeChild();
    let killed = false;
    f.child.kill = (): void => { killed = true; };
    const out = await renderSvgToPngIsolated('<svg/>', { spawnFn: (() => f.child) as any, timeoutMs: 20 });
    expect(out).toBeNull();
    expect(killed).toBe(true);
  });
});

describe('renderSvgToPngIsolated — 실 서브프로세스(실 회귀 가드·실 crash-safety)', () => {
  it('단순 SVG 를 실제 자식에서 래스터화 → 유효 PNG(worker 경로·실행 실 검증)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#000"/></svg>';
    const out = await renderSvgToPngIsolated(svg, { timeoutMs: 15000 });
    // 이모지 없는 단순 도형은 sharp 가 항상 래스터화 가능 — null 이면 worker 경로/실행/sharp 회귀(Goodhart 방지).
    expect(out).not.toBeNull();
    expect(out!.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(out!.length).toBeGreaterThan(50);
  }, 20000);

  it('⭐ 실 서브프로세스 SIGABRT → null + 부모 생존(핵심 crash-safety 배선 실증)', async () => {
    // 진짜 process.abort() 하는 자식을 spawnFn 으로 주입(실 subprocess·SIGABRT). Pango 하드 abort 와 동형 —
    //   부모가 이 SIGABRT 를 감지해 null 로 살아남는지(계약의 핵심)를 가짜 이벤트가 아닌 실 프로세스로 검증.
    const { spawn } = await import('node:child_process');
    const out = await renderSvgToPngIsolated('<svg/>', {
      spawnFn: (() => spawn(process.execPath, ['-e', 'process.abort()'], { stdio: ['pipe', 'pipe', 'ignore'] })) as any,
      timeoutMs: 10000,
    });
    expect(out).toBeNull(); // 자식 SIGABRT → 부모는 크래시 없이 null
  }, 15000);
});
