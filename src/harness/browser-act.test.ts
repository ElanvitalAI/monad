import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performBrowserAction, type BrowserActionDeps, type BrowserActionRequest } from './browser-act.js';
import type { CdpClient, CdpEventListener } from '../browser-cdp/client.js';

type LifecycleListener = (event: { method: string; params: Record<string, unknown> }) => void;

function fakeClient(options: {
  navigationError?: string;
  closeCalls: { value: number };
  expressions: string[];
  emitLoad?: boolean;
  on?: 'absent' | 'throw';
  navigation?: { frameId: string; loaderId?: string };
  onDispose?: () => void;
  onSubscribe?: () => void;
  /** ⚖️ 이 대상이 무엇을 일으키나 — navigation | submit | other. */
  clickKind?: 'navigation' | 'submit' | 'other';
  /** 클릭이 «일으키는» lifecycle 이벤트 — 이동하는 클릭을 흉내 낸다. */
  emitOnClick?: Array<{ name: string; frameId?: string; loaderId?: string }>;
  /** 클릭이 돌아온 «뒤»에 도착하는 lifecycle — 이동이 클릭 반환보다 늦은 경우를 흉내 낸다. */
  emitOnClickAfterMs?: Array<{ ms: number; events: Array<{ name: string; frameId?: string; loaderId?: string }> }>;
  /** 클라이언트 호출·lifecycle 순서. 지정된 때만 기록한다. */
  calls?: string[];
  evaluationError?: Error;
  screenshot?: Buffer;
  screenshotError?: Error;
  evaluationValue?: unknown;
  clicks?: Array<{ x: number; y: number }>;
}): CdpClient {
  let listener: LifecycleListener | undefined;
  const emitLifecycle = (e: { name: string; frameId?: string; loaderId?: string }) => {
    const frameId = e.frameId ?? 'frame';
    const loaderId = e.loaderId ?? 'loader-2';
    options.calls?.push(`lifecycle:${e.name}:${frameId}:${loaderId}`);
    listener?.({ method: 'Page.lifecycleEvent', params: { name: e.name, frameId, loaderId } });
  };
  const client: CdpClient = {
    port: 9222,
    pid: -1,
    isAlive: true,
    async navigate() {
      options.calls?.push('navigate');
      const navigation = options.navigation ?? { frameId: 'frame', loaderId: 'loader' };
      if (options.emitLoad) listener?.({
        method: 'Page.lifecycleEvent',
        params: { name: 'load', frameId: navigation.frameId, loaderId: navigation.loaderId },
      });
      return options.navigationError ? { ...navigation, errorText: options.navigationError } : navigation;
    },
    async evaluate(expression) {
      options.calls?.push('evaluate');
      options.expressions.push(expression);
      if (options.evaluationError) throw options.evaluationError;
      // ⚖️ 실물 꼴 — clickExpression 은 좌표 «와 함께» 클릭 종류를 낸다.
      //    ⛔ kind 가 없으면 executeClick 이 «거부»한다(「모른다」를 「괜찮다」로 안 읽는다).
      return options.evaluationValue ?? { x: 120, y: 80, kind: options.clickKind ?? 'navigation' };
    },
    async screenshot() {
      options.calls?.push('screenshot');
      if (options.screenshotError) throw options.screenshotError;
      return options.screenshot ?? Buffer.from('png');
    },
    async setScriptExecutionDisabled(value) { options.calls?.push(`set-script-execution-disabled:${value}`); },
    async click(coordinates) {
      options.calls?.push('click');
      options.clicks?.push(coordinates);
      for (const e of options.emitOnClick ?? []) emitLifecycle(e);
      for (const delayed of options.emitOnClickAfterMs ?? []) {
        setTimeout(() => {
          for (const e of delayed.events) emitLifecycle(e);
        }, delayed.ms);
      }
    },
    async close() { options.calls?.push('close'); options.closeCalls.value += 1; },
  };
  if (options.on !== 'absent') {
    client.on = (_method: string, subscribed: CdpEventListener) => {
      if (options.on === 'throw') throw new Error('subscription failed');
      options.onSubscribe?.();
      listener = subscribed;
      return () => {
        listener = undefined;
        options.onDispose?.();
      };
    };
  }
  return client;
}

function runArmedAction(request: BrowserActionRequest, deps: BrowserActionDeps = {}) {
  return performBrowserAction(request, { loadWaitTimeoutMs: 40, ...deps });
}

describe('performBrowserAction', () => {
  test('human-armed request accepts only the matching lifecycle load, validates the hit target, and records coordinates before tab cleanup', async () => {
    const closeCalls = { value: 0 };
    const expressions: string[] = [];
    const clicks: Array<{ x: number; y: number }> = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls, expressions, clicks, emitLoad: true }),
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-1', path: '/tmp/att-1.png', filename: 'att-1.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => events.push({ event, data }),
        getRunId: () => 'run-browser-act',
      },
    );

    expect(result).toEqual({ ok: true, url: 'https://example.test', target: '#save', observed: { coordinates: { x: 120, y: 80 }, captureOutcome: 'ok', clickedHref: null, landedUrl: null, landingVerdict: 'unmeasured' } });
    // ⛔ 표현식이 «둘»이다 — 클릭 탐침 ⊕ 이동 뒤 location.href(목적지 관측). 그 «둘째»를 이름으로 문다.
    expect(expressions).toHaveLength(2);
    expect(expressions[1]).toBe('location.href');
    expect(expressions[0]).toContain('document.querySelector("#save")');
    expect(expressions[0]).toContain("element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })");
    expect(expressions[0]).toContain('document.elementFromPoint');
    // ⛔⭐ 「포함하나」가 아니라 ***「어떤 순서인가」***를 문다 — 좌표는 «스크롤 뒤»에 읽혀야 한다.
    //    이 저장소에 DOM 시험 기반(jsdom·happy-dom)이 «없어서» 실제 스크롤은 못 재지만,
    //    ⓐ 스크롤을 먼저 시키고 ⓑ 그 «뒤»에 사각형을 읽는 것은 «우리 코드»의 책임이라 여기서 문다.
    //    (`behavior: 'instant'` 라 브라우저 쪽 스크롤은 동기다 — 그것은 브라우저의 계약이다)
    expect(expressions[0].indexOf('scrollIntoView'))
      .toBeLessThan(expressions[0].indexOf('getBoundingClientRect'));
    // ⛔ 반환 «꼴»을 못 박지 않는다 — 칸을 하나 더 달 때마다 깨지고, 그 압력이 «추가를 막는다».
    //    📏 실측 2026-08-28: `return { x, y }` → `return { x, y, kind }` 로 바꾸자 이 시험이 깨졌다.
    //    ⇒ 지키려는 것은 「측정이 반환 «앞»에 온다」이지 «반환하는 필드 목록»이 아니다.
    expect(expressions[0].indexOf('getBoundingClientRect'))
      .toBeLessThan(expressions[0].lastIndexOf('return {'));
    expect(expressions[0]).not.toContain('element.click()');
    expect(clicks).toEqual([{ x: 120, y: 80 }]);
    expect(events).toEqual([{
      event: 'executed',
      data: expect.objectContaining({
        coordinates: { x: 120, y: 80 },
        attachmentRef: '/tmp/att-1.png',
        runId: 'run-browser-act',
      }),
    }]);
    expect(closeCalls.value).toBe(1);
  });

  test('uses null run attribution outside a harness while retaining the dispatched coordinates', async () => {
    const closeCalls = { value: 0 };
    const clicks: Array<{ x: number; y: number }> = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls, expressions: [], clicks, emitLoad: true, evaluationValue: { x: 42, y: 24, kind: 'navigation' } }),
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-2', path: '/tmp/att-2.png', filename: 'att-2.png', mediaType: 'image/png', size: 3, createdAt: 2 } }),
        observe: (event, data) => events.push({ event, data }),
        getRunId: () => null,
      },
    );

    expect(result.ok).toBe(true);
    expect(clicks).toEqual([{ x: 42, y: 24 }]);
    expect(events).toEqual([{
      event: 'executed',
      data: expect.objectContaining({ coordinates: { x: 42, y: 24 }, attachmentRef: '/tmp/att-2.png', runId: null, personaId: null }),
    }]);
  });

  test('records non-empty run, bot, named entry-point, and unknown entry-point attribution without changing existing observation values', async () => {
    const cases = [
      { name: 'run', request: { entryPoint: 'harness/manual' }, getRunId: () => 'run-1', expected: { kind: 'run', entryPoint: 'harness/manual' } },
      { name: 'bot', request: { entryPoint: 'persona/browser', persona: { personaId: 'bot-1', displayName: 'Bot' } }, getRunId: () => null, expected: { kind: 'bot', entryPoint: 'persona/browser' } },
      // 🔬 2026-08-30(37차 · RFC §23b-5): 탐침이 «봇으로 행세»하던 것을 걷었다.
      //    ⛔ 자기 리뷰(`#14158`)가 짚었다 — 첫 판의 시험은 ***persona 를 안 넘겨*** 핵심을 안 물었다.
      //       ⇒ persona 가 «있는데도» probe 로 남는지, run 이 «있는데도» 그런지를 둘 다 문다.
      { name: 'probe over bot', request: { entryPoint: 'canary/probe', probe: true, persona: { personaId: 'bot-1', displayName: 'Bot' } }, getRunId: () => null, expected: { kind: 'probe', entryPoint: 'canary/probe' } },
      { name: 'probe over run', request: { entryPoint: 'canary/probe', probe: true, persona: { personaId: 'bot-1', displayName: 'Bot' } }, getRunId: () => 'run-1', expected: { kind: 'probe', entryPoint: 'canary/probe' } },
      { name: 'entry-point', request: { entryPoint: 'human/browser' }, getRunId: () => null, expected: { kind: 'entry-point', entryPoint: 'human/browser' } },
      { name: 'unknown entry-point', request: {}, getRunId: () => null, expected: { kind: 'entry-point', entryPoint: 'unknown' } },
    ] as const;

    for (const scenario of cases) {
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      await runArmedAction(
        { url: 'https://example.test', target: '#save', armed: true, ...scenario.request },
        {
          connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true, evaluationValue: { x: 42, y: 24, kind: 'navigation' } }),
          getRunId: scenario.getRunId,
          saveAttachment: async () => ({ ok: true, entry: { id: 'att', path: '/tmp/att.png', filename: 'att.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
          observe: (event, data) => events.push({ event, data }),
        },
      );

      expect(events, scenario.name).toEqual([{
        event: 'executed',
        data: expect.objectContaining({
          runId: scenario.name === 'run' || scenario.name === 'probe over run' ? 'run-1' : null,
          // 🔬 ⛔ 탐침이어도 personaId 는 «남는다» — 「어느 봇의 브라우저를 찔렀나」는 여전히 값이다.
          //    바뀌는 것은 ***「누가 했나」***뿐이다.
          personaId: scenario.expected.kind === 'bot' || scenario.name.startsWith('probe') ? 'bot-1' : null,
          coordinates: { x: 42, y: 24 },
          attachmentRef: '/tmp/att.png',
          captureOutcome: 'ok',
          attribution: scenario.expected,
        }),
      }]);
    }
  });

  /**
   * 🔬⛔⭐⭐ **탐침은 «면제»가 아니다 — «행동»으로 문다** (2026-08-30 · 자기 리뷰 `#14158` 이 요구했다)
   *
   * 🪞 첫 판은 이것을 ***소스 400자 조각 검사***로 물었다. 리뷰가 「실제 동작이 아니다」라고 짚었고 맞다 —
   *    ⛔ 소스 검사는 「그 자리에 글자가 있나」만 답하고 ***「그래서 거부되나」***는 못 답한다.
   * 🪞 그리고 나는 이것을 라이브로도 «한 번 틀렸다» — 첫 실물 반증이 통과했고, 원인은 코드가 아니라
   *    ***이 우주의 페르소나에 `actionHosts` 가 «없다»***는 것이었다(§4 `T64`).
   *    ⇒ 시험은 그 우주 의존이 «없다». 그래서 이 자리가 그 반증의 «영구 보관소»다.
   */
  test('🔬 탐침이 «경계 밖»을 찌르면 거부된다 — probe 는 귀속만 바꾸고 경계를 «안 넓힌다»', async () => {
    const result = await runArmedAction(
      {
        url: 'https://example.com', target: 'a', armed: true, probe: true,
        persona: { personaId: 'nb', displayName: 'NB', actionHosts: ['news.ycombinator.com'] },
      },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true, evaluationValue: { x: 1, y: 2, kind: 'navigation' } }),
        getRunId: () => null,
      },
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error?: unknown }).error)).toContain('refused (boundary)');
  });

  test('🔬 탐침이 «경계 안»을 찌르면 통과한다 — 「늘 거부」면 그것은 검사가 아니다', async () => {
    const result = await runArmedAction(
      {
        url: 'https://news.ycombinator.com/', target: 'a', armed: true, probe: true,
        persona: { personaId: 'nb', displayName: 'NB', actionHosts: ['news.ycombinator.com'] },
      },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true, evaluationValue: { x: 1, y: 2, kind: 'navigation' } }),
        getRunId: () => null,
      },
    );
    expect(result.ok).toBe(true);
  });

  test('🔬 ⛔ 경계 거부는 probe «없이도» 같다 — 이 플래그가 판정을 «한 칸도» 안 움직인다', async () => {
    // 🪞 이것이 라이브 반증에서 나를 구한 «대조군 한 줄»이다(§4 `T64`) — 30초에 「우회로인가」를 갈랐다.
    const deps = {
      connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true, evaluationValue: { x: 1, y: 2, kind: 'navigation' } }),
      getRunId: () => null,
    };
    const persona = { personaId: 'nb', displayName: 'NB', actionHosts: ['news.ycombinator.com'] };
    const withProbe = await runArmedAction({ url: 'https://example.com', target: 'a', armed: true, probe: true, persona }, deps);
    const without = await runArmedAction({ url: 'https://example.com', target: 'a', armed: true, persona }, deps);
    expect(withProbe.ok).toBe(without.ok);
    expect(String((withProbe as { error?: unknown }).error)).toBe(String((without as { error?: unknown }).error));
  });

  test('observation capture, attachment persistence, and emission failures do not alter a successful action', async () => {
    for (const observationFailure of ['capture', 'save', 'emit'] as const) {
      const closeCalls = { value: 0 };
      const result = await runArmedAction(
        { url: 'https://example.test', target: '#save', armed: true },
        {
          connect: async () => fakeClient({
            closeCalls,
            expressions: [],
            emitLoad: true,
            ...(observationFailure === 'capture' ? { screenshotError: new Error('capture unavailable') } : {}),
          }),
          saveAttachment: async () => {
            if (observationFailure === 'save') throw new Error('attachment unavailable');
            return { ok: true, entry: { id: 'att-1', path: '/tmp/att-1.png', filename: 'att-1.png', mediaType: 'image/png', size: 3, createdAt: 1 } };
          },
          observe: () => {
            if (observationFailure === 'emit') throw new Error('observation unavailable');
          },
        },
      );
      // ⭐ 조작의 성패는 셋 다 «같지만», 그 조작이 «본 것»은 실패 종류마다 «달라야» 한다 —
      //    ⛔ 여기를 한 값으로 뭉치면 「화면을 못 찍었다」와 「관측을 못 보냈다」가 같은 값이 된다.
      const expectedOutcome = observationFailure === 'emit' ? 'ok' : 'error';
      expect(result).toEqual({ ok: true, url: 'https://example.test', target: '#save', observed: { coordinates: { x: 120, y: 80 }, captureOutcome: expectedOutcome, clickedHref: null, landedUrl: null, landingVerdict: 'unmeasured' } });
      expect(closeCalls.value).toBe(1);
    }
  });

  test('a screenshot that never returns does not hang the action — it becomes captureOutcome timeout', async () => {
    // ⛔⭐ 이것이 이 파일에서 가장 중요한 시험이다.
    //    `Page.captureScreenshot` 은 «에러가 아니라 영영 안 옴»으로 실패한다 — try/catch 는 못 잡는다.
    //    ⇒ 시한이 없으면 이 관측 «하나»가 조작 전체를 영원히 멎게 한다(실측: 헤드리스 8회 중 6회).
    const closeCalls = { value: 0 };
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    let saveCalls = 0;
    const client = fakeClient({ closeCalls, expressions: [], emitLoad: true });
    // 돌아오지 «않는» 캡처
    (client as { screenshot: () => Promise<Buffer> }).screenshot = () => new Promise<Buffer>(() => {});

    const started = Date.now();
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => client,
        captureTimeoutMs: 30,
        saveAttachment: async () => { saveCalls += 1; return { ok: false, reason: 'empty' }; },
        observe: (event, data) => events.push({ event, data }),
      },
    );

    expect(result).toEqual({ ok: true, url: 'https://example.test', target: '#save', observed: { coordinates: { x: 120, y: 80 }, captureOutcome: 'timeout', clickedHref: null, landedUrl: null, landingVerdict: 'unmeasured' } });
    expect(Date.now() - started).toBeLessThan(5_000);        // ⛔ 「끝났다」가 아니라 «제때 끝났나»
    expect(saveCalls).toBe(0);                               // 매달린 그림을 저장하려 들지 않는다
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ attachmentRef: null, captureOutcome: 'timeout' });
    expect(closeCalls.value).toBe(1);                        // 탭 정리는 그대로 된다
  });

  test('every refusal leaves a trace — an unobserved failure reads as "nothing happened"', async () => {
    // ⛔⭐ 실패한 조작이 관측에 «한 줄도» 안 남았다.
    //    📏 실측 2026-08-27: 위키백과 첫 링크가 뷰포트 밖이라 도구가 «정당하게» 거부했는데
    //       harness.browser-act 에 ***행이 0개***였다 ⇒ 봇 루틴이 그렇게 실패해도 관측은 조용하다.
    //    🔑 그리고 카나리아의 `sees=` 는 «관측 행»으로 판정한다 — 행이 없으면 「왜」가 영영 안 남는다.
    const unarmed: Array<Record<string, unknown>> = [];
    const result = await performBrowserAction(
      { url: 'https://example.test', target: '#save', armed: false },
      { observe: (_event, data) => unarmed.push(data) },
    );
    expect(result).toMatchObject({ ok: false, reason: 'unarmed' });
    expect(unarmed).toHaveLength(1);
    expect(unarmed[0]).toMatchObject({
      ok: false,
      failureReason: 'unarmed',
      // ⛔ 실패는 좌표도 화면도 «없다» — 있는 척하지 않는다.
      coordinates: null,
      attachmentRef: null,
    });
    // ⭐ 그래도 «누가 무엇을 하려 했나»는 남는다 — 그것이 이 행의 값이다.
    expect(unarmed[0]).toMatchObject({ url: 'https://example.test', target: '#save' });
    expect(unarmed[0]?.attribution).toBeTruthy();
  });

  test('a lifecycle-wait timeout is observed too, not only returned', async () => {
    const events: Array<Record<string, unknown>> = [];
    const result = await performBrowserAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: false }),
        loadWaitTimeoutMs: 20,
        observe: (_event, data) => events.push(data),
      },
    );
    expect(result).toMatchObject({ ok: false, reason: 'load-timeout' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ok: false, failureReason: 'load-timeout' });
    expect(String(events[0]?.failureError)).toContain('timed out');
  });

  test('writes the post-action picture where the caller asked, because the attachment store lives in /tmp', async () => {
    // ⛔ 첨부 저장소는 /tmp 다 — macOS 가 지운다. 무인 루틴의 «증거»가 며칠 뒤 사라진다.
    //    ⇒ 부르는 쪽이 「남길 자리」를 정하게 한다.
    const dir = await mkdtemp(join(tmpdir(), 'act-shot-'));
    try {
      const shot = join(dir, 'nested', 'computer-act.png');
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      await performBrowserAction(
        { url: 'https://example.test', target: '#save', armed: true },
        {
          connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true, screenshot: Buffer.from('PNGDATA') }),
          captureTimeoutMs: 500,
          shotPath: shot,
          saveAttachment: async () => ({ ok: true, entry: { id: 'a', path: '/tmp/a.png', filename: 'a.png', mediaType: 'image/png', size: 7, createdAt: 1 } }),
          observe: (event, data) => events.push({ event, data }),
        },
      );
      // ⭐ 없는 하위 디렉터리도 «만든다» — 회차 경로는 그 순간 처음 생긴다
      expect(readFileSync(shot).toString()).toBe('PNGDATA');
      expect(events[0]?.data).toMatchObject({ shotSavedTo: shot, shotError: null });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a failed shot write does not fail the action, but it is not silent either', async () => {
    // ⛔ 「조용한 실패」가 이 저장소가 오늘 여섯 번 고친 병이다.
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const result = await performBrowserAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true, screenshot: Buffer.from('PNG') }),
        captureTimeoutMs: 500,
        // 디렉터리로는 못 쓰는 자리 — /dev/null 아래에는 디렉터리를 못 만든다
        shotPath: '/dev/null/cannot/exist/shot.png',
        saveAttachment: async () => ({ ok: true, entry: { id: 'a', path: '/tmp/a.png', filename: 'a.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => events.push({ event, data }),
      },
    );
    expect(result.ok).toBe(true);                     // ⛔ 조작을 «막지 않는다»
    expect(events[0]?.data.shotSavedTo).toBeNull();
    expect(String(events[0]?.data.shotError)).not.toBe('null');   // ⭐ 그러나 «조용하지도 않다»
    expect(String(events[0]?.data.shotError).length).toBeGreaterThan(0);
  });

  test('asks for no picture when the caller asked for none — that is not a failure', () => {
    // ⛔ 「요구가 없었다」와 「실패했다」를 같은 값으로 만들지 않는다.
    return performBrowserAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        captureTimeoutMs: 500,
        saveAttachment: async () => ({ ok: true, entry: { id: 'a', path: '/tmp/a.png', filename: 'a.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (_event, data) => {
          expect(data).toMatchObject({ shotSavedTo: null, shotError: null });
        },
      },
    ).then((r) => { expect(r.ok).toBe(true); });
  });

  test('a capture failure carries the reason, not just the label', async () => {
    // ⛔ 이 파일이 이미 「화면 참조가 없다」와 「왜 없는지」는 다른 값이라고 못 박아 뒀는데,
    //    2026-08-27 실측에서 captureOutcome==='error' 행 전수에 이유를 담은 키가 ***0개***였다.
    //    ⇒ 라벨만 내는 실패는 «셀 수만 있고 고칠 수 없다».
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const client = fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true });
    (client as { screenshot: () => Promise<Buffer> }).screenshot = () => Promise.reject(new Error('CDP target closed while capturing'));

    await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      { connect: async () => client, captureTimeoutMs: 30, observe: (event, data) => events.push({ event, data }) },
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ captureOutcome: 'error' });
    expect(String(events[0]?.data.captureError)).toContain('CDP target closed while capturing');
  });

  test('a stalled capture reports the budget it waited, since a timeout has no exception to name', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const client = fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true });
    (client as { screenshot: () => Promise<Buffer> }).screenshot = () => new Promise<Buffer>(() => {});

    await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      { connect: async () => client, captureTimeoutMs: 37, observe: (event, data) => events.push({ event, data }) },
    );

    expect(events[0]?.data).toMatchObject({ captureOutcome: 'timeout', captureTimeoutMs: 37 });
    // ⛔ timeout 은 던진 예외가 «없다» — 그러니 captureError 를 지어내지 않는다.
    expect(events[0]?.data.captureError).toBeNull();
  });

  test('a successful capture does not carry a failure budget, so ok rows stay clean', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        captureTimeoutMs: 500,
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-clean', path: '/tmp/att-clean.png', filename: 'att-clean.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => events.push({ event, data }),
      },
    );
    expect(events[0]?.data).toMatchObject({ captureOutcome: 'ok', captureError: null, captureTimeoutMs: null });
  });

  test('a successful capture reports captureOutcome ok, and an unsaved one reports not-saved', async () => {
    const okEvents: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        saveAttachment: async () => ({ ok: true, entry: { id: 'a', path: '/tmp/a.png', filename: 'a.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => okEvents.push({ event, data }),
      },
    );
    expect(okEvents[0]?.data).toMatchObject({ attachmentRef: '/tmp/a.png', captureOutcome: 'ok' });

    const unsaved: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        saveAttachment: async () => ({ ok: false, reason: 'empty' }),
        observe: (event, data) => unsaved.push({ event, data }),
      },
    );
    expect(unsaved[0]?.data).toMatchObject({ attachmentRef: null, captureOutcome: 'not-saved' });
  });

  test('preserves a CDP evaluate exception value as an execution failure', async () => {
    const closeCalls = { value: 0 };
    const expressions: string[] = [];
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls,
          expressions,
          emitLoad: true,
          evaluationError: new Error('evaluate: {"text":"Uncaught Error: browser action target not found: #save"}'),
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      url: 'https://example.test',
      target: '#save',
      reason: 'execution-failed',
      error: 'evaluate: {"text":"Uncaught Error: browser action target not found: #save"}',
    });
    expect(expressions).toHaveLength(1);
    expect(closeCalls.value).toBe(1);
  });

  test('rejects missing click coordinates instead of recording an ungrounded success', async () => {
    const closeCalls = { value: 0 };
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      { connect: async () => fakeClient({ closeCalls, expressions: [], emitLoad: true, evaluationValue: { x: 120 } }) },
    );

    expect(result).toEqual({
      ok: false,
      url: 'https://example.test',
      target: '#save',
      reason: 'execution-failed',
      error: 'browser action returned invalid click coordinates',
    });
    expect(closeCalls.value).toBe(1);
  });

  test('rejects invalid injected executor coordinates before screenshot persistence or observation', async () => {
    for (const coordinates of [{ x: Number.NaN, y: 80 }, { x: 120, y: Infinity }, { x: 120 }]) {
      const closeCalls = { value: 0 };
      const observed: Array<Record<string, unknown>> = [];
      let saveCalls = 0;
      let observeCalls = 0;
      const result = await runArmedAction(
        { url: 'https://example.test', target: '#save', armed: true },
        {
          connect: async () => fakeClient({ closeCalls, expressions: [], emitLoad: true }),
          execute: async () => coordinates as { x: number; y: number },
          saveAttachment: async () => { saveCalls += 1; return { ok: false, reason: 'empty' }; },
          observe: (_event, data) => { observeCalls += 1; observed.push(data); },
        },
      );

      expect(result).toEqual({
        ok: false,
        url: 'https://example.test',
        target: '#save',
        reason: 'execution-failed',
        error: 'browser action returned invalid click coordinates',
      });
      // ⛔ 화면은 «저장하지 않는다» — 이 시험의 원래 의도가 그것이고, 그대로 지킨다.
      expect(saveCalls).toBe(0);
      // ⭐ 그러나 관측은 «남긴다» — 이 시험의 옛 계약은 `observeCalls === 0` 이었고 그것이 결함이었다.
      //    📏 실측 2026-08-27: 위키백과 첫 링크가 뷰포트 밖이라 도구가 «정당하게» 거부했는데
      //       harness.browser-act 에 ***행이 0개***였다 ⇒ 관측으로는 「아무 일도 없었다」로 보였다.
      expect(observeCalls).toBe(1);
      expect(observed.at(-1)).toMatchObject({
        ok: false,
        failureReason: 'execution-failed',
        attachmentRef: null,
        coordinates: null,
      });
      expect(String(observed.at(-1)?.failureError)).toContain('invalid click coordinates');
      expect(closeCalls.value).toBe(1);
    }
  });

  test('returns a structured failure without evaluating when the bounded lifecycle wait times out', async () => {
    const closeCalls = { value: 0 };
    const expressions: string[] = [];
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      { connect: async () => fakeClient({ closeCalls, expressions }), loadWaitTimeoutMs: 1 },
    );

    expect(result).toEqual({
      ok: false,
      url: 'https://example.test',
      target: '#save',
      reason: 'load-timeout',
      error: 'page load timed out after 1ms',
    });
    expect(expressions).toHaveLength(0);
    expect(closeCalls.value).toBe(1);
  });

  test('refuses missing or failed lifecycle subscriptions without evaluating', async () => {
    for (const on of ['absent', 'throw'] as const) {
      const closeCalls = { value: 0 };
      const expressions: string[] = [];
      const result = await runArmedAction(
        { url: 'https://example.test', target: '#save', armed: true },
        { connect: async () => fakeClient({ closeCalls, expressions, on }) },
      );
      expect(result).toEqual({
        ok: false,
        url: 'https://example.test',
        target: '#save',
        reason: 'load-unavailable',
        error: 'page lifecycle subscription is unavailable',
      });
      expect(expressions).toHaveLength(0);
      expect(closeCalls.value).toBe(1);
    }
  });

  test('refuses navigation without a loaderId without evaluating', async () => {
    const closeCalls = { value: 0 };
    const expressions: string[] = [];
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      { connect: async () => fakeClient({ closeCalls, expressions, navigation: { frameId: 'frame' } }) },
    );

    expect(result).toEqual({
      ok: false,
      url: 'https://example.test',
      target: '#save',
      reason: 'load-unavailable',
      error: 'navigation did not provide a loaderId',
    });
    expect(expressions).toHaveLength(0);
    expect(closeCalls.value).toBe(1);
  });

  test('preserves executor failure as a structured value and closes the attached page', async () => {
    const closeCalls = { value: 0 };
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({ closeCalls, expressions: [], emitLoad: true }),
        execute: async () => { throw new Error('click rejected'); },
      },
    );

    expect(result).toEqual({ ok: false, url: 'https://example.test', target: '#save', reason: 'execution-failed', error: 'click rejected' });
    expect(closeCalls.value).toBe(1);
  });

  test('reports whether the click itself navigated, so a nameless timeout still carries a clue', async () => {
    // ⛔ timeout 은 던진 예외가 «없다» — captureError 가 빈다. 그때 남는 유일한 단서가 이것이다.
    // 📏 실측 2026-08-27: 이동하는 클릭에서 화면 11/32(34%) ↔ 이동 없는 클릭 16/16(100%).
    const navigated: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: 'a', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls: { value: 0 }, expressions: [], emitLoad: true,
          emitOnClick: [{ name: 'init', loaderId: 'loader-2' }, { name: 'load', loaderId: 'loader-2' }],
        }),
        captureTimeoutMs: 30,
        observe: (event, data) => navigated.push({ event, data }),
      },
    );
    expect(String(navigated[0]?.data.postClickLifecycle)).toContain('init');

    const still: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: 'h1', armed: true },
      {
        connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        captureTimeoutMs: 30,
        observe: (event, data) => still.push({ event, data }),
      },
    );
    expect(still[0]?.data.postClickLifecycle).toBe('none');
  });

  test('does not count the first navigation\'s own echo as a click-induced navigation', async () => {
    // ⛔ 이것이 «없으면» 이동하는 클릭과 안 하는 클릭이 «같은 값»을 내고 이 관측이 아무것도 안 가른다.
    //    📏 실측 2026-08-27: 처음엔 실제로 그랬다 — a 와 h1 의 산출이 똑같았다.
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: 'h1', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls: { value: 0 }, expressions: [], emitLoad: true,
          // 첫 이동과 «같은» loaderId 의 잔향만 온다 — 클릭이 일으킨 것이 아니다.
          emitOnClick: [{ name: 'firstContentfulPaint', loaderId: 'loader' }],
        }),
        captureTimeoutMs: 30,
        observe: (event, data) => events.push({ event, data }),
      },
    );
    expect(events[0]?.data.postClickLifecycle).toBe('none');
  });

  test('says it could not measure the navigation rather than saying there was none', async () => {
    // ⛔ 'none'(이동을 못 봤다)과 null(잴 수 없었다)은 «다른 값»이다.
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: 'h1', armed: true },
      {
        connect: async () => {
          const c = fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true });
          const real = c.on!;
          let calls = 0;
          (c as { on?: typeof real }).on = ((method, listener) => {
            calls += 1;
            if (calls > 1) throw new Error('subscription failed');   // 감시만 실패시킨다
            return real.call(c, method, listener);
          }) as typeof real;
          return c;
        },
        captureTimeoutMs: 30,
        observe: (event, data) => events.push({ event, data }),
      },
    );
    expect(events[0]?.data.postClickLifecycle).toBeNull();
  });

  test('cleans every lifecycle listener it opened, so none can outlive the action', async () => {
    // ⛔ 이 시험이 지키려는 것은 「구독이 «하나»다」가 아니라 ***「연 것을 «전부» 닫는다」***이다.
    //    앞의 꼴로 쓰면 청취자를 «하나 더» 달 때마다 이 시험이 깨지고, 그 압력이 관측 추가를 막는다
    //    (2026-08-27: 이 저장소가 카나리아 쪽에서 이미 그 병을 앓았다).
    const closeCalls = { value: 0 };
    let openCalls = 0;
    let disposeCalls = 0;
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls, expressions: [], emitLoad: true,
          onSubscribe: () => { openCalls += 1; },
          onDispose: () => { disposeCalls += 1; },
        }),
        saveAttachment: async () => ({ ok: false, reason: 'empty' }),
      },
    );

    expect(result.ok).toBe(true);
    expect(openCalls).toBeGreaterThan(0);
    expect(disposeCalls).toBe(openCalls);
    expect(closeCalls.value).toBe(1);
  });

  test('attributes the executed observation to the selected persona and uses its browserPort ahead of an injected fallback port', async () => {
    const closeCalls = { value: 0 };
    const ports: Array<number | undefined> = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const result = await runArmedAction(
      {
        url: 'https://example.test', target: '#save', armed: true,
        persona: { personaId: 'remote', displayName: 'Remote', browserPort: 9333 },
      },
      {
        port: 9223,
        connect: async (port) => {
          ports.push(port);
          return fakeClient({ closeCalls, expressions: [], emitLoad: true });
        },
        observe: (event, data) => events.push({ event, data }),
      },
    );

    expect(result.ok).toBe(true);
    expect(ports).toEqual([9333]);
    expect(events).toEqual([{
      event: 'executed',
      data: expect.objectContaining({ personaId: 'remote' }),
    }]);
  });

  test('uses the pre-change dependency fallback when the selected persona has no browserPort', async () => {
    const closeCalls = { value: 0 };
    const ports: Array<number | undefined> = [];
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: true, persona: { personaId: 'local', displayName: 'Local' } },
      {
        port: 9223,
        connect: async (port) => {
          ports.push(port);
          return fakeClient({ closeCalls, expressions: [], emitLoad: true });
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(ports).toEqual([9223]);
  });

  test('captures the screenshot after the click-induced document load, not in the middle of navigation', async () => {
    // AC1: 클릭이 새 문서를 열면 화면 캡처는 그 문서의 load «뒤»에 불린다.
    // ⛔ init 을 클릭 안에서 동기 발생시키면 경합이 숨는다 — init 과 load 둘 다 클릭 반환 뒤에 온다.
    // 대상 init 뒤 무관한 frame/loader 의 load 는 완료가 아니다. 캡처는 마지막 대상 load 뒤에만 온다.
    // 깨는 법: waitForLoad 가 식별자 없이 첫 load 를 받으면 screenshot 이 대상 load 보다 앞선다.
    const calls: string[] = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const result = await runArmedAction(
      { url: 'https://example.test', target: 'a', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls: { value: 0 }, expressions: [], emitLoad: true, calls,
          emitOnClickAfterMs: [
            { ms: 10, events: [{ name: 'init', frameId: 'main', loaderId: 'nav-2' }] },
            { ms: 20, events: [{ name: 'load', frameId: 'child', loaderId: 'nav-child' }] },
            { ms: 35, events: [{ name: 'load', frameId: 'main', loaderId: 'nav-2' }] },
          ],
        }),
        loadWaitTimeoutMs: 200,
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-nav', path: '/tmp/att-nav.png', filename: 'att-nav.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => events.push({ event, data }),
      },
    );

    expect(result.ok).toBe(true);
    const clickAt = calls.indexOf('click');
    const targetInitAt = calls.findIndex((name, index) => name === 'lifecycle:init:main:nav-2' && index > clickAt);
    const unrelatedLoadAt = calls.findIndex((name, index) => name === 'lifecycle:load:child:nav-child' && index > clickAt);
    const targetLoadAt = calls.findIndex((name, index) => name === 'lifecycle:load:main:nav-2' && index > clickAt);
    expect(targetInitAt).toBeGreaterThan(clickAt);
    expect(unrelatedLoadAt).toBeGreaterThan(targetInitAt);
    expect(targetLoadAt).toBeGreaterThan(unrelatedLoadAt);
    expect(calls.indexOf('screenshot')).toBeGreaterThan(targetLoadAt);
    expect(events[0]?.data).toMatchObject({ postClickLifecycle: 'init,load', postClickLoadWait: 'event', captureOutcome: 'ok' });
  });

  test('a click that does not navigate keeps the pre-change call order and observation', async () => {
    // AC2: 이동이 없는 클릭은 추가 CDP 왕복·고정 sleep 없이 기존 호출 순서와 관측값을 보존한다.
    // 이동 판별은 이미 수신되는 lifecycle 과 기존 시한만 쓴다. 연 구독은 전부 닫힌다.
    // 깨는 법: screenshot 앞에 evaluate 를 더 넣거나 postClickLifecycle 값을 바꾸면 빨강.
    const calls: string[] = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    let openCalls = 0;
    let disposeCalls = 0;
    const started = Date.now();
    const result = await runArmedAction(
      { url: 'https://example.test', target: 'h1', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls: { value: 0 }, expressions: [], emitLoad: true, calls,
          onSubscribe: () => { openCalls += 1; },
          onDispose: () => { disposeCalls += 1; },
        }),
        loadWaitTimeoutMs: 40,
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-still', path: '/tmp/att-still.png', filename: 'att-still.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => events.push({ event, data }),
      },
    );

    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls.filter((name) => name === 'navigate')).toHaveLength(1);
    // ⛔⭐ 2026-08-28: 왕복이 «하나 늘었다» — 클릭 탐침 ⊕ 이동 «뒤» location.href.
    //    ⚖️ 그 비용(실측 ~27ms)을 치르는 이유: ***되돌릴 수 없는 조작의 목적지를 안 남기면
    //       나중에 「어디로 갔나」를 «영영» 못 잰다***. 늘어난 수를 «적어» 둔다 — 조용히 늘리지 않는다.
    expect(calls.filter((name) => name === 'evaluate')).toHaveLength(2);
    expect(calls.filter((name) => name === 'click')).toHaveLength(1);
    expect(calls.filter((name) => name === 'screenshot')).toHaveLength(1);
    const clickAt = calls.indexOf('click');
    expect(clickAt).toBeGreaterThanOrEqual(0);
    // ⛔⭐ 순서가 바뀌었다(2026-08-28): click → ***evaluate(location.href)*** → screenshot.
    //    ⚖️ 목적지를 «찍기 전»에 읽는다 — 그 값이 더 싸고 더 빨리 상한다(대상이 부서지면 못 읽는다).
    //    ⛔ 이 줄을 「어느 것이든 상관없다」로 느슨하게 풀지 마라 — 순서가 바뀌면 그것이 «결정»이어야 한다.
    expect(calls.slice(clickAt, clickAt + 3)).toEqual(['click', 'evaluate', 'screenshot']);
    expect(events[0]?.data).toMatchObject({
      postClickLifecycle: 'none',
      postClickLoadWait: 'none',
      captureOutcome: 'ok',
      captureError: null,
      captureTimeoutMs: null,
    });
    expect(openCalls).toBeGreaterThan(0);
    expect(disposeCalls).toBe(openCalls);
  });

  test('a click-induced navigation that never loads still finishes inside the wait budget', async () => {
    // AC3: 이동이 끝나지 않아도 조작 전체는 시한 안에 끝난다 — 매달리지 않는다.
    // 깨는 법: waitForLoad 가 timeoutMs 를 무시하고 영영 기다리면 이 시험이 시간 단언에서 빨강이 된다.
    const closeCalls = { value: 0 };
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const started = Date.now();
    const result = await runArmedAction(
      { url: 'https://example.test', target: 'a', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls, expressions: [], emitLoad: true,
          emitOnClick: [{ name: 'init', loaderId: 'loader-2' }],
        }),
        loadWaitTimeoutMs: 40,
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-hang', path: '/tmp/att-hang.png', filename: 'att-hang.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => events.push({ event, data }),
      },
    );

    expect(result).toEqual({ ok: true, url: 'https://example.test', target: 'a', observed: { coordinates: { x: 120, y: 80 }, captureOutcome: 'ok', clickedHref: null, landedUrl: null, landingVerdict: 'unmeasured' } });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(events[0]?.data).toMatchObject({ postClickLoadWait: 'timeout', postClickLifecycle: 'init' });
    expect(closeCalls.value).toBe(1);
  });

  test('a navigation-wait timeout and a screenshot timeout are different observation values', async () => {
    // AC4: 이동을 기다리다 시한에 걸린 경우와 화면 자체가 시한에 걸린 경우는 관측에서 갈린다.
    // 깨는 법: 둘 다 captureOutcome 으로 뭉치거나 postClickLoadWait 를 안 남기면 두 행이 같아진다.
    const navWait: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction(
      { url: 'https://example.test', target: 'a', armed: true },
      {
        connect: async () => fakeClient({
          closeCalls: { value: 0 }, expressions: [], emitLoad: true,
          emitOnClick: [{ name: 'init', loaderId: 'loader-2' }],
        }),
        loadWaitTimeoutMs: 30,
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-nav-to', path: '/tmp/att-nav-to.png', filename: 'att-nav-to.png', mediaType: 'image/png', size: 3, createdAt: 1 } }),
        observe: (event, data) => navWait.push({ event, data }),
      },
    );

    const shotWait: Array<{ event: string; data: Record<string, unknown> }> = [];
    const hanging = fakeClient({
      closeCalls: { value: 0 }, expressions: [], emitLoad: true,
      emitOnClick: [{ name: 'init', loaderId: 'loader-2' }, { name: 'load', loaderId: 'loader-2' }],
    });
    (hanging as { screenshot: () => Promise<Buffer> }).screenshot = () => new Promise<Buffer>(() => {});
    await runArmedAction(
      { url: 'https://example.test', target: 'a', armed: true },
      {
        connect: async () => hanging,
        loadWaitTimeoutMs: 30,
        captureTimeoutMs: 30,
        observe: (event, data) => shotWait.push({ event, data }),
      },
    );

    expect(navWait[0]?.data.postClickLoadWait).toBe('timeout');
    expect(navWait[0]?.data.captureOutcome).not.toBe('timeout');
    expect(shotWait[0]?.data.captureOutcome).toBe('timeout');
    expect(shotWait[0]?.data.postClickLoadWait).toBe('event');
    expect(`${String(navWait[0]?.data.postClickLoadWait)}/${String(navWait[0]?.data.captureOutcome)}`)
      .not.toBe(`${String(shotWait[0]?.data.postClickLoadWait)}/${String(shotWait[0]?.data.captureOutcome)}`);
  });

  test('unarmed request refuses without connecting or invoking its executor', async () => {
    let connectCalls = 0;
    let executorCalls = 0;
    const result = await runArmedAction(
      { url: 'https://example.test', target: '#save', armed: false },
      {
        connect: async () => {
          connectCalls += 1;
          return fakeClient({ closeCalls: { value: 0 }, expressions: [] });
        },
        execute: async () => { executorCalls += 1; return { x: 1, y: 1 }; },
      },
    );

    expect(result).toEqual({ ok: false, url: 'https://example.test', target: '#save', reason: 'unarmed' });
    expect(connectCalls).toBe(0);
    expect(executorCalls).toBe(0);
  });
});

/**
 * ⛔⭐⭐ 재현(`harness replay`)이 「지금」을 «신원»으로 조인하게 하는 계약.
 *
 * 옛 방식은 조작 «뒤» `monad logs` 를 다시 spawn 해 «가장 최근 행»을 집었다 — 즉 ***시간 근접***이었다.
 * 카나리아는 봇을 «넷» 동시에 몰고, `personaId` 가 null 이면 필터가 «아예 없었다».
 * ⇒ 그래서 조작이 «자기가 본 것»을 직접 돌려준다. 이 시험은 그 값이 «진짜 그 조작의 것»인지를 문다.
 */
describe('performBrowserAction — 결과가 자기가 본 것을 싣는다', () => {
  test('성공하면 좌표와 포착 결과를 «결과에» 싣는다 — 로그를 되읽을 필요가 없다', async () => {
    const result = await runArmedAction(
      { url: 'https://x.test', target: 'a', armed: true },
      { connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        saveAttachment: async () => ({ ok: true, entry: { id: 'att-1', path: '/tmp/att-1.png', filename: 'att-1.png', mediaType: 'image/png', size: 3, createdAt: 1 } }) },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.observed?.coordinates).toEqual({ x: 120, y: 80 });
    expect(result.ok && result.observed?.captureOutcome).toBe('ok');
  });

  test('포착이 «멎어도» 결과는 그 사실을 «이름으로» 싣는다 — 「못 봤다」와 「안 왔다」를 안 뭉친다', async () => {
    const result = await runArmedAction(
      { url: 'https://x.test', target: 'a', armed: true },
      { connect: async () => ({
          ...fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
          screenshot: () => new Promise<Buffer>(() => {}),
        } as unknown as CdpClient),
        captureTimeoutMs: 30, saveAttachment: async () => ({ ok: true, entry: { id: 'att-1', path: '/tmp/att-1.png', filename: 'att-1.png', mediaType: 'image/png', size: 3, createdAt: 1 } }) },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.observed?.captureOutcome).toBe('timeout');
    expect(result.ok && result.observed?.coordinates).toEqual({ x: 120, y: 80 }); // 클릭은 «됐다»
  });

  test('관측 «발신»이 실패해도 그 사실은 돌아온다 — 조인이 스토어에 안 달렸다', async () => {
    const result = await runArmedAction(
      { url: 'https://x.test', target: 'a', armed: true },
      { connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        saveAttachment: async () => { throw new Error('store down'); },
        observe: () => { throw new Error('observe down'); } },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.observed?.coordinates).toEqual({ x: 120, y: 80 });
  });

  test('거부된 조작은 observed 를 «안» 싣는다 — 없는 관측을 있다고 하지 않는다', async () => {
    const result = await performBrowserAction({ url: 'https://x.test', target: 'a', armed: false });
    expect(result.ok).toBe(false);
    expect('observed' in result).toBe(false);
  });
});

/**
 * ⛔⭐⭐ ***되돌릴 수 없는 조작의 최소 요건은 「어디로 갔는지 안다」다.***
 * 📏 2026-08-28 전수: 관측 행의 목적지류 키가 target(선택자)·url(출발지) «둘뿐»이었다 —
 *    봇이 클릭한 «뒤 어디에 있는지»를 아무도 몰랐다. 되돌리기 장치가 없는 축에서 그것은 감사 불가다.
 */
describe('클릭이 «어디로» 갔나', () => {
  const anchor = { url: 'https://x.test', target: 'a', armed: true } as const;

  test('이동 클릭은 「가려던 곳」과 「실제로 간 곳」을 «둘 다» 남긴다', async () => {
    const result = await runArmedAction({ ...anchor },
      { connect: async () => ({
          ...fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
          async evaluate(expression: string) {
            if (expression === 'location.href') return 'https://landed.test/final';
            return { x: 120, y: 80, kind: 'navigation', href: 'https://intended.test/a', text: '기사 제목' };
          },
        } as unknown as CdpClient),
        saveAttachment: async () => ({ ok: true, entry: { id: 'a', path: '/tmp/a.png', filename: 'a.png', mediaType: 'image/png', size: 3, createdAt: 1 } }) },
    );
    expect(result.ok && result.observed?.clickedHref).toBe('https://intended.test/a');
    expect(result.ok && result.observed?.landedUrl).toBe('https://landed.test/final');
  });

  test('둘이 «다를» 수 있다 — 리다이렉트를 「같다」로 접지 않는다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction({ ...anchor },
      { connect: async () => ({
          ...fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
          async evaluate(expression: string) {
            if (expression === 'location.href') return 'https://elsewhere.test/redirected';
            return { x: 1, y: 1, kind: 'navigation', href: 'https://intended.test/a', text: 't' };
          },
        } as unknown as CdpClient),
        observe: (event, data) => events.push({ event, data }) },
    );
    const row = events.at(-1)!.data;
    expect(row.clickedHref).toBe('https://intended.test/a');
    expect(row.landedUrl).toBe('https://elsewhere.test/redirected');
    expect(row.clickedHref).not.toBe(row.landedUrl);
  });

  test('도착지를 «못 읽어도» 조작 판정은 안 바뀐다 — null 은 「못 쟀다」다', async () => {
    const result = await runArmedAction({ ...anchor },
      { connect: async () => ({
          ...fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
          async evaluate(expression: string) {
            if (expression === 'location.href') throw new Error('detached');
            return { x: 1, y: 1, kind: 'navigation', href: 'https://intended.test/a', text: 't' };
          },
        } as unknown as CdpClient) },
    );
    expect(result.ok).toBe(true);                                   // ⛔ 조작은 «됐다»
    expect(result.ok && result.observed?.landedUrl).toBeNull();     // 못 쟀을 뿐이다
    expect(result.ok && result.observed?.clickedHref).toBe('https://intended.test/a');
  });

  test('이동이 «아닌» 클릭은 가려던 곳이 없다 — 「없다」와 「못 쟀다」를 뭉치지 않는다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runArmedAction({ url: 'https://x.test', target: 'h1', armed: true },
      { connect: async () => ({
          ...fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
          async evaluate(expression: string) {
            if (expression === 'location.href') return 'https://x.test/';
            return { x: 1, y: 1, kind: 'other', href: null, text: '제목' };
          },
        } as unknown as CdpClient),
        reversibilityPolicy: 'any',
        observe: (event, data) => events.push({ event, data }) },
    );
    const row = events.at(-1)!.data;
    expect(row.clickedHref).toBeNull();
    expect(row.clickedText).toBe('제목');
    expect(row.landedUrl).toBe('https://x.test/');   // ⇐ 안 움직였다는 «증거»가 남는다
  });

  test('심(deps.execute)으로 오면 «못 잰 것»이다 — 없는 값을 지어내지 않는다', async () => {
    const result = await runArmedAction({ ...anchor },
      { connect: async () => fakeClient({ closeCalls: { value: 0 }, expressions: [], emitLoad: true }),
        execute: async () => ({ x: 5, y: 6 }) },
    );
    expect(result.ok && result.observed?.coordinates).toEqual({ x: 5, y: 6 });
    expect(result.ok && result.observed?.clickedHref).toBeNull();
  });
});
