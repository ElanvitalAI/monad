/**
 * 로그 안전망 계약 (LF5 essential · 2026-07-13).
 *
 * ring buffer(디스크 미접촉)로 캡처 검증 — mirror 게이트만 잠깐 열어
 * isAnySinkEnabled 를 통과시키고(파일 sink 는 계속 off) 원상복구.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { debug } from '../../debug/log.js';
import { _resetLogSafetyNetForTests, formatConsoleArgs, installLogSafetyNet } from './log-safety-net.js';

let uninstall: (() => void) | null = null;
let mirrorWas = false;

beforeEach(() => {
  _resetLogSafetyNetForTests();
  uninstall = null;
  mirrorWas = debug.isMirrorEnabled();
  debug.setMirror(true); // ring 활성(파일 off 유지 — 디스크 미접촉)
});
afterEach(() => {
  uninstall?.();
  uninstall = null;
  _resetLogSafetyNetForTests();
  debug.setMirror(mirrorWas);
});

function ringTail(n = 10): Array<{ category: string; event: string; level?: string }> {
  return debug.events(n).map((e) => ({ category: e.category, event: e.event, level: (e as { level?: string }).level }));
}

describe('formatConsoleArgs', () => {
  it('문자열/객체/Error 혼합 → 한 줄(캡 500)', () => {
    expect(formatConsoleArgs(['boot 실패:', new Error('EADDRINUSE'), { port: 31415 }]))
      .toBe('boot 실패: Error: EADDRINUSE {"port":31415}');
    expect(formatConsoleArgs(['x'.repeat(600)]).length).toBeLessThanOrEqual(501);
  });
});

describe('installLogSafetyNet — 콘솔 브릿지', () => {
  it('console.error/warn 이 원 출력 유지 + debug.log 병행(severity 카테고리)', () => {
    const emitted: string[] = [];
    const origError = console.error;
    console.error = ((...a: unknown[]) => { emitted.push(String(a[0])); }) as typeof console.error;
    try {
      uninstall = installLogSafetyNet({ componentRoot: 'testnet' }).uninstall;
      console.error('폴러 죽음', { code: 409 });
      console.warn('mount 경고');
      // 원 출력 보존(우리가 심은 스파이가 받았다)
      expect(emitted).toContain('폴러 죽음');
      // debug.log 병행 — 카테고리 접미사가 severity + OH10 명시 level 부착
      const tail = ringTail();
      expect(tail.some((e) => e.category === 'testnet.console.error' && e.event.includes('폴러 죽음') && e.level === 'error')).toBe(true);
      expect(tail.some((e) => e.category === 'testnet.console.warn' && e.event.includes('mount 경고') && e.level === 'warn')).toBe(true);
    } finally {
      uninstall?.(); uninstall = null;
      console.error = origError;
    }
  });

  it('오염된 설치를 거부한 호출자는 결과와 관측으로 이를 알고, 테스트 리셋 뒤 다시 설치할 수 있다', () => {
    const first = installLogSafetyNet();
    const exits: number[] = [];
    const second = installLogSafetyNet({ componentRoot: 'injected', exit: (code) => exits.push(code) });

    expect(first.installed).toBe(true);
    expect(second).toMatchObject({
      installed: false,
      requestedComponentRoot: 'injected',
      installedComponentRoot: 'nexus',
    });
    expect(ringTail(20).some((event) => event.category === 'mss.logging.log-safety-net.duplicate.warn'
      && event.event === 'duplicate install refused')).toBe(true);

    _resetLogSafetyNetForTests();
    const replacement = installLogSafetyNet({ componentRoot: 'injected', exit: (code) => exits.push(code) });
    uninstall = replacement.uninstall;
    expect(replacement.installed).toBe(true);
    process.emit('uncaughtException', new Error('injected-exit'));
    expect(exits).toEqual([1]);
  });

  it('이전 설치의 해제를 재호출해도 현재 설치를 제거하지 않는다', () => {
    const first = installLogSafetyNet({ componentRoot: 'first' });
    first.uninstall();

    const exits: number[] = [];
    const second = installLogSafetyNet({ componentRoot: 'second', exit: (code) => exits.push(code) });
    first.uninstall();
    const duplicate = installLogSafetyNet({ componentRoot: 'third' });

    expect(duplicate).toMatchObject({ installed: false, installedComponentRoot: 'second' });
    process.emit('uncaughtException', new Error('second-still-active'));
    expect(exits).toEqual([1]);
    uninstall = second.uninstall;
  });
});

describe('installLogSafetyNet — 크래시 캡처', () => {
  it('uncaughtException → 포렌식 기록 + 종료 함수 호출(죽음 의미론 보존)', () => {
    const exits: number[] = [];
    uninstall = installLogSafetyNet({ componentRoot: 'crashnet', exit: (c) => exits.push(c) }).uninstall;
    const err = new Error('boom');
    process.emit('uncaughtException', err);
    expect(exits).toEqual([1]);
    const hit = ringTail(20).find((e) => e.category === 'crashnet.crash.uncaught.error');
    expect(hit).toBeDefined();
    expect(hit!.event).toContain('boom');
    expect(hit!.level).toBe('error'); // OH10 명시 level
  });

  it('unhandledRejection → 기록만(프로세스 유지)', () => {
    const exits: number[] = [];
    uninstall = installLogSafetyNet({ componentRoot: 'crashnet2', exit: (c) => exits.push(c) }).uninstall;
    process.emit('unhandledRejection', new Error('async-boom'), Promise.resolve());
    expect(exits).toEqual([]);
    const hit = ringTail(20).find((e) => e.category === 'crashnet2.crash.unhandled-rejection.error');
    expect(hit).toBeDefined();
    expect(hit!.event).toContain('async-boom');
    expect(hit!.level).toBe('error'); // OH10 명시 level
  });
});
