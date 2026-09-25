import { describe, expect, mock, test } from 'bun:test';
import { createRequire } from 'node:module';

import { createReactHookHarness } from '@/lib/testing/react-hook-harness';

type StateListener = (state: 'CONNECTING' | 'OPEN' | 'FAILED' | 'CLOSED', error?: Error) => void;
type IntervalCallback = () => void;

const require = createRequire(import.meta.url);
const react = require('react') as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
};
const harness = createReactHookHarness(react);
const listeners = new Set<StateListener>();
let now = 0;
let nextIntervalId = 1;
const intervals = new Map<number, IntervalCallback>();

Object.defineProperty(globalThis, 'window', {
  value: {
    setInterval: (callback: IntervalCallback) => {
      const id = nextIntervalId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => intervals.delete(id),
  },
  configurable: true,
});

Date.now = () => now;

const element = (type: unknown, props?: Record<string, unknown>) => {
  const ref = props?.ref as { current: unknown } | undefined;
  if (ref) ref.current = {};
  return react.createElement(type, props);
};

mock.module('react/jsx-dev-runtime', () => ({ jsxDEV: element }));
mock.module('react/jsx-runtime', () => ({ jsx: element, jsxs: element }));

class Terminal {
  cols = 80;
  rows = 24;
  unicode = { activeVersion: '' };
  loadAddon(): void {}
  open(): void {}
  write(): void {}
  onData(): { dispose(): void } { return { dispose() {} }; }
  onResize(): { dispose(): void } { return { dispose() {} }; }
  dispose(): void {}
}

mock.module('@xterm/xterm', () => ({ Terminal }));
mock.module('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }));
mock.module('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
mock.module('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
mock.module('@xterm/addon-serialize', () => ({ SerializeAddon: class { serialize(): string { return ''; } } }));
mock.module('@/lib/debug', () => ({ debugLog: () => {} }));
mock.module('@/lib/monad-term-envelope', () => ({ parseMonadTermEnvelope: () => null }));
mock.module('@/lib/peer-id', () => ({ getPeerId: () => 'peer' }));
mock.module('@/lib/snapshot', () => ({ loadSnapshot: () => null, saveSnapshot: () => {}, snapshotKey: () => 'snapshot' }));
mock.module('@/lib/xterm-resize-controller', () => ({ createXtermResizeController: () => ({ dispose: () => {} }) }));
mock.module('@/lib/xterm-capability-filter', () => ({ isXtermCapabilityResponse: () => false }));

const acp = {
  ready: Promise.resolve('s1'),
  on: () => () => {},
  onState: (listener: StateListener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  send: () => Promise.resolve({}),
  close: () => {},
};

const daemon = {
  client: { connectAcp: () => acp },
  config: { baseUrl: 'http://127.0.0.1:4242' },
  setSessionId: () => {},
};

mock.module('@/components/providers/DaemonProvider', () => ({ useDaemon: () => daemon }));

const { XtermView } = await import('./XtermView');

type Element = { props?: { children?: unknown[]; className?: string; 'aria-live'?: string } };

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const children = (value as Element).props?.children ?? [];
  return children.map(textOf).join('');
}

function statusClassOf(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const elementValue = value as Element;
  if (typeof elementValue.props?.className === 'string' && elementValue.props.className.includes('absolute right-2 top-2')) {
    return elementValue.props.className;
  }
  const children = elementValue.props?.children ?? [];
  return children.map(statusClassOf).find(Boolean) ?? '';
}

function liveTextOf(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const elementValue = value as Element;
  if (elementValue.props?.['aria-live'] === 'polite') return textOf(elementValue);
  const children = elementValue.props?.children ?? [];
  return children.map(liveTextOf).find(Boolean) ?? '';
}

function render(terminalId = 't1'): unknown {
  harness.render(() => XtermView({ sessionId: 's1', terminalId }));
  return harness.find((element) => element.type === 'div' && element.props.className === 'relative h-full w-full bg-[#0d0c08]');
}

function mount(terminalId = 't1'): () => void {
  render(terminalId);
  return () => harness.unmount();
}

function resetState(): void {
  harness.unmount();
  listeners.clear();
  intervals.clear();
  now = 0;
}

describe('XtermView ACP status surface', () => {
  test('shows deterministic connecting duration, target, and daemon address, then hides them after opening', () => {
    resetState();
    const cleanup = mount('terminal-a');
    listeners.forEach((listener) => listener('CONNECTING'));
    const connecting = render('terminal-a');
    expect(textOf(connecting)).toContain('ACP: 연결 중 · 0초 · terminal-a · http://127.0.0.1:4242');
    expect(liveTextOf(connecting)).toBe('ACP: 연결 중');

    now = 65_000;
    intervals.forEach((callback) => callback());
    const waiting = render('terminal-a');
    expect(textOf(waiting)).toContain('ACP: 연결 중 · 65초 · terminal-a · http://127.0.0.1:4242');
    expect(liveTextOf(waiting)).toBe('ACP: 연결 중');
    expect(statusClassOf(waiting)).toContain('text-amber-300');

    listeners.forEach((listener) => listener('OPEN'));
    const opened = render('terminal-a');
    expect(textOf(opened)).toContain('ACP: 연결됨');
    expect(textOf(opened)).not.toContain('65초');
    expect(textOf(opened)).not.toContain('terminal-a');
    expect(textOf(opened)).not.toContain('http://127.0.0.1:4242');
    expect(statusClassOf(opened)).toContain('text-emerald-300');
    cleanup();
  });

  test('uses a target fallback, preserves failure and closed labels and tones, and clears timers on unmount', () => {
    resetState();
    const cleanup = mount('   ');
    expect(textOf(render('   '))).toContain('ACP: 연결 중 · 0초 · 대상 미지정 · http://127.0.0.1:4242');
    expect(statusClassOf(render('   '))).toContain('text-amber-300');

    listeners.forEach((listener) => listener('FAILED', new Error('offline')));
    const failed = render('   ');
    expect(textOf(failed)).toContain('ACP: 연결 실패');
    expect(statusClassOf(failed)).toContain('text-red-300');

    listeners.forEach((listener) => listener('CLOSED'));
    const closed = render('   ');
    expect(textOf(closed)).toContain('ACP: 연결 종료');
    expect(statusClassOf(closed)).toContain('text-red-300');

    cleanup();
    expect(listeners.size).toBe(0);
    expect(intervals.size).toBe(0);
  });

  test('renders a replacement terminal as connecting before its replacement effects run', () => {
    resetState();
    const firstCleanup = mount('terminal-a');
    listeners.forEach((listener) => listener('OPEN'));
    expect(textOf(render('terminal-a'))).toContain('ACP: 연결됨');

    now = 42_000;
    const replacementBeforeEffects = render('terminal-b');
    expect(textOf(replacementBeforeEffects)).toContain('ACP: 연결 중 · 0초 · terminal-b · http://127.0.0.1:4242');
    expect(textOf(replacementBeforeEffects)).not.toContain('연결됨');
    expect(statusClassOf(replacementBeforeEffects)).toContain('text-amber-300');

    firstCleanup();
    const secondCleanup = mount('terminal-b');
    expect(textOf(render('terminal-b'))).toContain('ACP: 연결 중 · 0초 · terminal-b · http://127.0.0.1:4242');
    secondCleanup();
  });
});
