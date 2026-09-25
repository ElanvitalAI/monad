// Cross-message reflection — buildRecentToolObservations + its wiring into
// runTurn. `role:'tool'` rows are excluded from raw replay (toLLM), so without
// this a follow-up turn can't see what the PREVIOUS turn's tools returned
// (e.g. a build error to correct). This surfaces ONLY the most recent turn's
// tool observations as a bounded digest folded into the system prompt.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRecentToolObservations, buildToolTraceMessage, ensureCliSession, runTurn,
} from '../src/session/chat';
import { appendMessage } from '../src/session/index';
import type { SerializedMessage } from '../src/session/index';
import type { LLMProvider } from '../src/llm';
import type { UserConfig } from '../src/user-config';

function msg(role: SerializedMessage['role'], content: string): SerializedMessage {
  return { role, content, ts: new Date().toISOString() };
}

describe('buildRecentToolObservations (pure)', () => {
  test('null when there are no tool rows', () => {
    expect(buildRecentToolObservations([msg('user', 'hi'), msg('assistant', 'yo')])).toBeNull();
  });

  test('null when the last tool rows belong to an OLDER turn (before last user)', () => {
    const messages: SerializedMessage[] = [
      msg('user', 'q1'),
      buildToolTraceMessage('Bash', { command: 'ls' }, 'a.txt'),
      msg('assistant', 'a1'),
      msg('user', 'q2'),           // most recent user — nothing after it
      msg('assistant', 'a2'),
    ];
    // No tool rows after the last user → nothing to surface this turn.
    expect(buildRecentToolObservations(messages)).toBeNull();
  });

  test('surfaces ONLY the most recent turn tool rows, with an arg hint', () => {
    const messages: SerializedMessage[] = [
      msg('user', 'old q'),
      buildToolTraceMessage('Bash', { command: 'echo OLD' }, 'OLD-OUTPUT'),
      msg('assistant', 'old a'),
      msg('user', 'run the build'),
      buildToolTraceMessage('Bash', { command: 'bun test' }, '[exit 1] 2 failed FAIL src/x.test.ts'),
      buildToolTraceMessage('Edit', { file_path: 'src/x.ts' }, 'ok'),
      // assistant not yet appended — mirrors history before a follow-up turn.
    ];
    const out = buildRecentToolObservations(messages)!;
    expect(out).not.toBeNull();
    expect(out).toContain('직전 턴');
    expect(out).toContain('Bash · bun test');
    expect(out).toContain('[exit 1] 2 failed');
    expect(out).toContain('Edit · src/x.ts');
    // The OLDER turn's tool output must NOT leak in.
    expect(out).not.toContain('OLD-OUTPUT');
    expect(out).not.toContain('echo OLD');
  });

  test('bounds: caps row count, per-row length, and total length', () => {
    const rows: SerializedMessage[] = [msg('user', 'q')];
    for (let i = 0; i < 20; i++) {
      rows.push(buildToolTraceMessage('Bash', { command: `c${i}` }, 'X'.repeat(5000)));
    }
    const out = buildRecentToolObservations(rows, { maxRows: 3, perRowChars: 50, totalChars: 200 })!;
    expect(out.length).toBeLessThanOrEqual(200 + 100); // body ≤200 + header
    // only the LAST 3 commands survive the maxRows cap
    expect(out).toContain('c19');
    expect(out).not.toContain('c0 ');
    // per-row truncation: no single 5000-char blob
    expect(out).not.toContain('X'.repeat(60));
  });
});

// ── Integration: the digest actually reaches the LLM wire ──

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-reflect-'));
  process.env.XDG_DATA_HOME = root;
  process.env.XDG_STATE_HOME = join(root, '_state');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_STATE_HOME;
});

function baseConfig(): UserConfig {
  return {
    skillRouter: {
      autoRoute: false, autoRouteCountdownMs: 1000, llmFallback: false,
      keywordScoreThreshold: 2, llmConfidenceThreshold: 0.5,
      autoRouteMinScore: 1, autoRouteRequireAutoTrigger: true,
    },
    llm: { provider: 'auto' },
    skills: { activeSet: 'opencode', dirs: [] },
    obsidian: { vault: '/tmp/v' },
    telegram: { enabled: false, allowedUsers: [] },
    onboarding: { completed: true, version: 1 },
    raw: {},
  } as unknown as UserConfig;
}

/** Provider that records the system message it received. */
function capturingProvider(sink: { system?: string }): LLMProvider {
  return {
    name: 'fake', defaultModel: 'fake-model', available: () => true,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *chat(_m, _o) { yield 'ok'; },
    async *streamChat(messages, _o) {
      const sys = messages.find(m => m.role === 'system');
      sink.system = typeof sys?.content === 'string' ? sys.content : undefined;
      yield { type: 'text', delta: 'ok' };
    },
  };
}

describe('runTurn wires recent tool observations into the system prompt', () => {
  test('a follow-up turn sees the previous turn tool result', async () => {
    const cfg = baseConfig();
    const session = ensureCliSession(cfg);
    // Simulate a completed prior turn that ran a tool.
    appendMessage(session.id, msg('user', 'run the build'));
    appendMessage(session.id, buildToolTraceMessage('Bash', { command: 'bun test' }, '[exit 1] FAIL src/pay.test.ts: expected 200'));
    appendMessage(session.id, msg('assistant', '빌드에 실패가 있었습니다.'));

    const sink: { system?: string } = {};
    await runTurn({
      userConfig: cfg,
      sessionId: session.id,
      userText: '고쳐줘',
      systemPrompt: 'BASE',
      skipMemoryInjection: true,
      provider: capturingProvider(sink),
    });

    expect(sink.system).toBeDefined();
    expect(sink.system).toContain('BASE');
    expect(sink.system).toContain('직전 턴');
    expect(sink.system).toContain('FAIL src/pay.test.ts');
  });

  test('no digest when the prior turn used no tools', async () => {
    const cfg = baseConfig();
    const session = ensureCliSession(cfg);
    appendMessage(session.id, msg('user', 'hi'));
    appendMessage(session.id, msg('assistant', 'hello'));

    const sink: { system?: string } = {};
    await runTurn({
      userConfig: cfg,
      sessionId: session.id,
      userText: 'again',
      systemPrompt: 'BASE',
      skipMemoryInjection: true,
      provider: capturingProvider(sink),
    });
    expect(sink.system).toBe('BASE');
  });
});
