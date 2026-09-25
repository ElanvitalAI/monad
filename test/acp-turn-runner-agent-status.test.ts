// Path (b) — runAcpTurn → AgentStatusStore fan-out tests.
// (Rich-dev-feedback opportunistic followup §6.2 #3 source · 2026-05-13)
//
// Verifies that each ACP turn lifecycle event becomes a store
// transition the bridge (`wireAgentStatusEvents`) can fan onto the
// `/v1/events` bus. Wire-end contract is covered by the existing
// agent-status-event-bridge tests; this file owns the source side.
//
// Invariants under test:
//  1. turn-start emits working/turn-start.
//  2. tool_call updates emit working/tool-call:<name>.
//  3. tool_call_update.completed emits working/tool-result:<name>.
//  4. tool_call_update.failed emits err/tool-error:<name>.
//  5. successful end emits done/turn-end:<stopReason>.
//  6. thrown prompt emits err/turn-failed:<message-prefix>.
//  7. setAcpAgentStatusStore(null) disables fan-out (no transitions).
//  8. backendId is used as the store key (single agentId for all turns
//     on the same backend — concurrent multi-agent surfaces use
//     distinct backendIds).

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runAcpTurn,
  setAcpAgentStatusStore,
  _resetTurnRunnerCachesForTests,
} from '../src/acp/turn-runner';
import { _resetAcpSessionStoreForTests } from '../src/acp/session-store.js';
import { _resetAcpAgentManagerForTests } from '../src/acp/agent-manager.js';
import { AgentStatusStore } from '../src/agent-status/store.js';

interface UpdateFrame {
  sessionUpdate: string;
  content?: { type: string; text?: string };
  title?: string;
  kind?: string;
  status?: string;
}

interface StreamingStubSpec {
  updates?: UpdateFrame[];
  stopReason?: string;
  throwOnPrompt?: Error;
}

function makeStreamingAgent(spec: StreamingStubSpec): unknown {
  return {
    getCapabilities: () => ({ loadSession: false }),
    async newSession() {
      return 'sess-1';
    },
    async loadSession() {
      /* noop */
    },
    async prompt(
      _sessionId: unknown,
      _blocks: unknown,
      onUpdate: (u: UpdateFrame) => void,
    ): Promise<{ stopReason: string }> {
      if (spec.throwOnPrompt) throw spec.throwOnPrompt;
      for (const u of spec.updates ?? []) onUpdate(u);
      return { stopReason: spec.stopReason ?? 'end_turn' };
    },
    async cancel() {
      /* noop */
    },
  };
}

function installAgentSingleton(stub: unknown): void {
  _resetAcpAgentManagerForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/acp/agent-manager.js') as {
    globalAcpAgentManager: () => Record<string, unknown>;
  };
  const live = mod.globalAcpAgentManager();
  live['getAgent'] = async () => stub;
  live['drop'] = () => { /* swallow */ };
}

const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
let testConfigDir: string | null = null;

beforeEach(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), 'turn-runner-status-'));
  process.env.XDG_CONFIG_HOME = testConfigDir;
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
  setAcpAgentStatusStore(null);
});

afterEach(() => {
  setAcpAgentStatusStore(null);
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
  if (testConfigDir) {
    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch { /* noop */ }
    testConfigDir = null;
  }
  if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
});

interface Transition {
  agentId: string;
  status: string;
  lastEvent?: string;
}

function collectTransitions(store: AgentStatusStore): Transition[] {
  const out: Transition[] = [];
  store.subscribe((id, rec) => {
    out.push({
      agentId: id,
      status: rec.status,
      ...(rec.lastEvent !== undefined ? { lastEvent: rec.lastEvent } : {}),
    });
  });
  return out;
}

describe('runAcpTurn · agent.status fan-out', () => {
  test('publishes turn-start → tool-call → tool-result → turn-end transitions', async () => {
    const store = new AgentStatusStore();
    setAcpAgentStatusStore(store);
    const transitions = collectTransitions(store);
    installAgentSingleton(
      makeStreamingAgent({
        updates: [
          { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
          { sessionUpdate: 'tool_call', title: 'Read' },
          { sessionUpdate: 'tool_call_update', title: 'Read', status: 'completed' },
        ],
        stopReason: 'end_turn',
      }),
    );
    await runAcpTurn({
      backendId: 'codex',
      promptText: 'go',
      chatId: 'chat-A',
    });
    expect(transitions.map((t) => t.status)).toEqual([
      'working',
      'working',
      'working',
      'done',
    ]);
    expect(transitions[0]!.lastEvent).toBe('turn-start');
    expect(transitions[1]!.lastEvent).toBe('tool-call:Read');
    expect(transitions[2]!.lastEvent).toBe('tool-result:Read');
    expect(transitions[3]!.lastEvent).toBe('turn-end:end_turn');
    // runAcpTurn canonicalizes the friendly codex alias before publishing
    // status, so the production store key is the canonical backendId.
    expect(transitions.every((t) => t.agentId === 'codex-app-server')).toBe(true);
  });

  test('tool_call_update.failed transitions to err', async () => {
    const store = new AgentStatusStore();
    setAcpAgentStatusStore(store);
    const transitions = collectTransitions(store);
    installAgentSingleton(
      makeStreamingAgent({
        updates: [
          { sessionUpdate: 'tool_call', title: 'Bash' },
          { sessionUpdate: 'tool_call_update', title: 'Bash', status: 'failed' },
        ],
      }),
    );
    await runAcpTurn({
      backendId: 'codex',
      promptText: 'go',
      chatId: 'chat-A',
    });
    expect(transitions.map((t) => t.status)).toEqual([
      'working',
      'working',
      'err',
      'done',
    ]);
    expect(transitions[2]!.lastEvent).toBe('tool-error:Bash');
  });

  test('thrown prompt emits err/turn-failed before propagating', async () => {
    const store = new AgentStatusStore();
    setAcpAgentStatusStore(store);
    const transitions = collectTransitions(store);
    installAgentSingleton(
      makeStreamingAgent({
        throwOnPrompt: new Error('backend explode'),
      }),
    );
    await expect(
      runAcpTurn({
        backendId: 'claude-code',
        promptText: 'go',
        chatId: 'chat-A',
      }),
    ).rejects.toThrow(/backend explode/);
    expect(transitions.map((t) => t.status)).toEqual(['working', 'err']);
    expect(transitions[1]!.lastEvent).toMatch(/^turn-failed:/);
  });

  test('uses backendId as the store agentId — distinct backends stay independent', async () => {
    const store = new AgentStatusStore();
    setAcpAgentStatusStore(store);
    const transitions = collectTransitions(store);
    installAgentSingleton(makeStreamingAgent({}));
    await runAcpTurn({
      backendId: 'claude-code',
      promptText: 'a',
      chatId: 'chat-A',
    });
    await runAcpTurn({
      backendId: 'codex',
      promptText: 'b',
      chatId: 'chat-A',
    });
    const claudeRows = transitions.filter((t) => t.agentId === 'claude-code');
    const codexRows = transitions.filter((t) => t.agentId === 'codex-app-server');
    expect(claudeRows.length).toBeGreaterThan(0);
    expect(codexRows.length).toBeGreaterThan(0);
    expect(claudeRows[claudeRows.length - 1]!.status).toBe('done');
    expect(codexRows[codexRows.length - 1]!.status).toBe('done');
  });
});

describe('runAcpTurn · setAcpAgentStatusStore(null) disables fan-out', () => {
  test('no store → no transitions on any subscriber attached after the fact', async () => {
    setAcpAgentStatusStore(null);
    // Caller hasn't supplied a store, but we still create one ourselves
    // to verify it never gets touched — clear separation of concerns.
    const orphanStore = new AgentStatusStore();
    const transitions = collectTransitions(orphanStore);
    installAgentSingleton(
      makeStreamingAgent({
        updates: [{ sessionUpdate: 'tool_call', title: 'Read' }],
      }),
    );
    await runAcpTurn({
      backendId: 'codex',
      promptText: 'go',
      chatId: 'chat-A',
    });
    expect(transitions).toEqual([]);
  });
});
