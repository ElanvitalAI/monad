// M4a — Discord flavor of the monad self turn.
//
// makeDiscordAgentRunTurn shares the full assembly with telegram via
// makeMonadAgentRunTurn (see telegram-coding-model-terra.test.ts for
// the shared behaviors: terra routing, cancel marker, footer). Here we
// lock the flavor delta: the cross-surface memory record carries
// surface='discord', and the footer still lands.

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDiscordAgentRunTurn } from '../src/discord-agent';
import { ensureCliSession } from '../src/session/chat';
import { resetGlobalMissionRouter } from '../src/llm/mission-router';
import * as surfaceEvents from '../src/domains/surface-events';
import type { LLMProvider } from '../src/llm';
import type { UserConfig } from '../src/user-config';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dc-agent-'));
  process.env.XDG_DATA_HOME = root;
  process.env.XDG_STATE_HOME = join(root, '_state');
  process.env.MONAD_SESSION_ROOT = join(root, 'sessions');
  resetGlobalMissionRouter();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_STATE_HOME;
  delete process.env.MONAD_SESSION_ROOT;
  resetGlobalMissionRouter();
  mock.restore();
});

function cfg(): UserConfig {
  return {
    skillRouter: {
      autoRoute: false, autoRouteCountdownMs: 1000, llmFallback: false,
      keywordScoreThreshold: 2, llmConfidenceThreshold: 0.5,
      autoRouteMinScore: 1, autoRouteRequireAutoTrigger: true,
    },
    llm: { provider: 'grok', model: 'grok-4' },
    skills: { activeSet: 'opencode', dirs: [] },
    obsidian: { vault: '/tmp/v' },
    telegram: { enabled: false, allowedUsers: [] },
    discord: { enabled: false, allowedUsers: [] },
    onboarding: { completed: true, version: 1 },
    raw: {},
  } as unknown as UserConfig;
}

function stubProvider(): LLMProvider {
  return {
    name: 'fake', defaultModel: 'fake', available: () => true,
    async *chat() { yield 'ok'; },
    async *streamChat() { yield { type: 'text', delta: 'discord says hi' }; },
  };
}

describe('makeDiscordAgentRunTurn', () => {
  test("records the turn to cross-surface memory with surface='discord' + appends footer", async () => {
    const recorded: Array<{ surface: string; userText: string }> = [];
    spyOn(surfaceEvents, 'recordInboundTurn').mockImplementation(((opts: { surface: string; userText: string }) => {
      recorded.push({ surface: opts.surface, userText: opts.userText });
      return null;
    }) as typeof surfaceEvents.recordInboundTurn);

    const config = cfg();
    const session = ensureCliSession(config);
    const runTurnImpl = makeDiscordAgentRunTurn(config);
    const result = await runTurnImpl({
      userConfig: config,
      sessionId: session.id,
      userText: '안녕',
      skipMemoryInjection: true,
      provider: stubProvider(),
    });

    expect(recorded).toEqual([{ surface: 'discord', userText: '안녕' }]);
    expect(result.text).toContain('discord says hi');
    expect(result.text).toContain('🧠 monad'); // execution footer (self path)
  });
});
