import { afterEach, describe, expect, test } from 'bun:test';

import { WidgetHost } from '../src/widgets/host.js';
import conversationWidget from '../widgets/conversation/widget.js';
import {
  createConversationWidgetLiveBridge,
  refreshConversationWidgetById,
} from '../src/conv-dash/conversation-widget-live.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import { AgentStatusStore } from '../src/agent-status/store.js';

interface ScheduledTimer {
  cb: () => void;
  ms: number;
}

function makeSession(id = 'emb-1'): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'codex' },
    transports: [{ kind: 'pty', id: `pty-${id}` }],
    state() {
      return { status: 'running' as const, title: `codex [${id}]`, startedAt: 1000 };
    },
    async send() {},
    async interrupt() {},
    async snapshot() {
      return `raw snapshot ${id}`;
    },
    async dispose() {},
  };
}

function makeHost() {
  const renderCalls: number[] = [];
  const host = new WidgetHost({
    log: () => {},
    requestRender: () => { renderCalls.push(Date.now()); },
  });
  host.register(conversationWidget);
  return { host, renderCalls };
}

afterEach(() => {
  // no global mutable state
});

describe('conversation widget live bridge', () => {
  test('refreshConversationWidgetById updates widget from observer/status seams', async () => {
    const { host, renderCalls } = makeHost();
    host.spawn({
      type: 'conversation',
      id: 'conv-1',
      config: {
        sessionId: 'emb-1',
        brand: 'codex',
        status: 'pending',
        transports: [{ kind: 'pty', id: 'pty-emb-1' }],
      },
    });
    const statusStore = new AgentStatusStore();
    statusStore.set('emb-1', 'working', 'thinking');

    const refreshed = await refreshConversationWidgetById('conv-1', {
      widgetHost: host,
      listSessions: () => [{ session: makeSession('emb-1') }],
      agentStatusStore: statusStore,
      findObserver: () => ({
        snapshotChannels() {
          return { message: 'hello', reasoning: 'step by step' };
        },
      }) as any,
      requestRender: () => { renderCalls.push(1); },
    });

    expect(refreshed).toBe(true);
    const inst = host.get('conv-1')!;
    const state = inst.state as any;
    expect(state.summary).toContain('running');
    expect(state.lines.some((line: { text: string }) => line.text.includes('hello'))).toBe(true);
    expect(renderCalls.length).toBe(1);
  });

  test('bridge refreshes mounted conversation widgets on poll and status change', async () => {
    const { host, renderCalls } = makeHost();
    const timers: ScheduledTimer[] = [];
    const statusStore = new AgentStatusStore();
    const session = makeSession('emb-2');
    const dispose = createConversationWidgetLiveBridge({
      widgetHost: host,
      listSessions: () => [{ session }],
      agentStatusStore: statusStore,
      findObserver: () => ({
        snapshotChannels() {
          return { message: 'live hello' };
        },
      }) as any,
      requestRender: () => { renderCalls.push(1); },
      schedulePoll: (cb, ms) => {
        timers.push({ cb, ms });
        return timers.length as unknown as ReturnType<typeof setInterval>;
      },
      clearPoll: () => {},
      pollMs: 250,
    });

    host.spawn({
      type: 'conversation',
      id: 'conv-2',
      config: {
        sessionId: 'emb-2',
        brand: 'codex',
        status: 'pending',
        transports: [{ kind: 'pty', id: 'pty-emb-2' }],
      },
    });

    await Promise.resolve();
    const stateAfterMount = host.get('conv-2')!.state as any;
    expect(stateAfterMount.lines.some((line: { text: string }) => line.text.includes('live hello'))).toBe(true);

    statusStore.set('emb-2', 'working', 'streaming');
    await Promise.resolve();
    expect(renderCalls.length).toBeGreaterThan(0);

    timers[0]!.cb();
    await Promise.resolve();
    expect((host.get('conv-2')!.state as any).summary).toContain('running');

    dispose();
  });
});
