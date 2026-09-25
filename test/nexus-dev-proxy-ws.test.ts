import { describe, expect, test } from 'bun:test';

import {
  buildDevProxyWsUrl,
  closeDevProxyUpstream,
  pathMatchesDevProxyWs,
  relayDevProxyClientMessage,
  wireDevProxyWebSocket,
  type DevProxyWsClient,
  type DevProxyWsState,
} from '../src/nexus/api/dev-proxy';

const READY_OPEN = 1;
const READY_CONNECTING = 0;

function makeFakeUpstream(initialReadyState = READY_CONNECTING): DevProxyWsClient & {
  listeners: Map<string, Array<(e: { data?: unknown; code?: number; reason?: string }) => void>>;
  sent: Array<unknown>;
  _setReadyState(s: number): void;
  _emit(type: 'open' | 'message' | 'close' | 'error', payload?: { data?: unknown; code?: number; reason?: string }): void;
} {
  const listeners = new Map<string, Array<(e: { data?: unknown; code?: number; reason?: string }) => void>>();
  const sent: Array<unknown> = [];
  let readyState = initialReadyState;
  return {
    binaryType: 'arraybuffer' as BinaryType,
    get readyState() { return readyState; },
    set readyState(v: number) { readyState = v; },
    send(data) { sent.push(data); },
    close() { readyState = 3; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    listeners,
    sent,
    _setReadyState(s) { readyState = s; },
    _emit(type, payload) {
      listeners.get(type)?.forEach((fn) => fn(payload ?? {}));
    },
  };
}

function makeFakeServerSide(): {
  send: (d: string | Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
  sent: Array<string | Uint8Array>;
  closes: Array<{ code?: number; reason?: string }>;
} {
  const sent: Array<string | Uint8Array> = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  return {
    send: (d) => sent.push(d),
    close: (code, reason) => {
      const entry: { code?: number; reason?: string } = {};
      if (code !== undefined) entry.code = code;
      if (reason !== undefined) entry.reason = reason;
      closes.push(entry);
    },
    sent,
    closes,
  };
}

describe('pathMatchesDevProxyWs', () => {
  test('matches the three known Next.js HMR paths', () => {
    expect(pathMatchesDevProxyWs('/_next/webpack-hmr')).toBe(true);
    expect(pathMatchesDevProxyWs('/_next/turbopack-hmr')).toBe(true);
    expect(pathMatchesDevProxyWs('/_next/HMR')).toBe(true);
  });

  test('does not match unrelated paths', () => {
    expect(pathMatchesDevProxyWs('/v1/acp')).toBe(false);
    expect(pathMatchesDevProxyWs('/v1/voice/ws')).toBe(false);
    expect(pathMatchesDevProxyWs('/_next/static/chunk.js')).toBe(false);
    expect(pathMatchesDevProxyWs('/_next/webpack-hmr/foo')).toBe(false);
    expect(pathMatchesDevProxyWs('/app/chat')).toBe(false);
  });
});

describe('buildDevProxyWsUrl', () => {
  test('http upstream → ws://', () => {
    expect(buildDevProxyWsUrl('http://localhost:3210', '/_next/webpack-hmr', ''))
      .toBe('ws://localhost:3210/_next/webpack-hmr');
  });

  test('https upstream → wss://', () => {
    expect(buildDevProxyWsUrl('https://example.com', '/_next/HMR', '?v=1'))
      .toBe('wss://example.com/_next/HMR?v=1');
  });

  test('strips trailing slash from upstream', () => {
    expect(buildDevProxyWsUrl('http://localhost:3210/', '/_next/webpack-hmr', ''))
      .toBe('ws://localhost:3210/_next/webpack-hmr');
  });

  test('preserves query string verbatim', () => {
    expect(buildDevProxyWsUrl('http://localhost:3210', '/_next/webpack-hmr', '?token=abc'))
      .toBe('ws://localhost:3210/_next/webpack-hmr?token=abc');
  });
});

describe('wireDevProxyWebSocket', () => {
  test('connects upstream + flushes pending messages on open', () => {
    const upstream = makeFakeUpstream(READY_CONNECTING);
    const Ctor = function FakeWS() { return upstream; } as unknown as { new (url: string): DevProxyWsClient };
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://localhost:3210/_next/webpack-hmr',
      upstream: null,
      pending: ['queued-1', new Uint8Array([1, 2, 3])],
      ready: false,
    };

    wireDevProxyWebSocket(server, state, { webSocketCtor: Ctor });
    expect(state.upstream).toBe(upstream);
    expect(upstream.binaryType).toBe('arraybuffer');
    expect(state.pending).toEqual(['queued-1', new Uint8Array([1, 2, 3])]); // not flushed yet

    upstream._setReadyState(READY_OPEN);
    upstream._emit('open');
    expect(state.ready).toBe(true);
    expect(upstream.sent).toEqual(['queued-1', new Uint8Array([1, 2, 3])]);
    expect(state.pending).toEqual([]);
  });

  test('upstream → server: forwards string + ArrayBuffer + Uint8Array', () => {
    const upstream = makeFakeUpstream();
    const Ctor = function FakeWS() { return upstream; } as unknown as { new (url: string): DevProxyWsClient };
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://x',
      upstream: null,
      pending: [],
      ready: false,
    };
    wireDevProxyWebSocket(server, state, { webSocketCtor: Ctor });

    upstream._emit('message', { data: 'hello' });
    upstream._emit('message', { data: new Uint8Array([4, 5, 6]).buffer });
    upstream._emit('message', { data: new Uint8Array([7, 8, 9]) });

    expect(server.sent).toHaveLength(3);
    expect(server.sent[0]).toBe('hello');
    expect(server.sent[1]).toEqual(new Uint8Array([4, 5, 6]));
    expect(server.sent[2]).toEqual(new Uint8Array([7, 8, 9]));
  });

  test('upstream close propagates to server with same code + reason', () => {
    const upstream = makeFakeUpstream();
    const Ctor = function FakeWS() { return upstream; } as unknown as { new (url: string): DevProxyWsClient };
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://x',
      upstream: null,
      pending: [],
      ready: false,
    };
    wireDevProxyWebSocket(server, state, { webSocketCtor: Ctor });
    upstream._emit('close', { code: 1006, reason: 'abnormal' });
    expect(server.closes).toEqual([{ code: 1006, reason: 'abnormal' }]);
    expect(state.ready).toBe(false);
  });

  test('upstream error closes server with 1011', () => {
    const upstream = makeFakeUpstream();
    const Ctor = function FakeWS() { return upstream; } as unknown as { new (url: string): DevProxyWsClient };
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://x',
      upstream: null,
      pending: [],
      ready: false,
    };
    wireDevProxyWebSocket(server, state, { webSocketCtor: Ctor });
    upstream._emit('error');
    expect(server.closes).toEqual([{ code: 1011, reason: 'upstream error' }]);
  });

  test('server → upstream: live forward when upstream OPEN', () => {
    const upstream = makeFakeUpstream(READY_OPEN);
    const Ctor = function FakeWS() { return upstream; } as unknown as { new (url: string): DevProxyWsClient };
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://x',
      upstream: null,
      pending: [],
      ready: true,
    };
    wireDevProxyWebSocket(server, state, { webSocketCtor: Ctor });

    relayDevProxyClientMessage(state, 'live-1');
    relayDevProxyClientMessage(state, new Uint8Array([1]));
    expect(upstream.sent).toEqual(['live-1', new Uint8Array([1])]);
    expect(state.pending).toEqual([]);
  });

  test('server → upstream: queue when upstream CONNECTING', () => {
    const upstream = makeFakeUpstream(READY_CONNECTING);
    const Ctor = function FakeWS() { return upstream; } as unknown as { new (url: string): DevProxyWsClient };
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://x',
      upstream: null,
      pending: [],
      ready: false,
    };
    wireDevProxyWebSocket(server, state, { webSocketCtor: Ctor });

    relayDevProxyClientMessage(state, 'queued-a');
    relayDevProxyClientMessage(state, 'queued-b');
    expect(upstream.sent).toEqual([]);
    expect(state.pending).toEqual(['queued-a', 'queued-b']);

    upstream._setReadyState(READY_OPEN);
    upstream._emit('open');
    expect(upstream.sent).toEqual(['queued-a', 'queued-b']);
  });

  test('closeDevProxyUpstream is idempotent', () => {
    const upstream = makeFakeUpstream(READY_OPEN);
    const Ctor = function FakeWS() { return upstream; } as unknown as { new (url: string): DevProxyWsClient };
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://x',
      upstream: null,
      pending: [],
      ready: true,
    };
    wireDevProxyWebSocket(server, state, { webSocketCtor: Ctor });
    closeDevProxyUpstream(state);
    expect(state.upstream).toBeNull();
    expect(() => closeDevProxyUpstream(state)).not.toThrow();
  });

  test('falls back to a no-op upstream when WebSocket constructor is missing', () => {
    const server = makeFakeServerSide();
    const state: DevProxyWsState = {
      upstreamUrl: 'ws://x',
      upstream: null,
      pending: [],
      ready: false,
    };
    // Remove global WebSocket if present, restore after.
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    try {
      wireDevProxyWebSocket(server, state);
      expect(server.closes).toEqual([{ code: 1011, reason: 'WebSocket unavailable' }]);
    } finally {
      if (original !== undefined) (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });
});
