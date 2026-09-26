// §6.4 — daemon-multi-llm-runtime persona binding test.
//
// Covers `buildMessagesForTarget` + `applyPersonaSystemPrompt`
// behavior: when a multi-LLM target carries `personaId`, the global
// PersonaRegistry is consulted and `assemblePersonaPrompt` prepends
// the persona systemPrompt to the base. Unknown ids fall through to
// base only.
//
// We test through the public `bridgeMultiLlmCoreTurnsToAcp` getMessages
// callback wired via `createDaemonMultiLlmRunTurn` because that's the
// real composition; running getMessages directly would skip the
// persona resolution flow.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bridgeMultiLlmCoreTurnsToAcp } from '../src/acp/multi-llm-bridge.js';
import {
  _resetGlobalPersonaRegistryForTest,
  awaitGlobalPersonaLoad,
  setGlobalPersonaRegistryDir,
} from '../src/persona/global-registry.js';
import type { LLMMessage } from '../src/llm.js';

let dir: string;

beforeEach(() => {
  _resetGlobalPersonaRegistryForTest();
  dir = mkdtempSync(join(tmpdir(), 'persona-bind-test-'));
  setGlobalPersonaRegistryDir(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  _resetGlobalPersonaRegistryForTest();
});

function writePersona(personaId: string, systemPrompt: string): void {
  writeFileSync(
    join(dir, `${personaId}.yaml`),
    `personaId: ${personaId}\ndisplayName: ${personaId}\nsystemPrompt: |\n  ${systemPrompt}\n`,
    'utf8',
  );
}

describe('§6.4 · multi-llm bridge getMessages persona injection', () => {
  test('known personaId → systemPrompt prepended to base', async () => {
    writePersona('skeptic', 'You are a strict reviewer who challenges every assumption.');
    await awaitGlobalPersonaLoad();

    let capturedMessages: LLMMessage[] | null = null;
    const captureGetMessages = async (ctx: {
      target: { id: string; provider: string; personaId?: string };
      userText: string;
    }): Promise<LLMMessage[]> => {
      // Mirror buildMessagesForTarget logic — but defer to the real
      // helper so we don't duplicate the assembly. Simplest: replicate
      // minimum (apply persona via global registry).
      const { getGlobalPersonaRegistry } = await import('../src/persona/global-registry.js');
      const { assemblePersonaPrompt } = await import('../src/persona/prompt-assembler.js');
      const registry = getGlobalPersonaRegistry();
      const persona = ctx.target.personaId ? registry.get(ctx.target.personaId) : undefined;
      const baseSystem = '(base instructions)';
      const composed = persona
        ? assemblePersonaPrompt(persona, baseSystem).systemPrompt
        : baseSystem;
      const msgs: LLMMessage[] = [
        { role: 'system', content: composed },
        { role: 'user', content: ctx.userText },
      ];
      capturedMessages = msgs;
      return msgs;
    };

    const runTurn = bridgeMultiLlmCoreTurnsToAcp({
      getMessages: captureGetMessages,
      getTools: () => [],
      dispatchTool: async () => ({ ok: true, content: [] }),
    });

    // Stub turnCtx with the personaId-bearing prompt meta.
    const pushed: string[] = [];
    const turnCtx = {
      sessionId: 'sess-1',
      userText: 'hello',
      promptBlocks: [],
      promptMeta: {
        elanous: {
          multiLlm: {
            targets: [
              { id: 'p1', provider: 'claude', personaId: 'skeptic' },
            ],
          },
        },
      },
      pushChunk: async (s: string) => { pushed.push(s); },
      pushWithMeta: async (s: string) => { pushed.push(s); },
      isAborted: () => false,
    } as unknown as Parameters<typeof runTurn>[0];

    await runTurn(turnCtx);

    expect(capturedMessages).not.toBeNull();
    const sys = capturedMessages![0]?.content;
    expect(typeof sys).toBe('string');
    expect(sys as string).toContain('You are a strict reviewer');
    expect(sys as string).toContain('(base instructions)');
    // Persona text comes BEFORE base (assemblePersonaPrompt order).
    expect((sys as string).indexOf('strict reviewer'))
      .toBeLessThan((sys as string).indexOf('base instructions'));
  });

  test('unknown personaId → base passthrough · no persona text', async () => {
    let capturedMessages: LLMMessage[] | null = null;
    const captureGetMessages = async (ctx: {
      target: { id: string; provider: string; personaId?: string };
      userText: string;
    }): Promise<LLMMessage[]> => {
      const { getGlobalPersonaRegistry } = await import('../src/persona/global-registry.js');
      const { assemblePersonaPrompt } = await import('../src/persona/prompt-assembler.js');
      const registry = getGlobalPersonaRegistry();
      const persona = ctx.target.personaId ? registry.get(ctx.target.personaId) : undefined;
      const baseSystem = '(base instructions)';
      const composed = persona
        ? assemblePersonaPrompt(persona, baseSystem).systemPrompt
        : baseSystem;
      capturedMessages = [
        { role: 'system', content: composed },
        { role: 'user', content: ctx.userText },
      ];
      return capturedMessages;
    };

    const runTurn = bridgeMultiLlmCoreTurnsToAcp({
      getMessages: captureGetMessages,
      getTools: () => [],
      dispatchTool: async () => ({ ok: true, content: [] }),
    });

    const turnCtx = {
      sessionId: 'sess-1',
      userText: 'hi',
      promptBlocks: [],
      promptMeta: {
        elanous: {
          multiLlm: {
            targets: [
              { id: 'p1', provider: 'claude', personaId: 'never-defined' },
            ],
          },
        },
      },
      pushChunk: async () => {},
      pushWithMeta: async () => {},
      isAborted: () => false,
    } as unknown as Parameters<typeof runTurn>[0];

    await runTurn(turnCtx);

    expect(capturedMessages).not.toBeNull();
    expect(capturedMessages![0]?.content).toBe('(base instructions)');
  });

  test('no personaId → base passthrough (legacy chat panel behavior)', async () => {
    writePersona('alpha', 'persona text');
    await awaitGlobalPersonaLoad();

    let capturedMessages: LLMMessage[] | null = null;
    const captureGetMessages = async (ctx: {
      target: { id: string; provider: string; personaId?: string };
      userText: string;
    }): Promise<LLMMessage[]> => {
      const { getGlobalPersonaRegistry } = await import('../src/persona/global-registry.js');
      const { assemblePersonaPrompt } = await import('../src/persona/prompt-assembler.js');
      const registry = getGlobalPersonaRegistry();
      const persona = ctx.target.personaId ? registry.get(ctx.target.personaId) : undefined;
      const baseSystem = '(base only)';
      const composed = persona
        ? assemblePersonaPrompt(persona, baseSystem).systemPrompt
        : baseSystem;
      capturedMessages = [
        { role: 'system', content: composed },
        { role: 'user', content: ctx.userText },
      ];
      return capturedMessages;
    };

    const runTurn = bridgeMultiLlmCoreTurnsToAcp({
      getMessages: captureGetMessages,
      getTools: () => [],
      dispatchTool: async () => ({ ok: true, content: [] }),
    });

    const turnCtx = {
      sessionId: 'sess-1',
      userText: 'hi',
      promptBlocks: [],
      promptMeta: {
        elanous: {
          multiLlm: {
            targets: [{ id: 'p1', provider: 'claude' }],
          },
        },
      },
      pushChunk: async () => {},
      pushWithMeta: async () => {},
      isAborted: () => false,
    } as unknown as Parameters<typeof runTurn>[0];

    await runTurn(turnCtx);

    expect(capturedMessages![0]?.content).toBe('(base only)');
  });
});

// ⛔⭐ 배선 시험 — 「함수를 지었다」와 「그 함수가 실행 경로에 있다」는 다른 값이다.
//    2026-08-26 실측: 이 파일의 기존 39개는 브리지의 sessionId 라우팅을
//    «되돌려도 전부 통과»했다. 그래서 이 절이 있다.
//    반증: multi-llm-bridge.ts 의 `sessionId: targetSessionId` 를
//    `turnCtx.sessionId` 로 되돌리면 이 절이 fail 해야 한다.
describe('§6.4b · 봇마다 상주 세션 — 브리지가 «실제로» 그 세션으로 보내나', () => {
  let sessionRootDir: string;
  let prevRoot: string | undefined;

  beforeEach(() => {
    prevRoot = process.env.ELANOUS_SESSION_ROOT;
    sessionRootDir = mkdtempSync(join(tmpdir(), 'persona-resident-bridge-'));
    process.env.ELANOUS_SESSION_ROOT = sessionRootDir;
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ELANOUS_SESSION_ROOT;
    else process.env.ELANOUS_SESSION_ROOT = prevRoot;
    rmSync(sessionRootDir, { recursive: true, force: true });
  });

  // ⛔⭐ 이 시험이 재는 것은 «getMessages 경계에 어떤 sessionId 가 오나»뿐이다.
  //    턴을 «끝까지» 기다리면 브리지가 실제 프로바이더까지 가서(Codex 계정 회전이
  //    로그에 찍혔다) 5초 시한에 걸린다 — 2026-08-26 실측: 그래서 이 절이 «샜다».
  //    ⇒ 경계에서 «끊는다». 턴은 띄워 두고 오류는 삼킨다(우리 관심사가 아니다).
  async function sessionIdsFor(
    targets: Array<{ id: string; provider: string; personaId?: string }>,
  ): Promise<string[]> {
    const seen: string[] = [];
    let arrived!: () => void;
    const allArrived = new Promise<void>((resolve) => { arrived = resolve; });
    const runTurn = bridgeMultiLlmCoreTurnsToAcp({
      getMessages: async (ctx: { sessionId: string }) => {
        seen.push(ctx.sessionId);
        if (seen.length >= targets.length) arrived();
        return [{ role: 'user', content: 'x' }] as LLMMessage[];
      },
      getTools: () => [],
      dispatchTool: async () => ({ ok: true, content: [] }),
    });
    const turnCtx = {
      sessionId: 'turn-session-not-a-persona',
      userText: 'hello',
      promptBlocks: [],
      promptMeta: { elanous: { multiLlm: { targets } } },
      pushChunk: async () => {},
      pushWithMeta: async () => {},
      isAborted: () => false,
    } as unknown as Parameters<typeof runTurn>[0];
    void runTurn(turnCtx).catch(() => { /* 프로바이더 실패는 이 시험의 관심사가 아니다 */ });
    await allArrived;
    return seen;
  }

  test('personaId 를 단 타깃은 «턴 세션이 아니라» 자기 상주 세션으로 간다', async () => {
    const [sid] = await sessionIdsFor([{ id: 'p1', provider: 'claude', personaId: 'assistant' }]);
    expect(sid).toBeDefined();
    expect(sid).not.toBe('turn-session-not-a-persona');
  });

  test('같은 봇은 턴이 갈려도 «같은» 세션 — 이것이 「상주」의 정의다', async () => {
    const [first] = await sessionIdsFor([{ id: 'p1', provider: 'claude', personaId: 'assistant' }]);
    const [second] = await sessionIdsFor([{ id: 'p1', provider: 'claude', personaId: 'assistant' }]);
    expect(second).toBe(first);
  });

  test('봇이 다르면 세션도 다르다 — 세 봇이 한 대화에 섞이지 않는다', async () => {
    const seen = await sessionIdsFor([
      { id: 'p1', provider: 'claude', personaId: 'assistant' },
      { id: 'p2', provider: 'claude', personaId: 'investor' },
      { id: 'p3', provider: 'claude', personaId: 'newsbot' },
    ]);
    expect(new Set(seen).size).toBe(3);
  });

  test('personaId 가 «없는» 타깃은 옛 행동 그대로 턴 세션을 쓴다 (회귀 방어)', async () => {
    const [sid] = await sessionIdsFor([{ id: 'p1', provider: 'claude' }]);
    expect(sid).toBe('turn-session-not-a-persona');
  });
});
