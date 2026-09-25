// 셸 프롬프트 자율 워처(§6(b)) — stall→detect→relay·dedup·재진입 금지·자동 dispose·fail-soft.
import { test, expect, describe } from 'bun:test';
import { watchShellForPrompts } from './shell-prompt-watcher.js';
import type { PtyEvent } from '../pty-shell/registry.js';
import type { RelayOutcome } from './shell-relay.js';
import type { SurfaceUx } from '../agent/surface-ux/types.js';

const ux = { surface: 'telegram', interactive: true, async confirm() { return true; }, async question() { return null; }, spillFile() {}, progress() {} } as unknown as SurfaceUx;

/** 수동 발화 이벤트 버스. */
function fakeBus() {
  let listener: ((ev: PtyEvent) => void) | null = null;
  const subscribe = (cb: (ev: PtyEvent) => void) => { listener = cb; return () => { listener = null; }; };
  const emit = (ev: PtyEvent) => listener?.(ev);
  const hasListener = () => listener !== null;
  return { subscribe, emit, hasListener };
}

/** relay 호출 캡처. */
function fakeRelay(outcome: Partial<RelayOutcome> = {}) {
  const calls: Array<{ shellId: string; prompt: string; options?: readonly string[]; autoDrive: string }> = [];
  const relay = async (input: { shellId: string; prompt: string; options?: readonly string[]; autoDrive: string }): Promise<RelayOutcome> => {
    calls.push({ shellId: input.shellId, prompt: input.prompt, ...(input.options ? { options: input.options } : {}), autoDrive: input.autoDrive });
    return { mode: 'escalate', answer: 'y', injected: true, ...outcome } as RelayOutcome;
  };
  return { relay, calls };
}

const stall = (id: string, silentMs = 5000): PtyEvent => ({ type: 'stalled', id, silentMs });

describe('watchShellForPrompts — stall → detect → relay', () => {
  test('승인 프롬프트 감지 시 relay 발동(기본 autoDrive off)', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'Apply patch? (y/n)', relay });
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]?.prompt).toContain('Apply patch');
    expect(calls[0]?.autoDrive).toBe('off');
  });

  test('프롬프트 없으면 relay 안 함', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'just building...', relay });
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(0);
  });

  test('다른 셸 이벤트는 무시', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'Apply patch? (y/n)', relay });
    bus.emit(stall('OTHER'));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(0);
  });

  test('minSilentMs 미만 stall 무시', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'Apply patch? (y/n)', relay, minSilentMs: 3000 });
    bus.emit(stall('s1', 1000));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(0);
    bus.emit(stall('s1', 5000));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(1);
  });
});

describe('watchShellForPrompts — dedup·재진입', () => {
  test('같은 프롬프트 반복 stall → 1회만 relay(dedup)', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'Apply patch? (y/n)', relay });
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(1);
  });

  test('프롬프트가 바뀌면 다시 relay', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    let screen = 'Apply patch? (y/n)';
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => screen, relay });
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    screen = 'Overwrite file? (y/n)';
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(2);
  });
});

describe('watchShellForPrompts — 자동 dispose·fail-soft', () => {
  test('exit 이벤트 → 구독 해제', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'Apply patch? (y/n)', relay });
    expect(bus.hasListener()).toBe(true);
    bus.emit({ type: 'exit', id: 's1', exitCode: 0 });
    expect(bus.hasListener()).toBe(false);
    bus.emit(stall('s1')); // 이미 dispose — 무반응
    await Promise.resolve();
    expect(calls.length).toBe(0);
  });

  test('disposer 호출 → 이후 stall 무시', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    const stop = watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'Apply patch? (y/n)', relay });
    stop();
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(0);
  });

  test('스냅샷 null(dead) → fail-soft(relay 안 함·크래시 없음)', async () => {
    const bus = fakeBus();
    const { relay, calls } = fakeRelay();
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => null, relay });
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    expect(calls.length).toBe(0);
  });

  test('relay throw → 워처 생존·dedup 해제(재시도 가능)', async () => {
    const bus = fakeBus();
    let n = 0;
    const relay = async () => { n++; if (n === 1) throw new Error('boom'); return { mode: 'escalate', answer: 'y', injected: true } as RelayOutcome; };
    watchShellForPrompts({ shellId: 's1', ux, subscribe: bus.subscribe, snapshot: () => 'Apply patch? (y/n)', relay });
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    bus.emit(stall('s1'));
    await Promise.resolve(); await Promise.resolve();
    expect(n).toBe(2); // 첫 throw 후 dedup 해제 → 재시도.
  });
});
