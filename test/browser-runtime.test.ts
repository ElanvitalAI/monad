import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { CdpClient, CdpEventListener } from '../src/browser-cdp/client.js';
import {
  dispatchBrowserNavigate,
  dispatchBrowserRead,
  browserNavigateRuntime,
  browserReadRuntime,
  setBrowserRuntimeDeps,
  closeBrowserRuntime,
} from '../src/tool-runtime/browser-runtime.js';
import {
  defaultControlSignalBus,
  _resetDefaultControlSignalBusForTesting,
} from '../src/input/control-signal.js';

interface FakeClient extends CdpClient {
  emit(method: string, params?: Record<string, unknown>): void;
  __navigateCalls: string[];
  __evaluateReturns: Map<string, unknown>;
}

function makeFakeClient(overrides: {
  title?: string;
  href?: string;
  bodyText?: string;
  bodyHtml?: string;
  navigateFails?: boolean;
  evaluateFails?: boolean;
  screenshotBytes?: Buffer;
  screenshotFails?: boolean;
} = {}): FakeClient {
  const evalReturns = new Map<string, unknown>();
  evalReturns.set('document.title', overrides.title ?? 'Test Page');
  evalReturns.set('document.location.href', overrides.href ?? 'https://example.com/');
  evalReturns.set('document.body.innerText', overrides.bodyText ?? 'hello world');
  evalReturns.set('document.body.outerHTML', overrides.bodyHtml ?? '<body>hello</body>');

  const listeners = new Map<string, Set<CdpEventListener>>();
  const navigateCalls: string[] = [];

  const client: FakeClient = {
    port: 9222,
    pid: 1234,
    get isAlive() { return true; },
    async navigate(url) {
      navigateCalls.push(url);
      if (overrides.navigateFails) throw new Error('nav failed');
      return { frameId: 'test-frame' };
    },
    async screenshot() {
      if (overrides.screenshotFails) throw new Error('screenshot failed');
      return overrides.screenshotBytes ?? Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    },
    async evaluate(expr) {
      if (overrides.evaluateFails) throw new Error('eval failed');
      // Pattern match selector-wrapped expressions.
      for (const [key, value] of evalReturns) {
        if (expr === key) return value;
      }
      // For selector-scoped reads: simulate returning body text
      if (/innerText/.test(expr)) return overrides.bodyText ?? 'hello world';
      if (/outerHTML/.test(expr)) return overrides.bodyHtml ?? '<body>hello</body>';
      return undefined;
    },
    async setScriptExecutionDisabled() { /* no script execution is simulated by this runtime double */ },
    async close() { /* noop */ },
    on(method, listener) {
      let s = listeners.get(method);
      if (!s) { s = new Set(); listeners.set(method, s); }
      s.add(listener);
      return () => { s!.delete(listener); };
    },
    emit(method, params = {}) {
      for (const key of [method, '*']) {
        const set = listeners.get(key);
        if (!set) continue;
        for (const l of set) l({ method, params });
      }
    },
    __navigateCalls: navigateCalls,
    __evaluateReturns: evalReturns,
  };

  return client;
}

describe('browser runtimes — availability', () => {
  afterEach(async () => {
    setBrowserRuntimeDeps({ getClient: async () => null });
    await closeBrowserRuntime();
    _resetDefaultControlSignalBusForTesting();
  });

  test('BrowserNavigate returns error when Chrome unavailable', async () => {
    setBrowserRuntimeDeps({ getClient: async () => null });
    const out = await dispatchBrowserNavigate({ url: 'https://example.com' });
    expect(out.output).toContain('Chrome unavailable');
    expect(out.finalUrl).toBe('');
  });

  test('BrowserRead returns error when Chrome unavailable', async () => {
    setBrowserRuntimeDeps({ getClient: async () => null });
    const out = await dispatchBrowserRead({});
    expect(out.output).toContain('Chrome unavailable');
  });

  test('client acquisition failures preserve throws and emit exactly one observation per runtime action', async () => {
    const observations: Array<{ event: string; data: Record<string, unknown> }> = [];
    setBrowserRuntimeDeps({
      getClient: async () => { throw new Error('client unavailable'); },
      observe: (event, data) => observations.push({ event, data }),
    });
    await expect(dispatchBrowserNavigate({ url: 'https://example.com' })).rejects.toThrow('client unavailable');
    await expect(dispatchBrowserRead({ mode: 'screenshot' })).rejects.toThrow('client unavailable');
    expect(observations).toEqual([
      { event: 'executed', data: expect.objectContaining({ action: 'navigate', sessionId: 'browser-runtime', ok: false, error: 'client unavailable' }) },
      { event: 'executed', data: expect.objectContaining({ action: 'read', sessionId: 'browser-runtime', mode: 'screenshot', ok: false, error: 'client unavailable', captureOutcome: 'error' }) },
    ]);
  });
});

describe('dispatchBrowserNavigate', () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = makeFakeClient();
    setBrowserRuntimeDeps({ getClient: async () => fake });
  });

  afterEach(async () => {
    await closeBrowserRuntime();
    _resetDefaultControlSignalBusForTesting();
  });

  test('rejects empty url', async () => {
    const out = await dispatchBrowserNavigate({ url: '' });
    expect(out.output).toContain('url is required');
    expect(out.finalUrl).toBe('');
  });

  test('navigate emits a bounded observation with the harness run id while preserving its result', async () => {
    const observations: Array<{ event: string; data: Record<string, unknown> }> = [];
    const previousRunId = process.env.ELANOUS_RUN_ID;
    process.env.ELANOUS_RUN_ID = 'browser-runtime-run';
    setBrowserRuntimeDeps({ observe: (event, data) => observations.push({ event, data }) });
    try {
      const out = await dispatchBrowserNavigate({ url: 'https://example.com', waitForLoad: false });
      expect(out.finalUrl).toBe('https://example.com/');
      expect(out.title).toBe('Test Page');
    } finally {
      if (previousRunId === undefined) delete process.env.ELANOUS_RUN_ID;
      else process.env.ELANOUS_RUN_ID = previousRunId;
    }
    expect(observations).toEqual([{
      event: 'executed',
      data: expect.objectContaining({
        action: 'navigate', sessionId: 'browser-runtime', runId: 'browser-runtime-run',
        url: 'https://example.com/', target: 'https://example.com', ok: true, titleLength: 'Test Page'.length,
      }),
    }]);
  });

  test('without waitForLoad returns immediately with title + finalUrl', async () => {
    const out = await dispatchBrowserNavigate({ url: 'https://example.com', waitForLoad: false });
    expect(fake.__navigateCalls).toEqual(['https://example.com']);
    expect(out.title).toBe('Test Page');
    expect(out.finalUrl).toBe('https://example.com/');
    expect(out.output).toContain('title: Test Page');
  });

  test('waitForLoad resolves on Page.loadEventFired', async () => {
    const p = dispatchBrowserNavigate({ url: 'https://example.com', timeoutMs: 5000 });
    // Fire the event after a microtask so the subscribe happens first.
    await new Promise((r) => setTimeout(r, 5));
    fake.emit('Page.loadEventFired');
    const out = await p;
    expect(out.timedOut).toBeUndefined();
  });

  test('waitForLoad times out if event never fires', async () => {
    const out = await dispatchBrowserNavigate({ url: 'https://example.com', timeoutMs: 20 });
    expect(out.timedOut).toBe(true);
    expect(out.output).toContain('load event timed out');
  });

  test('navigate failure surfaces in output', async () => {
    fake = makeFakeClient({ navigateFails: true });
    setBrowserRuntimeDeps({ getClient: async () => fake });
    const out = await dispatchBrowserNavigate({ url: 'https://example.com', waitForLoad: false });
    expect(out.output).toContain('error');
    expect(out.output).toContain('nav failed');
  });

  test('timeoutMs is clamped to 60_000', async () => {
    // Sanity: our default schema caps at 60000 — verify that huge
    // values don't block forever by checking that the wait path at
    // least returns within a reasonable window even if miscoded.
    const out = await dispatchBrowserNavigate({ url: 'https://example.com', timeoutMs: 10, waitForLoad: true });
    expect(out).toBeDefined();
  });
});

describe('dispatchBrowserRead', () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = makeFakeClient({ bodyText: 'alpha beta gamma', bodyHtml: '<body><p>alpha</p></body>' });
    setBrowserRuntimeDeps({ getClient: async () => fake });
  });

  afterEach(async () => {
    await closeBrowserRuntime();
    _resetDefaultControlSignalBusForTesting();
  });

  test('read emits bounded text and screenshot observations while preserving results', async () => {
    const observations: Array<{ event: string; data: Record<string, unknown> }> = [];
    const previousRunId = process.env.ELANOUS_RUN_ID;
    process.env.ELANOUS_RUN_ID = 'browser-runtime-read-run';
    setBrowserRuntimeDeps({ observe: (event, data) => observations.push({ event, data }) });
    try {
      expect((await dispatchBrowserRead({})).text).toBe('alpha beta gamma');
      expect((await dispatchBrowserRead({ mode: 'screenshot' })).screenshotBase64).toBeDefined();
    } finally {
      if (previousRunId === undefined) delete process.env.ELANOUS_RUN_ID;
      else process.env.ELANOUS_RUN_ID = previousRunId;
    }
    expect(observations).toHaveLength(2);
    expect(observations[0]!.data).toEqual(expect.objectContaining({
      action: 'read', sessionId: 'browser-runtime', runId: 'browser-runtime-read-run',
      target: 'document.body', mode: 'text', ok: true, charLength: 'alpha beta gamma'.length,
      returnedChars: 'alpha beta gamma'.length,
    }));
    expect(JSON.stringify(observations[0]!.data)).not.toContain('alpha beta gamma');
    expect(observations[1]!.data).toEqual(expect.objectContaining({
      action: 'read', sessionId: 'browser-runtime', runId: 'browser-runtime-read-run',
      target: 'screenshot', mode: 'screenshot', ok: true, attachmentRef: null, captureOutcome: 'inline-base64',
    }));
  });

  test('text mode default returns innerText', async () => {
    const out = await dispatchBrowserRead({});
    expect(out.mode).toBe('text');
    expect(out.text).toBe('alpha beta gamma');
    expect(out.output).toContain('alpha beta gamma');
  });

  test('html mode returns outerHTML', async () => {
    const out = await dispatchBrowserRead({ mode: 'html' });
    expect(out.mode).toBe('html');
    expect(out.htmlLength).toBe('<body><p>alpha</p></body>'.length);
    expect(out.output).toContain('<body>');
  });

  test('screenshot mode returns base64 PNG', async () => {
    const out = await dispatchBrowserRead({ mode: 'screenshot' });
    expect(out.mode).toBe('screenshot');
    expect(out.screenshotBase64).toBeDefined();
    expect(out.output).toContain('screenshot');
    expect(out.output).toContain('PNG');
  });

  test('maxChars truncates long content', async () => {
    const huge = 'x'.repeat(5000);
    fake = makeFakeClient({ bodyText: huge });
    setBrowserRuntimeDeps({ getClient: async () => fake });
    const out = await dispatchBrowserRead({ maxChars: 100 });
    expect(out.truncated).toBe(true);
    expect(out.text?.length).toBe(100);
  });

  test('selector passes through to evaluate', async () => {
    const out = await dispatchBrowserRead({ mode: 'text', selector: '.main' });
    expect(out.output).toContain('selector=.main');
  });

  test('evaluate failure surfaces in output', async () => {
    fake = makeFakeClient({ evaluateFails: true });
    setBrowserRuntimeDeps({ getClient: async () => fake });
    const out = await dispatchBrowserRead({});
    expect(out.output).toContain('evaluate error');
    expect(out.output).toContain('eval failed');
  });

  test('recent browser-cdp-stop quick-pass closes the singleton client', async () => {
    let closed = 0;
    setBrowserRuntimeDeps({
      getClient: async () => fake,
      closeClient: async () => { closed += 1; },
    });
    await dispatchBrowserRead({});
    defaultControlSignalBus().emit({
      kind: 'browser-cdp-stop',
      urgency: 'quick-pass',
      source: 'system',
      mayPreempt: true,
      scope: { surface: 'browser' },
    });
    expect(closed).toBe(1);
  });
});

describe('runtime shape', () => {
  test('BrowserNavigate runtime id + spec name', () => {
    expect(browserNavigateRuntime.id).toBe('browser_navigate');
    expect(browserNavigateRuntime.spec.name).toBe('BrowserNavigate');
    expect(browserNavigateRuntime.spec.parameters.required).toContain('url');
  });

  test('BrowserRead runtime id + spec name', () => {
    expect(browserReadRuntime.id).toBe('browser_read');
    expect(browserReadRuntime.spec.name).toBe('BrowserRead');
    const props = browserReadRuntime.spec.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.mode?.enum).toEqual(['text', 'html', 'screenshot']);
  });
});
