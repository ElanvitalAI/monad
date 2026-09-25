// relay → 사용자 터미널 injector(§9 융합·④) — ForwardResult→ShellInjectResult 매핑·fail-soft.
import { test, expect, describe } from 'bun:test';
import { userTerminalInjector } from './user-terminal-injector.js';
import { relayShellPrompt } from './shell-relay.js';
import type { ForwardInput, ForwardResult } from '../autopilot/terminal-forwarder.js';
import type { SurfaceUx } from '../agent/surface-ux/types.js';

function fakeUx(confirmAnswer: boolean): SurfaceUx {
  return {
    surface: 'pwa', interactive: true,
    async confirm() { return confirmAnswer; },
    async question() { return null; },
    spillFile() {}, progress() {},
  } as unknown as SurfaceUx;
}

describe('userTerminalInjector — 매핑', () => {
  test('delivered → ok:true, forward 에 올바른 입력', async () => {
    const calls: ForwardInput[] = [];
    const forward = (i: ForwardInput): ForwardResult => { calls.push(i); return { delivered: true, bytes: i.data.length }; };
    const inject = userTerminalInjector({ sessionId: 's', terminalId: 't1', forward });
    const r = await inject({ shellId: 'shell-9', bytes: 'y\n' });
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ sessionId: 's', terminalId: 't1', data: 'y\n', source: 'autopilot', origin: 'relay:shell-9' });
  });

  test('미전달(unknown_terminal) → ok:false·reason 전달(fail-soft)', async () => {
    const forward = (): ForwardResult => ({ delivered: false, bytes: 0, reason: 'unknown_terminal' });
    const inject = userTerminalInjector({ sessionId: 's', terminalId: 'gone', forward });
    const r = await inject({ shellId: 'x', bytes: 'n\n' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unknown_terminal');
  });

  test('source override 반영', async () => {
    const calls: ForwardInput[] = [];
    const forward = (i: ForwardInput): ForwardResult => { calls.push(i); return { delivered: true, bytes: 1 }; };
    const inject = userTerminalInjector({ sessionId: 's', terminalId: 't', source: 'pwa', forward });
    await inject({ shellId: 'x', bytes: 'a' });
    expect(calls[0]?.source).toBe('pwa');
  });
});

describe('relayShellPrompt + userTerminalInjector — end-to-end', () => {
  test('confirm 승인 → 사용자 터미널로 y 재주입', async () => {
    const calls: ForwardInput[] = [];
    const forward = (i: ForwardInput): ForwardResult => { calls.push(i); return { delivered: true, bytes: i.data.length }; };
    const inject = userTerminalInjector({ sessionId: 's', terminalId: 't', forward });
    const out = await relayShellPrompt({
      shellId: 'shell-1', prompt: 'Apply patch? (y/n)', ux: fakeUx(true), autoDrive: 'off', inject,
    });
    expect(out.injected).toBe(true);
    expect(calls[0]?.data).toBe('y\n');
    expect(calls[0]?.terminalId).toBe('t');
  });

  test('미전달 → relay fail-soft(injected:false·inject-failed)', async () => {
    const forward = (): ForwardResult => ({ delivered: false, bytes: 0, reason: 'unknown_terminal' });
    const inject = userTerminalInjector({ sessionId: 's', terminalId: 'gone', forward });
    const out = await relayShellPrompt({
      shellId: 'shell-1', prompt: 'Apply? (y/n)', ux: fakeUx(true), autoDrive: 'off', inject,
    });
    expect(out.injected).toBe(false);
    expect(out.reason).toContain('inject-failed');
    expect(out.reason).toContain('unknown_terminal');
  });
});
