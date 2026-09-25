import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { createXtermResizeController } from './xterm-resize-controller';

interface FakeResizeObserver {
  cb: (entries: unknown[]) => void;
  observed: Element[];
  disconnect(): void;
  observe(el: Element): void;
}

interface FakeVisualViewport {
  listeners: Map<string, Set<EventListener>>;
  addEventListener(name: string, fn: EventListener): void;
  removeEventListener(name: string, fn: EventListener): void;
  fire(name: string): void;
}

const realWindow = (globalThis as { window?: unknown }).window;

function installEnv(opts: {
  withResizeObserver?: boolean;
  withVisualViewport?: boolean;
} = {}): {
  win: {
    listeners: Map<string, Set<EventListener>>;
    addEventListener: (name: string, fn: EventListener) => void;
    removeEventListener: (name: string, fn: EventListener) => void;
    fire: (name: string) => void;
    visualViewport: FakeVisualViewport | null;
  };
  vv: FakeVisualViewport | null;
  observers: FakeResizeObserver[];
} {
  const observers: FakeResizeObserver[] = [];
  const vv: FakeVisualViewport | null = opts.withVisualViewport === false
    ? null
    : (() => {
        const listeners = new Map<string, Set<EventListener>>();
        return {
          listeners,
          addEventListener(name, fn) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)!.add(fn);
          },
          removeEventListener(name, fn) {
            listeners.get(name)?.delete(fn);
          },
          fire(name) {
            listeners.get(name)?.forEach((fn) => fn(new Event(name)));
          },
        };
      })();

  const winListeners = new Map<string, Set<EventListener>>();
  const win = {
    listeners: winListeners,
    addEventListener(name: string, fn: EventListener) {
      if (!winListeners.has(name)) winListeners.set(name, new Set());
      winListeners.get(name)!.add(fn);
    },
    removeEventListener(name: string, fn: EventListener) {
      winListeners.get(name)?.delete(fn);
    },
    fire(name: string) {
      winListeners.get(name)?.forEach((fn) => fn(new Event(name)));
    },
    visualViewport: vv,
  };

  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });

  if (opts.withResizeObserver === false) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  } else {
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
      cb: (entries: unknown[]) => void;
      observed: Element[] = [];
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
        observers.push({
          cb,
          observed: this.observed,
          disconnect: () => {
            this.observed.length = 0;
          },
          observe: (el: Element) => {
            this.observed.push(el);
          },
        });
      }
      observe(el: Element) {
        this.observed.push(el);
      }
      disconnect() {
        this.observed.length = 0;
      }
      unobserve() {}
    };
  }

  return { win, vv, observers };
}

function uninstallEnv(): void {
  if (realWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window: unknown }).window = realWindow;
  }
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
}

let targetBounds = { width: 364, height: 200 };

const FakeTarget = {
  getBoundingClientRect: () => targetBounds,
} as unknown as Element;

beforeEach(() => {
  targetBounds = { width: 364, height: 200 };
  installEnv();
});

afterEach(() => {
  uninstallEnv();
});

describe('createXtermResizeController', () => {
  test('onImmediate runs synchronously on ResizeObserver fire — no debounce', () => {
    const { observers } = installEnv();
    let calls = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        calls += 1;
      },
    });
    expect(observers.length).toBe(1);
    expect(observers[0].observed[0]).toBe(FakeTarget);

    observers[0].cb([]);
    expect(calls).toBe(1); // immediate — not debounced

    observers[0].cb([]);
    observers[0].cb([]);
    expect(calls).toBe(3);
    ctrl.dispose();
  });

  test('skips fitting and trailing work at zero height, then retries after the box grows', () => {
    const { win } = installEnv();
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    targetBounds = { width: 364, height: 0 };
    let immediate = 0;
    let trailing = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => { immediate += 1; },
      onTrailing: () => { trailing += 1; },
      trailingDebounceMs: 1000,
    });

    win.fire('resize');
    expect(immediate).toBe(0);
    expect(trailing).toBe(0);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('webterm.resize.skip'),
      expect.objectContaining({ source: 'win', w: 364, h: 0, reason: 'zero-height' }),
    );

    targetBounds = { width: 364, height: 200 };
    win.fire('resize');
    expect(immediate).toBe(1);
    ctrl.flushPending();
    expect(trailing).toBe(1);
    debugSpy.mockRestore();
    ctrl.dispose();
  });

  test('cancels pending trailing work when the box becomes zero height', async () => {
    const { win } = installEnv();
    let immediate = 0;
    let trailing = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => { immediate += 1; },
      onTrailing: () => { trailing += 1; },
      trailingDebounceMs: 5,
    });

    win.fire('resize');
    expect(immediate).toBe(1);
    targetBounds = { width: 364, height: 0 };
    win.fire('resize');
    await new Promise((r) => setTimeout(r, 20));
    expect(immediate).toBe(1);
    expect(trailing).toBe(0);
    ctrl.dispose();
  });

  test('fits at a positive fractional height', () => {
    const { win } = installEnv();
    targetBounds = { width: 364, height: 0.4 };
    let immediate = 0;
    let trailing = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => { immediate += 1; },
      onTrailing: () => { trailing += 1; },
      trailingDebounceMs: 1000,
    });

    win.fire('resize');
    expect(immediate).toBe(1);
    ctrl.flushPending();
    expect(trailing).toBe(1);
    ctrl.dispose();
  });

  test('onImmediate runs synchronously on window resize', () => {
    const { win } = installEnv();
    let calls = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        calls += 1;
      },
    });
    win.fire('resize');
    expect(calls).toBe(1);
    win.fire('resize');
    expect(calls).toBe(2);
    ctrl.dispose();
  });

  test('onImmediate runs synchronously on visualViewport resize', () => {
    const { vv } = installEnv();
    let calls = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        calls += 1;
      },
    });
    vv!.fire('resize');
    expect(calls).toBe(1);
    ctrl.dispose();
  });

  test('onTrailing fires once after the trailing-edge window', async () => {
    const { win } = installEnv();
    let immediate = 0;
    let trailing = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        immediate += 1;
      },
      onTrailing: () => {
        trailing += 1;
      },
      trailingDebounceMs: 5,
    });

    // Burst of 50 events — onImmediate 50, onTrailing 1.
    for (let i = 0; i < 50; i++) win.fire('resize');
    expect(immediate).toBe(50);
    expect(trailing).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(trailing).toBe(1);

    ctrl.dispose();
  });

  test('without onTrailing, no debounce machinery is exercised', async () => {
    const { win } = installEnv();
    let immediate = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        immediate += 1;
      },
    });
    win.fire('resize');
    win.fire('resize');
    await new Promise((r) => setTimeout(r, 20));
    expect(immediate).toBe(2);
    expect(() => ctrl.flushPending()).not.toThrow();
    ctrl.dispose();
  });

  test('flushPending runs the pending trailing callback immediately', () => {
    const { win } = installEnv();
    let trailing = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {},
      onTrailing: () => {
        trailing += 1;
      },
      trailingDebounceMs: 1000,
    });
    win.fire('resize');
    expect(trailing).toBe(0);
    ctrl.flushPending();
    expect(trailing).toBe(1);
    // No-op if nothing pending
    ctrl.flushPending();
    expect(trailing).toBe(1);
    ctrl.dispose();
  });

  test('dispose tears down all listeners + cancels trailing', async () => {
    const { win, vv } = installEnv();
    let immediate = 0;
    let trailing = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        immediate += 1;
      },
      onTrailing: () => {
        trailing += 1;
      },
      trailingDebounceMs: 5,
    });
    win.fire('resize');
    expect(immediate).toBe(1);
    ctrl.dispose();
    await new Promise((r) => setTimeout(r, 20));
    expect(trailing).toBe(0); // pending trailing was cancelled

    // Late events post-dispose are ignored.
    win.fire('resize');
    vv!.fire('resize');
    await new Promise((r) => setTimeout(r, 20));
    expect(immediate).toBe(1);
    expect(trailing).toBe(0);
    expect(win.listeners.get('resize')?.size ?? 0).toBe(0);
    expect(vv!.listeners.get('resize')?.size ?? 0).toBe(0);
  });

  test('dispose is idempotent', () => {
    installEnv();
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {},
    });
    ctrl.dispose();
    expect(() => ctrl.dispose()).not.toThrow();
  });

  test('falls back to window resize when ResizeObserver is unavailable', () => {
    const { win } = installEnv({ withResizeObserver: false });
    let calls = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        calls += 1;
      },
    });
    win.fire('resize');
    expect(calls).toBe(1);
    ctrl.dispose();
  });

  test('handles missing visualViewport gracefully', () => {
    const { win } = installEnv({ withVisualViewport: false });
    let calls = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        calls += 1;
      },
    });
    win.fire('resize');
    expect(calls).toBe(1);
    ctrl.dispose();
  });

  test('swallows throws from onImmediate without breaking subsequent fires', () => {
    const { win } = installEnv();
    let calls = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
    });
    win.fire('resize');
    expect(calls).toBe(1);
    win.fire('resize');
    expect(calls).toBe(2);
    ctrl.dispose();
  });

  test('swallows throws from onTrailing', async () => {
    const { win } = installEnv();
    let trailing = 0;
    const ctrl = createXtermResizeController({
      target: FakeTarget,
      onImmediate: () => {},
      onTrailing: () => {
        trailing += 1;
        throw new Error('boom');
      },
      trailingDebounceMs: 5,
    });
    win.fire('resize');
    await new Promise((r) => setTimeout(r, 20));
    expect(trailing).toBe(1);
    // Controller still healthy.
    win.fire('resize');
    await new Promise((r) => setTimeout(r, 20));
    expect(trailing).toBe(2);
    ctrl.dispose();
  });
});
