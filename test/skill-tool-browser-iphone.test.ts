import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  dispatchBrowserOpen,
  dispatchBrowserNavigate,
  dispatchBrowserScreenshot,
  dispatchBrowserRead,
  dispatchBrowserClose,
  dispatchIPhoneNotify,
  dispatchIPhoneOpenUrl,
  dispatchIPhoneAgentResult,
  dispatchIPhoneConfirm,
  dispatchHitlConfirm,
  buildBrowserOpenTool,
  buildBrowserNavigateTool,
  buildBrowserScreenshotTool,
  buildBrowserReadTool,
  buildBrowserCloseTool,
  buildHitlConfirmTool,
  _resetCdpSessionsForTesting,
} from '../src/skills/tools/browser-iphone.js';
import type { CdpClient, CdpEndpoint } from '../src/browser-cdp/client.js';
import { debug } from '../src/debug/log.js';
import type { PushcutClient } from '../src/pushcut/client.js';
import {
  _resetGlobalPersonaRegistryForTest,
  setGlobalPersonaRegistryDir,
} from '../src/persona/global-registry.js';

const personaDirs: string[] = [];

function setPersonaRegistry(files: Record<string, string>): void {
  const dir = mkdtempSync(joinPath(tmpdir(), 'monad-browser-personas-'));
  personaDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(joinPath(dir, name), content);
  setGlobalPersonaRegistryDir(dir);
}

function fakeCdpClient(): CdpClient & { navigates: string[]; screenshots: number; evaluations: string[]; evaluateResult: unknown; closed: boolean } {
  const navigates: string[] = [];
  const evaluations: string[] = [];
  let screenshots = 0;
  let evaluateResult: unknown = null;
  let closed = false;
  return {
    port: 9222,
    pid: 42,
    isAlive: true,
    navigate: async (url) => { navigates.push(url); },
    screenshot: async () => { screenshots++; return Buffer.from([0x89, 0x50, 0x4e, 0x47]); },
    evaluate: async (expression: string) => { evaluations.push(expression); return evaluateResult; },
    close: async () => { closed = true; },
    get navigates() { return navigates; },
    get screenshots() { return screenshots; },
    get evaluations() { return evaluations; },
    get evaluateResult() { return evaluateResult; },
    set evaluateResult(value: unknown) { evaluateResult = value; },
    get closed() { return closed; },
  } as unknown as CdpClient & { navigates: string[]; screenshots: number; evaluations: string[]; evaluateResult: unknown; closed: boolean };
}

afterEach(() => {
  _resetCdpSessionsForTesting();
  _resetGlobalPersonaRegistryForTest();
  for (const dir of personaDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('schemas', () => {
  test('browser tool names remain stable', () => {
    expect([
      buildBrowserOpenTool(),
      buildBrowserNavigateTool(),
      buildBrowserScreenshotTool(),
      buildBrowserReadTool(),
      buildBrowserCloseTool(),
    ].map((tool) => tool.name)).toEqual([
      'BrowserOpen',
      'BrowserNavigate',
      'BrowserScreenshot',
      'BrowserRead',
      'BrowserClose',
    ]);
    expect(buildHitlConfirmTool().name).toBe('HitlConfirm');
  });
});

describe('browser_* lifecycle', () => {
  test('open → navigate → screenshot → close', async () => {
    const fake = fakeCdpClient();
    const open = await dispatchBrowserOpen(
      { url: 'https://example.com' },
      { createClient: async () => fake },
    );
    const sid = open.output.match(/session_id=(\S+)/)?.[1];
    expect(sid).toBeTruthy();

    const nav = await dispatchBrowserNavigate({ session_id: sid, url: 'https://other.com' });
    expect(nav.output).toContain('https://other.com');
    expect(fake.navigates).toContain('https://other.com');

    const dir = mkdtempSync(joinPath(tmpdir(), 'monad-shot-'));
    const shot = await dispatchBrowserScreenshot(
      { session_id: sid },
      { outputDir: dir },
    );
    expect(shot.output).toMatch(/saved=/);
    expect(fake.screenshots).toBe(1);

    const closed = await dispatchBrowserClose({ session_id: sid });
    expect(closed.output).toContain(sid as string);
    expect(fake.closed).toBe(true);
  });

  test('each lifecycle action emits bounded harness.browser-action observations without changing returns', async () => {
    const fake = fakeCdpClient();
    fake.evaluateResult = 'secret page body';
    const observations: Array<{ event: string; data: Record<string, unknown> }> = [];
    const observe = (event: string, data: Record<string, unknown>) => observations.push({ event, data });
    const previousRunId = process.env.MONAD_RUN_ID;
    process.env.MONAD_RUN_ID = 'browser-tool-run';
    try {
      const open = await dispatchBrowserOpen({ url: 'https://example.com' }, { createClient: async () => fake, observe });
      const sessionId = open.output.match(/session_id=(\S+)/)?.[1]!;
      expect(open.output).toContain(`session_id=${sessionId}`);
      expect((await dispatchBrowserNavigate({ session_id: sessionId, url: 'https://other.com' }, { observe })).output).toContain('https://other.com');
      const shot = await dispatchBrowserScreenshot({ session_id: sessionId }, { outputDir: mkdtempSync(joinPath(tmpdir(), 'monad-observed-shot-')), observe });
      expect(shot.output).toContain('BrowserScreenshot saved=');
      const read = await dispatchBrowserRead({ session_id: sessionId }, { observe });
      expect(read.text).toBe('secret page body');
      expect((await dispatchBrowserClose({ session_id: sessionId }, { observe })).output).toContain(sessionId);
    } finally {
      if (previousRunId === undefined) delete process.env.MONAD_RUN_ID;
      else process.env.MONAD_RUN_ID = previousRunId;
    }

    expect(observations.map(({ event, data }) => [event, data.action])).toEqual([
      ['executed', 'open'], ['executed', 'navigate'], ['executed', 'screenshot'], ['executed', 'read'], ['executed', 'close'],
    ]);
    for (const { data } of observations) {
      expect(data.runId).toBe('browser-tool-run');
      expect(data.sessionId).toBeTruthy();
      expect(data.ok).toBe(true);
    }
    const screenshot = observations[2]!.data;
    expect(screenshot.attachmentRef).toContain('.png');
    expect(screenshot.captureOutcome).toBe('saved');
    const read = observations[3]!.data;
    expect(read.charLength).toBe('secret page body'.length);
    expect(read.returnedChars).toBe('secret page body'.length);
    expect(JSON.stringify(read)).not.toContain('secret page body');
  });

  test('validation and client-creation failures each emit exactly one observation', async () => {
    const observations: Array<{ event: string; data: Record<string, unknown> }> = [];
    const observe = (event: string, data: Record<string, unknown>) => observations.push({ event, data });

    await expect(dispatchBrowserOpen({}, { createClient: async () => { throw new Error('create failed'); }, observe }))
      .rejects.toThrow('create failed');
    await expect(dispatchBrowserNavigate({ session_id: 'missing', url: 'https://example.com' }, { observe }))
      .rejects.toThrow('unknown session_id missing');
    await expect(dispatchBrowserScreenshot({ session_id: 'missing' }, { observe }))
      .rejects.toThrow('unknown session_id missing');
    await expect(dispatchBrowserRead({ session_id: 'missing' }, { observe }))
      .rejects.toThrow('unknown session_id missing');
    await expect(dispatchBrowserClose({ session_id: 'missing' }, { observe }))
      .rejects.toThrow('unknown session_id missing');

    expect(observations).toHaveLength(5);
    expect(observations.map(({ data }) => data.action)).toEqual(['open', 'navigate', 'screenshot', 'read', 'close']);
    for (const { event, data } of observations) {
      expect(event).toBe('executed');
      expect(data).toHaveProperty('sessionId');
      expect(data).toEqual(expect.objectContaining({ ok: false, error: expect.any(String) }));
    }
  });

  test('default debug.log wiring emits the harness run id without an injected observer', async () => {
    const events: Array<{ category: string; event: string; data?: Record<string, unknown> }> = [];
    const previousRunId = process.env.MONAD_RUN_ID;
    const logSpy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      events.push({ category, event, data });
    }) as never);
    process.env.MONAD_RUN_ID = 'browser-production-run';
    try {
      await dispatchBrowserOpen({ url: 'https://example.com' }, { createClient: async () => fakeCdpClient() });
    } finally {
      logSpy.mockRestore();
      if (previousRunId === undefined) delete process.env.MONAD_RUN_ID;
      else process.env.MONAD_RUN_ID = previousRunId;
    }
    expect(events).toEqual([expect.objectContaining({
      category: 'harness.browser-action', event: 'executed',
      data: expect.objectContaining({ action: 'open', runId: 'browser-production-run', sessionId: expect.any(String), ok: true }),
    })]);
  });

  test('attach resolves a persona browserPort through the global registry', async () => {
    setPersonaRegistry({
      'remote.yaml': 'personaId: remote\ndisplayName: Remote\nbrowserPort: 9333\n',
    });
    const attached = fakeCdpClient();
    let attachedPort: CdpEndpoint | undefined;

    await dispatchBrowserOpen(
      { attach: true, personaId: 'remote', port: 9222 },
      { createClientFromEndpoint: async (port) => { attachedPort = port; return attached; } },
    );

    expect(attachedPort).toBe(9333);
  });

  test('unknown persona rejects before attempting an endpoint connection', async () => {
    setPersonaRegistry({
      'known.yaml': 'personaId: known\ndisplayName: Known\n',
    });
    let attachCalls = 0;

    await expect(dispatchBrowserOpen(
      { attach: true, personaId: 'missing' },
      { createClientFromEndpoint: async () => { attachCalls++; return fakeCdpClient(); } },
    )).rejects.toThrow(/persona not found: missing.*scanned: .*monad-browser-personas-.*found personaIds: .*known/);

    expect(attachCalls).toBe(0);
  });

  test('persona without browserPort explains why attachment cannot proceed', async () => {
    setPersonaRegistry({
      'remote.yaml': 'personaId: remote\ndisplayName: Remote\n',
    });
    let attachCalls = 0;

    await expect(dispatchBrowserOpen(
      { attach: true, personaId: 'remote' },
      { createClientFromEndpoint: async () => { attachCalls++; return fakeCdpClient(); } },
    )).rejects.toThrow(/persona remote has no browserPort declared/);

    expect(attachCalls).toBe(0);
  });

  test('attach uses endpoint creator and attached session lifecycle never owns a browser process', async () => {
    const spawned = fakeCdpClient();
    const attached = fakeCdpClient();
    Object.assign(attached, { port: 9333, pid: -1 });
    let spawnCalls = 0;
    let attachedPort: CdpEndpoint | undefined;

    const open = await dispatchBrowserOpen(
      { attach: true, port: 9333 },
      {
        createClient: async () => { spawnCalls++; return spawned; },
        createClientFromEndpoint: async (port) => { attachedPort = port; return attached; },
      },
    );
    const sid = open.output.match(/session_id=(\S+)/)?.[1]!;
    expect(attachedPort).toBe(9333);
    expect(spawnCalls).toBe(0);
    expect(open.output).toContain('pid=-1');

    await dispatchBrowserNavigate({ session_id: sid, url: 'https://attached.example' });
    const dir = mkdtempSync(joinPath(tmpdir(), 'monad-attached-shot-'));
    await dispatchBrowserScreenshot({ session_id: sid }, { outputDir: dir });
    await dispatchBrowserClose({ session_id: sid });
    expect(attached.navigates).toEqual(['https://attached.example']);
    expect(attached.screenshots).toBe(1);
    expect(attached.closed).toBe(true);
    expect(attached.pid).toBe(-1);
  });

  test('open without attach preserves the spawn creator path', async () => {
    const spawned = fakeCdpClient();
    let attachCalls = 0;
    const open = await dispatchBrowserOpen(
      { port: 9444 },
      {
        createClient: async (opts) => {
          expect(opts?.port).toBe(9444);
          return spawned;
        },
        createClientFromEndpoint: async () => { attachCalls++; return fakeCdpClient(); },
      },
    );
    expect(open.output).toContain('pid=42');
    expect(attachCalls).toBe(0);
  });

  test('open → read returns page text through the session client', async () => {
    const fake = fakeCdpClient();
    fake.evaluateResult = 'Page body';
    const open = await dispatchBrowserOpen({}, { createClient: async () => fake });
    const session_id = open.output.match(/session_id=(\S+)/)?.[1]!;

    const read = await dispatchBrowserRead({ session_id });

    expect(read.text).toBe('Page body');
    expect(read.output).toContain('Page body');
    expect(fake.evaluations).toEqual(['document.body.innerText']);
  });

  test('read scopes text and HTML with the requested selector', async () => {
    const fake = fakeCdpClient();
    const open = await dispatchBrowserOpen({}, { createClient: async () => fake });
    const session_id = open.output.match(/session_id=(\S+)/)?.[1]!;

    fake.evaluateResult = 'Scoped text';
    const text = await dispatchBrowserRead({ session_id, selector: '.article' });
    expect(text.text).toBe('Scoped text');
    expect(fake.evaluations.at(-1)).toContain('document.querySelector(".article")');
    expect(fake.evaluations.at(-1)).toContain('.innerText');

    fake.evaluateResult = '<article>Scoped HTML</article>';
    const html = await dispatchBrowserRead({ session_id, mode: 'html', selector: '#main' });
    expect(html.htmlLength).toBe(30);
    expect(fake.evaluations.at(-1)).toContain('document.querySelector("#main")');
    expect(fake.evaluations.at(-1)).toContain('.outerHTML');
  });

  test('read does not fall back to the document body for a missing selector', async () => {
    const fake = fakeCdpClient();
    const open = await dispatchBrowserOpen({}, { createClient: async () => fake });
    const session_id = open.output.match(/session_id=(\S+)/)?.[1]!;

    fake.evaluateResult = '';
    const read = await dispatchBrowserRead({ session_id, selector: '.missing' });

    expect(read.text).toBe('');
    expect(read.output).not.toContain('document.body.innerText');
    expect(fake.evaluations.at(-1)).toContain("return element ? element.innerText : ''; ");
  });

  test('read serializes CSS selectors safely for page evaluation', async () => {
    const fake = fakeCdpClient();
    const open = await dispatchBrowserOpen({}, { createClient: async () => fake });
    const session_id = open.output.match(/session_id=(\S+)/)?.[1]!;
    const selector = "[data-label='a\\b']\nline\u2028next\u2029end";

    await dispatchBrowserRead({ session_id, selector });

    expect(fake.evaluations.at(-1)).toContain(JSON.stringify(selector));
  });

  test('read caps and truncates text at the requested and hard limits', async () => {
    const fake = fakeCdpClient();
    fake.evaluateResult = 'x'.repeat(250_000);
    const open = await dispatchBrowserOpen({}, { createClient: async () => fake });
    const session_id = open.output.match(/session_id=(\S+)/)?.[1]!;

    const defaultLimited = await dispatchBrowserRead({ session_id });
    expect(defaultLimited.text).toHaveLength(50_000);
    expect(defaultLimited.truncated).toBe(true);

    const requested = await dispatchBrowserRead({ session_id, max_chars: 4 });
    expect(requested.text).toBe('xxxx');
    expect(requested.truncated).toBe(true);
    expect(requested.output).toContain('truncated from 250000');

    const hardCapped = await dispatchBrowserRead({ session_id, max_chars: 300_000 });
    expect(hardCapped.text).toHaveLength(200_000);
    expect(hardCapped.truncated).toBe(true);
  });

  test('read supports screenshot mode and unknown sessions reject like other browser tools', async () => {
    const fake = fakeCdpClient();
    const open = await dispatchBrowserOpen({}, { createClient: async () => fake });
    const session_id = open.output.match(/session_id=(\S+)/)?.[1]!;

    const screenshot = await dispatchBrowserRead({ session_id, mode: 'screenshot', selector: '.ignored' });
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    expect(screenshot.screenshotBase64).toBe(base64);
    expect(screenshot.output).toContain(base64);
    expect(fake.screenshots).toBe(1);
    await expect(dispatchBrowserRead({ session_id: 'nope' })).rejects.toThrow('unknown session_id nope');
  });

  test('navigate with unknown session rejects', async () => {
    await expect(dispatchBrowserNavigate({ session_id: 'nope', url: 'https://x.com' }))
      .rejects.toThrow(/unknown/);
  });

  test('navigate empty url rejects', async () => {
    const fake = fakeCdpClient();
    const o = await dispatchBrowserOpen({}, { createClient: async () => fake });
    const sid = o.output.match(/session_id=(\S+)/)?.[1]!;
    await expect(dispatchBrowserNavigate({ session_id: sid, url: '' }))
      .rejects.toThrow(/url/);
  });
});

describe('iphone_notify', () => {
  test('missing name rejects', async () => {
    const client: PushcutClient = { configured: false, notify: async () => ({ ok: true }), execute: async () => ({ ok: true }) };
    await expect(dispatchIPhoneNotify({}, { client })).rejects.toThrow(/name/);
  });

  test('passes name/title/text and builds URL action', async () => {
    const got: Array<{ name: string; body: Record<string, unknown> }> = [];
    const client: PushcutClient = {
      configured: true,
      async notify(name, body) { got.push({ name, body: body as Record<string, unknown> }); return { ok: true }; },
      async execute() { return { ok: true }; },
    };
    const r = await dispatchIPhoneNotify(
      { name: 'hello', title: 'T', text: 'X', url: 'https://e.com' },
      { client },
    );
    expect(r.output).toContain('ok=true');
    expect(got[0]!.name).toBe('hello');
    const actions = got[0]!.body.actions as Array<{ url: string }>;
    expect(actions?.[0]!.url).toBe('https://e.com');
  });
});

describe('iphone_open_url + iphone_agent_result', () => {
  test('open url delegates to presets.openUrlOnSafari', async () => {
    const seen: string[] = [];
    const client: PushcutClient = {
      configured: true,
      async notify() { return { ok: true }; },
      async execute(_a, payload) { seen.push(String(payload.url ?? '')); return { ok: true }; },
    };
    const r = await dispatchIPhoneOpenUrl({ url: 'https://x.com' }, { client });
    expect(r.output).toContain('ok=true');
    expect(seen).toContain('https://x.com');
  });

  test('agent result formats title/summary/url', async () => {
    const got: Record<string, unknown>[] = [];
    const client: PushcutClient = {
      configured: true,
      async notify(_n, body) { got.push(body as Record<string, unknown>); return { ok: true }; },
      async execute() { return { ok: true }; },
    };
    await dispatchIPhoneAgentResult(
      { title: 'Done', summary: 'Great', url: 'https://r.com' },
      { client },
    );
    expect(got[0]!.title).toBe('Done');
    expect((got[0]!.actions as Array<{ name: string }>)[0]!.name).toBe('Open');
  });
});

describe('iphone_confirm', () => {
  test('returns null when callback not wired', async () => {
    const client: PushcutClient = {
      configured: true,
      async notify() { return { ok: true }; },
      async execute() { return { ok: true }; },
    };
    const r = await dispatchIPhoneConfirm({ prompt: 'ok?' }, { client });
    expect(r.output).toContain('answer=null');
  });

  test('resolves from awaitCallback', async () => {
    const client: PushcutClient = {
      configured: true,
      async notify() { return { ok: true }; },
      async execute() { return { ok: true }; },
    };
    const r = await dispatchIPhoneConfirm(
      { prompt: 'ok?' },
      { client, awaitCallback: async () => true },
    );
    expect(r.output).toContain('answer=true');
  });
});

describe('hitl_confirm', () => {
  test('races channels and returns winner', async () => {
    const r = await dispatchHitlConfirm({ prompt: 'OK?' }, {
      channels: [
        { name: 'fake', request: async () => true, cancel: () => {} },
      ],
    });
    expect(r.output).toContain('answer=true');
    expect(r.output).toContain('channel=fake');
  });

  test('empty channels → all-failed + answer=false', async () => {
    const r = await dispatchHitlConfirm({ prompt: 'OK?' }, { channels: [] });
    expect(r.output).toContain('answer=false');
    expect(r.output).toContain('channel=all-failed');
  });

  test('missing prompt rejects', async () => {
    await expect(dispatchHitlConfirm({})).rejects.toThrow(/prompt/);
  });
});
