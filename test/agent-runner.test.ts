// ── Phase B: agent runner tests ──
//
// Covers runAgent + AgentRegistry end-to-end using a fake LLMProvider
// that yields scripted events. No network, no real model.
//
// Event ordering invariant (per run):
//   status:thinking
//   [text | status:tool → tool_call → tool_result → status:thinking]*
//   status:done → done         (on success)
//   status:error → error       (on throw)
//   status:aborted             (on abort — no `error` frame)

import { describe, test, expect } from 'bun:test';
import {
  AgentRegistry, collectAgentText,
} from '../src/agent/registry';
import {
  buildAgentMessages, filterAgentTools,
} from '../src/agent/runner';
import type {
  AgentDefinition, AgentEvent,
} from '../src/agent/types';
import type {
  LLMProvider, LLMStreamEvent, LLMToolSpec,
} from '../src/llm';

// ── Test helpers ──

/** Fake provider scripted with one event array per turn. `chat` delegates
 *  to `streamChat` + text filter, matching the real-provider contract so
 *  streamLLM (used when no tools) also works. */
function fakeProvider(turns: LLMStreamEvent[][]): LLMProvider {
  let call = 0;
  const p: LLMProvider = {
    name: 'fake',
    defaultModel: 'fake-model',
    available: () => true,
    async *streamChat() {
      const events = turns[call++] ?? [];
      for (const ev of events) yield ev;
    },
    async *chat(messages, opts) {
      for await (const ev of p.streamChat!(messages, opts)) {
        if (ev.type === 'text') yield ev.delta;
      }
    },
  };
  return p;
}

/** Provider that hangs until its AbortSignal fires, then throws AbortError.
 *  Both streamChat and chat must hang — streamLLM uses chat when no tools. */
function hangingProvider(): LLMProvider {
  async function hang(opts: { signal?: AbortSignal } | undefined): Promise<never> {
    return new Promise<never>((_resolve, reject) => {
      const sig = opts?.signal;
      const err = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (!sig) return;
      if (sig.aborted) { reject(err()); return; }
      sig.addEventListener('abort', () => reject(err()), { once: true });
    });
  }
  return {
    name: 'hang',
    defaultModel: 'hang',
    available: () => true,
    async *streamChat(_msgs, opts) { await hang(opts); },
    async *chat(_msgs, opts) { await hang(opts); },
  };
}

function simpleDefinition(over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test-agent',
    systemPrompt: 'You are a test agent.',
    ...over,
  };
}

async function collectEvents(gen: AsyncGenerator<AgentEvent, void, unknown>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// ═══════════════════════════════════════════
// 1. buildAgentMessages — parent prefix forwarding
// ═══════════════════════════════════════════

describe('buildAgentMessages', () => {
  test('no prefix: system = definition.systemPrompt verbatim', () => {
    const msgs = buildAgentMessages(simpleDefinition(), 'hi');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are a test agent.' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' });
  });

  test('prefix is joined with blank line so siblings share the cache prefix', () => {
    const msgs = buildAgentMessages(
      simpleDefinition({ systemPrompt: 'persona-A' }),
      'query',
      'PARENT_CONTEXT',
    );
    expect(msgs[0]!.content).toBe('PARENT_CONTEXT\n\npersona-A');
  });
});

// ═══════════════════════════════════════════
// 2. filterAgentTools — allowlist policy
// ═══════════════════════════════════════════

describe('filterAgentTools', () => {
  const hostTools: LLMToolSpec[] = [
    { name: 'alpha', description: '', parameters: {} },
    { name: 'beta',  description: '', parameters: {} },
    { name: 'gamma', description: '', parameters: {} },
  ];

  test('undefined allowlist → no tools (policy: explicit allow)', () => {
    expect(filterAgentTools(hostTools, undefined)).toBeUndefined();
  });

  test('empty allowlist → no tools', () => {
    expect(filterAgentTools(hostTools, [])).toBeUndefined();
  });

  test('specific names → only those exposed', () => {
    const out = filterAgentTools(hostTools, ['alpha', 'gamma']);
    expect(out).toHaveLength(2);
    expect(out!.map(t => t.name)).toEqual(['alpha', 'gamma']);
  });

  test('unknown names dropped silently', () => {
    const out = filterAgentTools(hostTools, ['alpha', 'missing']);
    expect(out).toHaveLength(1);
    expect(out![0]!.name).toBe('alpha');
  });

  test('no overlap → undefined', () => {
    expect(filterAgentTools(hostTools, ['nope'])).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// 3. runAgent — happy path event sequence
// ═══════════════════════════════════════════

describe('runAgent — success path', () => {
  test('text-only response yields status → text deltas → status:done → done', async () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([
      [{ type: 'text', delta: 'Hel' }, { type: 'text', delta: 'lo' }],
    ]);

    const { task, events } = registry.spawn({
      definition: simpleDefinition(),
      prompt: 'greet',
      provider,
    });

    const collected = await collectEvents(events);

    // Event shape (in order)
    expect(collected[0]).toEqual({ type: 'status', stage: 'thinking' });
    expect(collected[1]).toEqual({ type: 'text', delta: 'Hel' });
    expect(collected[2]).toEqual({ type: 'text', delta: 'lo' });
    expect(collected[3]).toEqual({ type: 'status', stage: 'done' });
    expect(collected[4]).toEqual({ type: 'done', text: 'Hello' });

    // Task state
    expect(task.state).toBe('done');
    expect(task.result).toBe('Hello');
    expect(task.startedAt).toBeGreaterThan(0);
    expect(task.finishedAt).toBeGreaterThanOrEqual(task.startedAt!);
  });

  test('tool round emits status:tool → tool_call → tool_result → status:thinking', async () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([
      [
        { type: 'text', delta: 'checking' },
        { type: 'tool_call', id: 'c1', name: 'echo', args: { x: 'hi' } },
      ],
      [{ type: 'text', delta: ' done' }],
    ]);

    const { task, events } = registry.spawn({
      definition: simpleDefinition({ tools: ['echo'] }),
      prompt: 'echo hi',
      tools: [{ name: 'echo', description: '', parameters: {} }],
      dispatchTool: async (_, args) => ({ echoed: (args as any).x }),
      provider,
    });

    const collected = await collectEvents(events);
    const types = collected.map(e => e.type + (e.type === 'status' ? `:${e.stage}` : ''));

    // ⛔⭐ 이 열에 ***빈 델타 `text` 가 «없다»***는 것이 계약이다(2026-08-26).
    //   📏 LLM 층은 툴 라운드마다 `onText('', '')` 를 «지움 표식»으로 낸다(llm.ts:7535 도 그것으로 가른다).
    //      ⛔ 그런데 ***AgentEvent 의 `text` 에는 «지움» 의미가 «없다»*** — 소비자 셋이 전부
    //      무조건 이어붙이기만 한다(skills/tools/agent.ts · subagent-callable.ts · log-adapter.ts).
    //   ⇒ runner 가 그 빈 델타를 «떨군다». 그러지 않으면 툴 라운드마다 ***내용 없는 이벤트***가 흘러
    //     UI 플러시·줄 버퍼·로그가 헛돈다.
    //   ⚠️ 🕳️ 남은 결손(이 시험이 «안» 무는 것): ***「지움」이 agent 스트림에 «전달되지 않는다».***
    //      ⇒ 델타를 이어붙인 라이브 소비자는 `"checking done"` 을 들고 있는데
    //        최종 `task.result` 는 `" done"` 이다. ***둘이 어긋난다.***
    //        📌 AgentEvent 에 «지움» 의미가 생겨야 닫힌다 — 별개 축이다.
    expect(types).toEqual([
      'status:thinking',
      'text',
      'status:tool',
      'tool_call',
      'tool_result',
      'status:thinking',
      'text',
      'status:done',
      'done',
    ]);

    const toolCall = collected.find(e => e.type === 'tool_call')!;
    expect(toolCall).toMatchObject({ id: 'c1', name: 'echo', args: { x: 'hi' } });
    const toolResult = collected.find(e => e.type === 'tool_result')!;
    expect(toolResult).toMatchObject({ id: 'c1', name: 'echo', result: { echoed: 'hi' } });

    expect(task.state).toBe('done');
    // 🪞⭐⭐ 2026-08-26 — 옛 기대는 `'checking done'`(툴 «전» 서술 + 툴 «후» 답)이었다.
    //   📏 실측: `' done'` — ***툴 라운드 «전» 텍스트는 «지워진다».***
    //   📍 기전 = src/llm.ts `finalizeVisibleAssistantText(full, finalTurn, sawToolRound)`
    //             ⇒ `sawToolRound ? finalTurn : full`
    //      ⊕ `clearVisibleAssistantTextForToolRound` 가 라운드마다 `onText('', '')`(=지워라)를 낸다
    //   🔑 ***이름 «둘»이 그 의도를 말한다*** — "visible assistant text" 를 툴 라운드에서 «지운다».
    //      모델이 툴 부르기 «전»에 하는 서술("checking")은 «작업 메모»이고, 사용자에게 보이는 답은
    //      툴 «뒤» 텍스트다. ⇒ 늙은 것은 계약이 아니라 ***이 기대값***이다.
    expect(task.result).toBe(' done');
  });

  test('dispatchTool default throws when agent has no handler', async () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([
      [{ type: 'tool_call', id: 'c1', name: 'missing', args: {} }],
      [{ type: 'text', delta: 'saw the error tool_result' }],
    ]);

    const { events } = registry.spawn({
      definition: simpleDefinition({ tools: ['missing'] }),
      prompt: 'call it',
      tools: [{ name: 'missing', description: '', parameters: {} }],
      // dispatchTool omitted — should throw, and streamLLMWithTools
      // captures the error into the tool_result content.
      provider,
    });

    const collected = await collectEvents(events);
    const toolResult = collected.find(e => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect((toolResult as any).result).toMatchObject({ error: expect.stringContaining('no dispatchTool') });
  });
});

// ═══════════════════════════════════════════
// 4. runAgent — error / abort paths
// ═══════════════════════════════════════════

describe('runAgent — failure paths', () => {
  test('provider throw → error event, task.state = "error"', async () => {
    const registry = new AgentRegistry();
    const provider: LLMProvider = {
      name: 'boom', defaultModel: 'boom', available: () => true,
      async *streamChat() { throw new Error('upstream 500'); },
      async *chat() { throw new Error('upstream 500'); },
    };

    const { task, events } = registry.spawn({
      definition: simpleDefinition(),
      prompt: 'break',
      provider,
    });

    const collected = await collectEvents(events);
    const last = collected[collected.length - 1]!;
    expect(last.type).toBe('error');
    expect((last as any).message).toContain('upstream 500');
    expect(task.state).toBe('error');
    expect(task.error).toContain('upstream 500');
  });

  test('abort before run completes → status:aborted, task.state = "aborted"', async () => {
    const registry = new AgentRegistry();
    const { task, events } = registry.spawn({
      definition: simpleDefinition(),
      prompt: 'hang',
      provider: hangingProvider(),
    });

    // Consume events in the background; abort from the main path.
    const drain = collectEvents(events);
    // Yield so runAgent can register the abort listener first.
    await new Promise(r => setTimeout(r, 10));
    const ok = registry.abort(task.id);
    expect(ok).toBe(true);

    const collected = await drain;
    const last = collected[collected.length - 1]!;
    expect(last).toEqual({ type: 'status', stage: 'aborted' });
    expect(task.state).toBe('aborted');
    expect(task.error).toBeUndefined();
  });

  test('abort on already-finished task returns false (idempotent)', async () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([[{ type: 'text', delta: 'quick' }]]);
    const { task, events } = registry.spawn({
      definition: simpleDefinition(),
      prompt: 'go',
      provider,
    });
    await collectEvents(events);
    expect(task.state).toBe('done');
    expect(registry.abort(task.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════
// 5. collectAgentText — convenience collector
// ═══════════════════════════════════════════

describe('collectAgentText', () => {
  test('returns the final assistant text', async () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([[{ type: 'text', delta: 'partial' }, { type: 'text', delta: ' rest' }]]);
    const { events } = registry.spawn({
      definition: simpleDefinition(),
      prompt: 'x',
      provider,
    });
    const text = await collectAgentText(events);
    expect(text).toBe('partial rest');
  });

  test('throws on error event', async () => {
    const registry = new AgentRegistry();
    const provider: LLMProvider = {
      name: 'x', defaultModel: 'x', available: () => true,
      async *streamChat() { throw new Error('nope'); },
      async *chat() { throw new Error('nope'); },
    };
    const { events } = registry.spawn({
      definition: simpleDefinition(),
      prompt: 'x',
      provider,
    });
    expect(collectAgentText(events)).rejects.toThrow(/nope/);
  });
});

// ═══════════════════════════════════════════
// 6. AgentRegistry lifecycle
// ═══════════════════════════════════════════

describe('AgentRegistry', () => {
  test('spawn creates a unique task id per call', () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([[{ type: 'text', delta: '' }], [{ type: 'text', delta: '' }]]);
    const h1 = registry.spawn({ definition: simpleDefinition(), prompt: 'a', provider });
    const h2 = registry.spawn({ definition: simpleDefinition(), prompt: 'b', provider });
    expect(h1.task.id).not.toBe(h2.task.id);
    expect(registry.size).toBe(2);
  });

  test('list(state) filters by task state', async () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([[{ type: 'text', delta: 'ok' }]]);
    const { events } = registry.spawn({ definition: simpleDefinition(), prompt: 'q', provider });
    await collectEvents(events);
    expect(registry.list('done')).toHaveLength(1);
    expect(registry.list('running')).toHaveLength(0);
  });

  test('abortAll signals every live task', async () => {
    const registry = new AgentRegistry();
    const h1 = registry.spawn({ definition: simpleDefinition(), prompt: 'a', provider: hangingProvider() });
    const h2 = registry.spawn({ definition: simpleDefinition(), prompt: 'b', provider: hangingProvider() });

    // Start draining so the runAgent generators hook up their abort listeners.
    const d1 = collectEvents(h1.events);
    const d2 = collectEvents(h2.events);
    await new Promise(r => setTimeout(r, 10));

    expect(registry.abortAll()).toBe(2);
    await Promise.all([d1, d2]);
    expect(h1.task.state).toBe('aborted');
    expect(h2.task.state).toBe('aborted');
  });

  test('prune drops finished tasks older than threshold', async () => {
    const registry = new AgentRegistry();
    const provider = fakeProvider([[{ type: 'text', delta: 'done' }]]);
    const { task, events } = registry.spawn({ definition: simpleDefinition(), prompt: 'q', provider });
    await collectEvents(events);
    expect(registry.size).toBe(1);

    // Pretend the task finished 10 minutes ago
    task.finishedAt = Date.now() - 10 * 60 * 1000;
    const removed = registry.prune(5 * 60 * 1000);
    expect(removed).toBe(1);
    expect(registry.size).toBe(0);
  });

  test('prune never removes live tasks', async () => {
    const registry = new AgentRegistry();
    const { task } = registry.spawn({ definition: simpleDefinition(), prompt: 'q', provider: hangingProvider() });
    task.state = 'running';   // simulate live
    task.finishedAt = undefined;
    expect(registry.prune(0)).toBe(0);
    registry.abort(task.id);
  });

  test('register creates a task without starting it', () => {
    const registry = new AgentRegistry();
    const task = registry.register(simpleDefinition(), 'pending query');
    expect(task.state).toBe('pending');
    expect(task.startedAt).toBeUndefined();
    expect(registry.get(task.id)).toBe(task);
  });
});
