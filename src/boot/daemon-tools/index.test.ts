import { afterEach, describe, expect, test } from 'bun:test';
import { toolSurface } from './index.js';
import {
  closeBrowserRuntime,
  setBrowserRuntimeDeps,
} from '../../tool-runtime/browser-runtime.js';
import type { CdpClient } from '../../browser-cdp/client.js';

const ctx = () => ({ cwd: process.cwd(), signal: new AbortController().signal });

afterEach(async () => {
  await closeBrowserRuntime();
});

describe('daemon webterm browser runtime surface', () => {
  test('exposes only persistent-browser navigate and read in the default daemon surface', () => {
    const names = toolSurface('webterm').specs.map((spec) => spec.name);

    expect(names).toContain('BrowserNavigate');
    expect(names).toContain('BrowserRead');
    expect(names).not.toContain('BrowserOpen');
    expect(names).not.toContain('BrowserScreenshot');
    expect(names).not.toContain('BrowserClose');
  });

  test('dispatches exposed browser specs without registry registration', async () => {
    let navigatedTo = '';
    let evaluated = '';
    const client = {
      isAlive: true,
      navigate: async (url: string) => { navigatedTo = url; },
      evaluate: async (expression: string) => {
        evaluated = expression;
        if (expression === 'document.title') return 'Example';
        if (expression === 'document.location.href') return 'https://example.test/';
        return 'page text';
      },
      close: async () => {},
    } as unknown as CdpClient;
    setBrowserRuntimeDeps({ getClient: async () => client, closeClient: async () => {} });

    const surface = toolSurface('webterm');
    const navigate = await surface.dispatch('BrowserNavigate', { url: 'https://example.test/' }, ctx());
    const read = await surface.dispatch('BrowserRead', { mode: 'text' }, ctx());

    expect(navigatedTo).toBe('https://example.test/');
    expect(evaluated).toBe('document.body.innerText');
    expect(navigate).toMatchObject({ finalUrl: 'https://example.test/', title: 'Example' });
    expect(read).toMatchObject({ text: 'page text' });
  });
});

// 🆕 2026-09-07 (대표) — 챗 표면이 SelfImplement 를 «본다».
//   ⛔ 이 describe 의 목적은 「라벨을 바꿨나」가 아니라 ***「실제로 흐르나」***다:
//      spec 에 «있고», dispatch 가 그 이름을 «안다», 그리고 안전 장치가 «그대로»다.
describe("toolSurface('chat') — AskUserQuestion 이 열렸다", () => {
  const nameOf = (spec: { name?: string; function?: { name?: string } }) =>
    spec.name ?? spec.function?.name ?? '';

  test('⭐ spec 에 실려 있다 — 자식이 «물을» 도구가 보여야 부른다', () => {
    const names = toolSurface('chat').specs.map(nameOf);
    expect(names.some((n) => n === 'AskUserQuestion' || n === 'ask_user_question')).toBe(true);
  });

  test('⛔ dispatch 가 그 이름을 «모른다»고 던지지 않는다', async () => {
    let message = '';
    try {
      await toolSurface('chat').dispatch('AskUserQuestion', {}, ctx() as never);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain('does not know tool');
  });

  test('🔑 dispatch 가 «sessionId 를 넘긴다» — 없으면 ACP 브릿지가 즉시 죽는다', async () => {
    // ⛔ 이 시험이 이 배선의 «핵심»이다. spec 을 싣고 dispatch 를 이어도
    //    sessionId 를 안 넘기면 브릿지가 AskBridgeUnavailable('no sessionId') 로 죽고,
    //    그러면 이 표면의 사람에게는 물음이 «영영 안 간다» — 그리고 조용하다.
    const seen: (string | undefined)[] = [];
    const { setAskUserQuestionResolver } = await import('../../ask-user-question/index.js');
    setAskUserQuestionResolver(async (_req, c) => {
      seen.push(c?.sessionId);
      return { answers: {}, cancelled: true };
    });
    try {
      await toolSurface('chat').dispatch(
        'AskUserQuestion',
        { questions: [{ id: 'q', header: 'H', question: 'Q?', options: [
          { label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] },
        { ...(ctx() as Record<string, unknown>), sessionId: 'sess-42' } as never,
      );
    } finally {
      setAskUserQuestionResolver(null);
    }
    expect(seen).toEqual(['sess-42']);
  });

  test('⭐ 챗과 tui 가 «같은» AskUserQuestion 을 본다 — 두 표면이 갈리지 않았다', () => {
    const has = (kind: 'chat' | 'webterm') =>
      toolSurface(kind).specs.map(nameOf).filter((n) => n === 'AskUserQuestion' || n === 'ask_user_question');
    // webterm 은 chatSpecs 를 펼치므로 «같아야» 한다 — 다르면 중복이거나 누락이다.
    expect(has('chat')).toEqual(has('webterm'));
    expect(has('chat')).toHaveLength(1);
    expect(has('webterm')).toHaveLength(1);
  });
});

// 🆕 2026-09-08 — webterm 표면이 AskUserQuestion 을 «dispatch» 한다.
//   spec 은 `...chatSpecs` 로 이미 공유된다. 결손은 dispatch 갈래가 chat 쪽에만
//   있던 것 — SelfImplement 가 두 dispatcher 에 각각 갈래를 두는 모양을 따른다.
describe("toolSurface('webterm') — AskUserQuestion 이 흐른다", () => {
  test('⛔ dispatch 가 그 이름을 «모른다»고 던지지 않는다', async () => {
    let message = '';
    try {
      await toolSurface('webterm').dispatch('AskUserQuestion', {}, ctx() as never);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain('does not know tool');
  });

  test('🔑 dispatch 가 «sessionId 를 넘긴다» — 없으면 ACP 브릿지가 즉시 죽는다', async () => {
    const seen: (string | undefined)[] = [];
    const { setAskUserQuestionResolver } = await import('../../ask-user-question/index.js');
    setAskUserQuestionResolver(async (_req, c) => {
      seen.push(c?.sessionId);
      return { answers: {}, cancelled: true };
    });
    try {
      await toolSurface('webterm').dispatch(
        'AskUserQuestion',
        { questions: [{ id: 'q', header: 'H', question: 'Q?', options: [
          { label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] },
        { ...(ctx() as Record<string, unknown>), sessionId: 'sess-webterm-7' } as never,
      );
    } finally {
      setAskUserQuestionResolver(null);
    }
    expect(seen).toEqual(['sess-webterm-7']);
  });
});

describe("toolSurface('chat') — SelfImplement 가 열렸다", () => {
  const nameOf = (spec: { name?: string; function?: { name?: string } }) =>
    spec.name ?? spec.function?.name ?? '';

  test('⭐ spec 에 실려 있다 — 모델이 «볼 수» 있어야 부를 수 있다', () => {
    const names = toolSurface('chat').specs.map(nameOf);
    expect(names.some((n) => n === 'SelfImplement' || n === 'self_implement')).toBe(true);
  });

  test('⛔ dispatch 가 그 이름을 «모른다»고 던지지 않는다 — spec 만 싣고 여기를 빼면 그렇게 된다', async () => {
    // 실제 구현을 돌리지 않고 «표면이 이름을 아는가»만 가른다:
    //   모르면 ToolSafetyError('unavailable') 로 즉시 던진다 — 그 문면이 오면 배선이 끊긴 것이다.
    const surface = toolSurface('chat');
    let message = '';
    try {
      await surface.dispatch('SelfImplement', {}, ctx() as never);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain('does not know tool');
  });

  test('⭐ 챗과 webterm 이 «같은» SelfImplement 를 본다 — 두 표면이 갈리지 않았다', () => {
    const has = (kind: 'chat' | 'webterm') =>
      toolSurface(kind).specs.map(nameOf).filter((n) => n === 'SelfImplement' || n === 'self_implement');
    expect(has('chat')).toEqual(has('webterm'));
  });

  test('⛔ 그렇다고 챗이 webterm 이 «되지는» 않는다 — PTY 툴은 여전히 없다', () => {
    // 대표 이 정의한 호스트 기준이 「PTY 를 쓸 수 있나」다. 그 선을 넘지 않았음을 못 박는다.
    const names = toolSurface('chat').specs.map(nameOf);
    expect(names.some((n) => n.startsWith('WebTerminal'))).toBe(false);
  });
});
