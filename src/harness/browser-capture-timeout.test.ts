// 화면 포착 시한 — ⛔ 「멎음을 잡는다」와 ***「끝나게 둔다」*** 둘 다가 계약이다.
import { describe, expect, test } from 'bun:test';
import { captureWithTimeout, describeCaptureFailure } from './browser-capture-timeout.js';
import type { CdpClient } from '../browser-cdp/client.js';

function client(over: Partial<CdpClient>): CdpClient {
  return { async screenshot() { return Buffer.from('PNG'); }, ...over } as CdpClient;
}

describe('captureWithTimeout', () => {
  test('제때 오면 그림을 준다', async () => {
    const r = await captureWithTimeout(client({}), 50);
    expect('png' in r && r.png.toString()).toBe('PNG');
  });

  test('«영영 안 오면» 멎음으로 답한다 — 던지지 않는다', async () => {
    const r = await captureWithTimeout(client({ screenshot: () => new Promise<Buffer>(() => {}) }), 30);
    expect(r).toEqual({ stalled: true });
  });

  test('던지면 «이유를 담아» 답한다 — 라벨만 남기지 않는다', async () => {
    const r = await captureWithTimeout(client({ async screenshot(): Promise<Buffer> { throw new Error('target closed'); } }), 30);
    expect('failed' in r && r.reason).toContain('target closed');
  });

  test('fullPage 를 «주면 넘기고 안 주면 안 넘긴다»', async () => {
    const seen: unknown[] = [];
    const c = client({ async screenshot(o?: unknown) { seen.push(o); return Buffer.from('P'); } } as Partial<CdpClient>);
    await captureWithTimeout(c, 50);
    await captureWithTimeout(c, 50, { fullPage: true });
    expect(seen).toEqual([undefined, { fullPage: true }]);
  });

  /**
   * ⛔⭐⭐ 회귀 방어 — 2026-08-28 에 «실제로» 났다.
   * 타이머를 안 걷으면 포착이 «성공해도» 이벤트 루프가 살아 있어 CLI 가 안 끝나고,
   * `verify-url` 계약 시험이 5초에 SIGTERM(exit 143)으로 죽었다.
   * ⇒ 「시한이 있나」가 아니라 ***「성공한 뒤 타이머가 남나」***를 문다.
   */
  test('성공한 뒤 «붙들린 타이머»가 남지 않는다', async () => {
    const pending = new Set<unknown>();
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void, ms?: number) => {
      const handle = realSet(fn, ms);
      pending.add(handle);
      return handle;
    }) as typeof setTimeout;
    (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
      pending.delete(handle);
      return realClear(handle);
    }) as typeof clearTimeout;
    try {
      await captureWithTimeout(client({}), 60_000); // 안 걷으면 «1분» 붙든다
      expect(pending.size).toBe(0);
    } finally {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout = realSet;
      (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = realClear;
      for (const handle of pending) realClear(handle as Parameters<typeof clearTimeout>[0]);
    }
  });

  test('던진 뒤에도 타이머가 남지 않는다(finally 경로)', async () => {
    const pending = new Set<unknown>();
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void, ms?: number) => {
      const handle = realSet(fn, ms); pending.add(handle); return handle;
    }) as typeof setTimeout;
    (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
      pending.delete(handle); return realClear(handle);
    }) as typeof clearTimeout;
    try {
      await captureWithTimeout(client({ async screenshot(): Promise<Buffer> { throw new Error('boom'); } }), 60_000);
      expect(pending.size).toBe(0);
    } finally {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout = realSet;
      (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = realClear;
      for (const handle of pending) realClear(handle as Parameters<typeof clearTimeout>[0]);
    }
  });
});

describe('describeCaptureFailure', () => {
  test('빈 문면을 «빈 채로» 두지 않는다', () => {
    expect(describeCaptureFailure(new Error(''))).toContain('빈');
  });
  test('상한을 넘으면 자르고 «잘렸다고» 말한다', () => {
    expect(describeCaptureFailure('x'.repeat(500))).toContain('(잘림)');
  });
});
