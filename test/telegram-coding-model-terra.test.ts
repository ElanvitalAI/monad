// Mission-aware model selection in the telegram brain.
//
// ⭐⭐ POLICY (2026-09-23 rev · 대표) — ***티어로만 고른다.***
//   deep(plan · review) → `best` tier · 그 외(build/quick/research/vision) → `better` tier.
//   실제 모델은 `llm-tier-map` 의 `openai-codex` 사다리가 정한다.
//
// ⛔⭐ ***이 파일의 이름(`…-terra…`)은 «역사»다 — 내용은 terra 를 판정하지 않는다.***
//   2026-07-11 에 세울 땐 정책이 「gpt-5.6-terra 로 내린다」였고 2026-09-23 에 사다리가
//   GPT-6 으로 옮기면서 그 이름이 늙었다. 파일명을 안 바꾼 이유는 ***파일을 «옮기면»
//   파일 단위로 세는 자에게 «신규»로 보여 main 을 막은 전례***가 있어서다(별도 축으로 정리).
//
// ⛔⭐⭐ ***기대값에 모델 이름을 «박지 않는다».*** 사다리에서 파생시킨다 —
//   종전엔 `toBe('gpt-5.6-terra')` 를 일곱 군데 박아 뒀고, 사다리가 «의도대로» 움직이자
//   일곱이 «전부» 깨졌다. 깨진 것은 결함이 아니라 ***자가 오늘의 값을 박고 있었다***는 뜻이다.
//   ⇒ 이 파일이 지키는 «진짜» 계약은 셋이다:
//     ⑴ 비-deep 턴은 `better` 티어로 «간다»   ⑵ deep 턴은 `best` 티어로 «간다»
//     ⑶ 목표가 config 와 «같으면» 모델을 넘기지 않는다(중복 override 없음)
// See telegram-agent.ts · src/llm/route-decision.ts.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTelegramAgentRunTurn } from '../src/telegram-agent';
import { ensureCliSession } from '../src/session/chat';
import { resetGlobalMissionRouter } from '../src/llm/mission-router';
import { tierModel } from '../src/llm/model-defaults';
import type { LLMProvider } from '../src/llm';
import type { UserConfig } from '../src/user-config';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tg-terra-'));
  process.env.XDG_DATA_HOME = root;
  process.env.XDG_STATE_HOME = join(root, '_state');
  process.env.ELANOUS_SESSION_ROOT = join(root, 'sessions');
  resetGlobalMissionRouter();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_STATE_HOME;
  delete process.env.ELANOUS_SESSION_ROOT;
  resetGlobalMissionRouter();
});

function cfg(provider: string, model: string): UserConfig {
  return {
    skillRouter: {
      autoRoute: false, autoRouteCountdownMs: 1000, llmFallback: false,
      keywordScoreThreshold: 2, llmConfidenceThreshold: 0.5,
      autoRouteMinScore: 1, autoRouteRequireAutoTrigger: true,
    },
    llm: { provider, model },
    skills: { activeSet: 'opencode', dirs: [] },
    obsidian: { vault: '/tmp/v' },
    telegram: { enabled: false, allowedUsers: [] },
    onboarding: { completed: true, version: 1 },
    raw: {},
  } as unknown as UserConfig;
}

/** Records the model the provider is asked to stream with. */
function capturingProvider(sink: { model?: string }, defaultModel: string): LLMProvider {
  return {
    name: 'fake', defaultModel, available: () => true,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *chat(_m, _o) { yield 'ok'; },
    async *streamChat(_messages, opts) {
      sink.model = (opts as { model?: string } | undefined)?.model;
      yield { type: 'text', delta: 'done' };
    },
  };
}

async function runOnce(userText: string, config: UserConfig): Promise<string | undefined> {
  return (await runFull(userText, config)).model;
}

/** A provider that yields NO text — simulates a turn aborted mid-run
 *  (the tool loop returns before any final synthesis). */
function silentProvider(): LLMProvider {
  return {
    name: 'fake', defaultModel: 'fake', available: () => true,
    async *chat() { /* no output */ },
    async *streamChat() { /* no output — as if /cancel cut the loop */ },
  };
}

async function runFull(userText: string, config: UserConfig): Promise<{ model?: string; text: string }> {
  const session = ensureCliSession(config);
  const sink: { model?: string } = {};
  // Execution wiring: this test calls makeTelegramAgentRunTurn, whose
  // monad-agent-turn implementation resolves the route before streaming.
  const runTurnImpl = makeTelegramAgentRunTurn(config);
  const result = await runTurnImpl({
    userConfig: config,
    sessionId: session.id,
    userText,
    skipMemoryInjection: true,
    // This deliberately differs from every configured model. streamLLMWithTools
    // materializes it only when monad-agent-turn did not pass an explicit model.
    provider: capturingProvider(sink, 'provider-default'),
  });
  return { model: sink.model, text: result.text };
}

describe('coding turn → «better» tier (codex)', () => {
  // ⛔ 사다리에서 «그때» 읽는다. 여기에 값을 박으면 이 파일이 다시 늙는다.
  const CODING = tierModel('better', 'openai-codex');   // 비-deep 레인
  const DEEP = tierModel('best', 'openai-codex');       // plan · review 레인
  // config 로 줄 「다른 모델」 — 목표와 «달라야» override 가 관측된다.
  const OTHER = tierModel('budget', 'openai-codex');

  test('⛔ 자가 무는 판인가 — 코딩 레인과 config 가 «다른» 값이어야 한다', () => {
    // 이 줄이 없으면 아래 시험들은 「둘이 우연히 같은」 사다리에서도 통과한다.
    expect(CODING).not.toBe(OTHER);
    expect(CODING.length).toBeGreaterThan(0);
  });

  test('a coding request routes to the «better» (coding) tier', async () => {
    const model = await runOnce('add.ts 에 함수 구현하고 실행해줘', cfg('openai-codex', OTHER));
    expect(model).toBe(CODING);
  });

  test('a non-deep request (quick/research) also takes the coding tier', async () => {
    // '오늘 시장 어때?' classifies as quick — NOT plan/review — so the non-deep
    // policy routes it to the coding tier (previously this stayed on the deep one).
    const model = await runOnce('오늘 시장 어때?', cfg('openai-codex', OTHER));
    expect(model).toBe(CODING);
  });

  test('a terminal/REPL-driving request takes the coding tier (the reported gap)', async () => {
    // Terminal/REPL driving classifies as research/quick, not build — a build-only
    // policy would leave it on the slow deep tier. The non-deep default fixes it.
    const model = await runOnce('python REPL 띄워서 2**100 계산해줘', cfg('openai-codex', OTHER));
    expect(model).toBe(CODING);
  });

  test('a deep-reasoning request (plan/review) takes the «best» tier', async () => {
    const model = await runOnce('이 아키텍처 어떻게 설계할지 깊게 계획 세워줘', cfg('openai-codex', OTHER));
    expect(model).toBe(DEEP);
  });

  test('목표가 config 와 «같으면» 모델을 넘기지 않는다 (중복 override 없음)', async () => {
    // target === config means no model crosses the monad-agent-turn →
    // streamLLMWithTools boundary; only the provider default sentinel appears.
    const model = await runOnce('버그 고쳐줘', cfg('openai-codex', CODING));
    expect(model).toBe('provider-default');
  });

  test('non-codex provider is untouched (this lane is codex-only)', async () => {
    const model = await runOnce('add.ts 에 함수 구현해줘', cfg('anthropic', 'claude-opus-4-8'));
    expect(model).toBe('provider-default');
  });

  test('reply carries the self execution footer with the used model', async () => {
    const { text } = await runFull('add.ts 에 함수 구현하고 실행해줘', cfg('openai-codex', OTHER));
    expect(text).toContain(`🧠 elanous · ${CODING}`);
  });
});

describe('/cancel self-awareness', () => {
  test('an aborted turn substitutes a clear cancellation marker (so memory + reply know)', async () => {
    const config = cfg('anthropic', 'claude-opus-4-8'); // non-codex → no model-override noise
    const session = ensureCliSession(config);
    const ac = new AbortController();
    ac.abort(); // pre-aborted — as if /cancel fired mid-run
    const runTurnImpl = makeTelegramAgentRunTurn(config);
    const result = await runTurnImpl({
      userConfig: config,
      sessionId: session.id,
      userText: '3분간 CPU 샘플링해줘',
      skipMemoryInjection: true,
      provider: silentProvider(),
      signal: ac.signal,
    });
    // The reply (and the text recorded to cross-surface memory) states it was cancelled.
    expect(result.text).toContain('취소');
  });

  test('a NON-aborted empty turn is NOT falsely marked cancelled', async () => {
    const config = cfg('anthropic', 'claude-opus-4-8');
    const session = ensureCliSession(config);
    const runTurnImpl = makeTelegramAgentRunTurn(config);
    const result = await runTurnImpl({
      userConfig: config,
      sessionId: session.id,
      userText: 'hi',
      skipMemoryInjection: true,
      provider: silentProvider(),
      // no signal → not aborted
    });
    expect(result.text).not.toContain('취소');
  });
});
