// P1.4 · Channel file spill — the sink half of the relay overflow seam.
//
// The relay formatter already emits an `overflow` payload (the FULL
// untruncated tool body) when a tool update exceeds the inline cap. These
// tests pin that BOTH delegate paths now spill it as a file attachment
// instead of dropping it:
//   • slash `/cc` (turn-runner) → AcpStreamer.sendFile
//   • NL delegate_code_agent    → DaemonToolDispatchCtx.surfaceFileSink
// plus the Telegram sink itself (sendDocument multipart + fileSinkForChat).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderToolUpdate,
  RELAY_INLINE_CAP,
  DELEGATE_AGGREGATE_CAP,
  type RelayToolUpdate,
} from '../src/channel/agent-event-relay';
import { TelegramBot } from '../src/telegram';
import type { FileSink } from '../src/channel/file-sink';
import { spillFileName } from '../src/channel/file-sink';
import {
  runAcpTurn,
  _resetTurnRunnerCachesForTests,
  type AcpStreamer,
} from '../src/acp/turn-runner';
import { _resetAcpSessionStoreForTests } from '../src/acp/session-store.js';
import { _resetAcpAgentManagerForTests } from '../src/acp/agent-manager.js';
import {
  dispatchDelegateAgent,
} from '../src/boot/daemon-tools/delegate-agent';
import { __setDualRoleManagerForTest, type DualRoleManager } from '../src/acp/dual-role-manager';

const FAST_TG_OPTS = { errorBackoffMs: 0, pollTimeoutSec: 0, perChatGapMs: 0, streamEditGapMs: 0 } as const;

// ── 1. relay formatter — overflow carries a title for the caption ─────
describe('renderToolUpdate · overflow payload', () => {
  test('overflow includes body + ext + title when output exceeds the inline cap', () => {
    const big = 'x'.repeat(RELAY_INLINE_CAP + 500);
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update', title: 'Bash', kind: 'execute',
      status: 'completed', rawOutput: big,
    };
    const r = renderToolUpdate(u);
    expect(r!.overflow).toBeDefined();
    expect(r!.overflow!.body.length).toBe(big.length);
    expect(r!.overflow!.ext).toBe('txt');
    expect(r!.overflow!.title).toBe('Bash');
  });

  test('a diff body spills with ext=diff', () => {
    const diff = '--- a\n+++ b\n' + '+line\n'.repeat(500);
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update', title: 'Edit', kind: 'edit',
      status: 'completed', rawOutput: diff,
    };
    const r = renderToolUpdate(u, { maxInline: 100 });
    expect(r!.overflow!.ext).toBe('diff');
  });
});

// ── 2. Telegram sendDocument — multipart upload ───────────────────────
describe('TelegramBot.sendDocument', () => {
  test('POSTs multipart to /sendDocument with chat, filename, caption', async () => {
    let captured: { url: string; chatId: string; filename: string; caption: string; bytes: number } | null = null;
    const fetchImpl: any = async (url: string, init: any) => {
      const form = init.body as FormData;
      const doc = form.get('document') as File;
      captured = {
        url,
        chatId: String(form.get('chat_id')),
        filename: doc.name,
        caption: String(form.get('caption') ?? ''),
        bytes: doc.size,
      };
      return { json: async () => ({ ok: true, result: { message_id: 99 } }) };
    };
    const bot = new TelegramBot({ token: 't', allowedUsers: [], onMessage: async () => undefined, fetchImpl, ...FAST_TG_OPTS });
    const res = await bot.sendDocument(555, 'hello body', 'tool-output.txt', { caption: 'Bash · 10 chars', threadId: 7 });

    expect(res).toEqual({ messageId: 99 });
    expect(captured!.url).toEndWith('/sendDocument');
    expect(captured!.chatId).toBe('555');
    expect(captured!.filename).toBe('tool-output.txt');
    expect(captured!.caption).toBe('Bash · 10 chars');
    expect(captured!.bytes).toBeGreaterThan(0);
  });

  test('returns undefined on API error (never throws into a turn)', async () => {
    const fetchImpl: any = async () => ({ json: async () => ({ ok: false, description: 'file too big' }) });
    const bot = new TelegramBot({ token: 't', allowedUsers: [], onMessage: async () => undefined, fetchImpl, ...FAST_TG_OPTS });
    const res = await bot.sendDocument(1, 'x', 'a.txt');
    expect(res).toBeUndefined();
  });

  test('returns undefined on network throw', async () => {
    const fetchImpl: any = async () => { throw new Error('ECONNRESET'); };
    const bot = new TelegramBot({ token: 't', allowedUsers: [], onMessage: async () => undefined, fetchImpl, ...FAST_TG_OPTS });
    const res = await bot.sendDocument(1, 'x', 'a.txt');
    expect(res).toBeUndefined();
  });
});

// ── 3. fileSinkForChat — fire-and-forget FileSink over sendDocument ────
describe('TelegramBot.fileSinkForChat', () => {
  test('sendFile schedules a sendDocument into the bound chat with ext→filename', async () => {
    const calls: Array<{ chatId: string; filename: string; threadId: string | null }> = [];
    const fetchImpl: any = async (_url: string, init: any) => {
      const form = init.body as FormData;
      calls.push({
        chatId: String(form.get('chat_id')),
        filename: (form.get('document') as File).name,
        threadId: form.get('message_thread_id') as string | null,
      });
      return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };
    const bot = new TelegramBot({ token: 't', allowedUsers: [], onMessage: async () => undefined, fetchImpl, ...FAST_TG_OPTS });
    const sink = bot.fileSinkForChat(321, 8);
    sink.sendFile('a big diff', { ext: 'diff', caption: 'Edit · 9 chars' });
    // fire-and-forget — let the scheduled send flush.
    await new Promise((r) => setTimeout(r, 10));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.chatId).toBe('321');
    expect(calls[0]!.filename).toBe('tool-output.diff');
    expect(calls[0]!.threadId).toBe('8');
  });

  test('name override → identifiable filename (not generic tool-output)', async () => {
    const calls: Array<{ filename: string }> = [];
    const fetchImpl: any = async (_url: string, init: any) => {
      const form = init.body as FormData;
      calls.push({ filename: (form.get('document') as File).name });
      return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };
    const bot = new TelegramBot({ token: 't', allowedUsers: [], onMessage: async () => undefined, fetchImpl, ...FAST_TG_OPTS });
    const sink = bot.fileSinkForChat(321);
    sink.sendFile('a big diff', { ext: 'diff', name: spillFileName('Edit(src/foo.ts)', 'diff') });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0]!.filename).toBe('Edit-src-foo.ts.diff');
  });
});

describe('spillFileName — 식별 가능한 spill 파일명', () => {
  test('툴+경로 identity 보존(비영숫자→대시)', () => {
    expect(spillFileName('Edit(src/foo.ts)', 'diff')).toBe('Edit-src-foo.ts.diff');
    expect(spillFileName('Bash: git diff', 'txt')).toBe('Bash-git-diff.txt');
    expect(spillFileName('Write /path/x.py', 'diff')).toBe('Write-path-x.py.diff');
  });
  test('ext 정규화(diff|txt) · 빈/무효 title 폴백', () => {
    expect(spillFileName('Read', 'weird')).toBe('Read.txt');   // 알 수 없는 ext → txt
    expect(spillFileName('', 'diff')).toBe('tool-output.diff'); // 빈 → 폴백
    expect(spillFileName('()', 'txt')).toBe('tool-output.txt'); // 무효문자만 → 폴백
    expect(spillFileName(undefined, 'txt')).toBe('tool-output.txt');
  });
  test('60자 캡 · leading/trailing 대시·닷 트림', () => {
    const long = spillFileName('x'.repeat(120), 'txt');
    expect(long.length).toBeLessThanOrEqual(64); // 60 + '.txt'
    expect(spillFileName('...Edit...', 'diff')).toBe('Edit.diff');
  });
});

// ── 4. slash `/cc` (turn-runner) — overflow spills via AcpStreamer ────
/** Stub the agent-manager so getAgent returns an ephemeral agent whose
 *  prompt() drives the caller's onUpdate with a scripted stream. */
function installStreamingStubAgent(updates: unknown[]): void {
  _resetAcpAgentManagerForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/acp/agent-manager.js') as { globalAcpAgentManager: () => Record<string, unknown> };
  const live = mod.globalAcpAgentManager();
  const stub = {
    getCapabilities: () => ({ loadSession: false }),
    newSession: async () => 'sess-spill',
    loadSession: async () => { /* unused */ },
    async prompt(_sid: unknown, _prompt: unknown, onUpdate: (u: unknown) => void) {
      for (const u of updates) onUpdate(u);
      return { stopReason: 'end_turn' };
    },
    cancel: async () => { /* noop */ },
  };
  live['getAgent'] = async () => stub as unknown;
  live['drop'] = () => { /* noop */ };
}

describe('runAcpTurn · slash path file spill', () => {
  const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
  let dir: string | null = null;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spill-turn-'));
    process.env.XDG_CONFIG_HOME = dir;
    _resetTurnRunnerCachesForTests();
    _resetAcpSessionStoreForTests();
  });
  afterEach(() => {
    _resetTurnRunnerCachesForTests();
    _resetAcpSessionStoreForTests();
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } dir = null; }
    if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
  });

  test('an overflowing tool_call_update spills the full body via streamer.sendFile', async () => {
    const big = 'y'.repeat(RELAY_INLINE_CAP + 2000);
    installStreamingStubAgent([
      { sessionUpdate: 'tool_call', title: 'Bash', kind: 'execute', rawInput: { command: 'npm test' } },
      { sessionUpdate: 'tool_call_update', title: 'Bash', kind: 'execute', status: 'completed', rawOutput: big },
    ]);
    const spilled: Array<{ body: string; ext: string; caption?: string }> = [];
    const streamer: AcpStreamer = {
      edit: () => { /* noop */ },
      sendFile: (body, o) => { spilled.push({ body, ...o }); },
    };
    const r = await runAcpTurn({ backendId: 'claude', promptText: 'go', chatId: 1, streamer });

    expect(r.stopReason).toBe('end_turn');
    expect(spilled).toHaveLength(1);
    expect(spilled[0]!.body.length).toBe(big.length);
    expect(spilled[0]!.ext).toBe('txt');
    expect(spilled[0]!.caption).toContain('Bash');
  });

  test('no spill when output fits inline', async () => {
    installStreamingStubAgent([
      { sessionUpdate: 'tool_call_update', title: 'Bash', kind: 'execute', status: 'completed', rawOutput: 'small' },
    ]);
    const spilled: unknown[] = [];
    const streamer: AcpStreamer = { edit: () => {}, sendFile: (b, o) => spilled.push({ b, o }) };
    await runAcpTurn({ backendId: 'claude', promptText: 'go', chatId: 1, streamer });
    expect(spilled).toHaveLength(0);
  });
});

// ── 5. NL delegate_code_agent — overflow spills via surfaceFileSink ───
function installDrmWithUpdates(updates: unknown[]): void {
  const fake = {
    async clientSessionCreate() { return { id: 'sub-1' }; },
    async clientSessionSetGoal() { return null; },
    async clientSessionGetGoal() { return null; },
    async clientSessionSend(opts: { onUpdate?: (u: unknown) => void }) {
      for (const u of updates) opts.onUpdate?.(u);
      return { stopReason: 'end_turn' };
    },
  };
  __setDualRoleManagerForTest(fake as unknown as DualRoleManager);
}

describe('dispatchDelegateAgent · NL path file spill', () => {
  afterEach(() => { __setDualRoleManagerForTest(null); });

  test('overflowing tool output spills via surfaceFileSink and clips the LLM result', async () => {
    const big = 'z'.repeat(DELEGATE_AGGREGATE_CAP + 5000);
    installDrmWithUpdates([
      { sessionUpdate: 'tool_call_update', title: 'Bash', kind: 'execute', status: 'completed', rawOutput: big },
    ]);
    const spilled: Array<{ body: string; ext: string }> = [];
    const sink: FileSink = { sendFile: (body, o) => spilled.push({ body, ext: o.ext }) };
    const res = await dispatchDelegateAgent(
      { backend: 'claude', task: 'run it' },
      { cwd: process.cwd(), signal: new AbortController().signal, surfaceFileSink: sink },
    ) as { output: string; truncated: boolean };

    // the full body reached the chat as a file…
    expect(spilled).toHaveLength(1);
    expect(spilled[0]!.body.length).toBe(big.length);
    // …while the LLM tool-result kept only the truncated inline head
    // (per-message inline cap), never the whole body — the point of the
    // spill is that the full content lives in the file, not the context.
    expect(res.output).toContain('truncated');
    expect(res.output.length).toBeLessThan(big.length);
  });

  test('aggregate cap clips the LLM tool-result when many updates pile up', async () => {
    // Each update renders a ~small inline snippet; enough of them exceed
    // the aggregate cap, which bounds only what the orchestrating LLM
    // re-reads (the chat already saw each one live).
    const updates = Array.from({ length: 40 }, (_, i) => ({
      sessionUpdate: 'tool_call_update', title: `Bash${i}`, kind: 'execute',
      status: 'completed', rawOutput: 'line '.repeat(80),
    }));
    installDrmWithUpdates(updates);
    const res = await dispatchDelegateAgent(
      { backend: 'claude', task: 'run it' },
      { cwd: process.cwd(), signal: new AbortController().signal },
    ) as { output: string; truncated: boolean };
    expect(res.output.length).toBe(DELEGATE_AGGREGATE_CAP);
    expect(res.truncated).toBe(true);
  });

  test('no surfaceFileSink ⇒ still succeeds, just no spill (graceful)', async () => {
    installDrmWithUpdates([
      { sessionUpdate: 'tool_call_update', title: 'Bash', kind: 'execute', status: 'completed', rawOutput: 'x'.repeat(RELAY_INLINE_CAP + 100) },
    ]);
    const res = await dispatchDelegateAgent(
      { backend: 'claude', task: 'run it' },
      { cwd: process.cwd(), signal: new AbortController().signal },
    ) as { output: string };
    expect(res.output).toContain('truncated');
  });
});
