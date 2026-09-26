// /cc·/cdx ACP session bounding — the root fix for the "매 재시작마다 첫
// /cc 가 61초" problem. A per-chat backend session was persisted across
// daemon restarts and grew unbounded, so resuming it (loadSession) replayed
// the whole transcript. Three guards, all in resolveSessionId:
//   ① a prior-process claude session whose turnCount is large or unknown → recycle without replay
//   ② turnCount > cap                                                  → recycle
//   ③ resume overran the time-box                                      → recycle
// Plus: every completed turn bumps turnCount so ② eventually triggers.
//
// ⚠️⭐ 정정 (2026-08-27 · 사람): 아래 판단문 가운데 «원인 진단»은 옳다(시험 환경이 다른 스토어를
//   골랐다). ⛔ 그러나 같은 착지가 «곁들여» `turn-runner.ts` 의 `>=` 를 `>` 로 바꾸고 이 파일의
//   ② 시험을 「cap 이면 이어붙는다」로 다시 썼다. 그 변경은 ⑴ 고치려던 아홉에 «필요 없었고»
//   (되돌려도 나머지 13 이 통과한다) ⑵ 근거로 든 것이 «다른 상수»였다(RESUME_MAX_TURNS=40 ↔ TURN_CAP=200).
//   ⇒ 제품과 이 시험을 «원래 계약»(≥ cap → recycle)으로 되돌렸다.
//
// Decision (2026-08-27): the nine boundary assertions are current, not
// inverted. Commit a962da5c made the S5 criterion explicit: a known claude
// session with turnCount ≤ ACP_CROSS_RESTART_RESUME_MAX_TURNS (40) resumes
// after restart; large or unknown sessions recycle. The apparent inversion
// came from this test seeding XDG_CONFIG_HOME while ELANOUS_STATE_DIR (which
// session-store.ts gives priority since a5c5a1a5dc) still selected another
// store. Clear that higher-priority test environment so runAcpTurn →
// resolveSessionId reads the seeded persisted record; assertions stay intact.
//
// Existing execution path: runAcpTurn (src/acp/turn-runner.ts) canonicalizes
// the backend and calls resolveSessionId, whose persisted-record branch these
// tests exercise.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runAcpTurn, withResumeTimeout, ACP_SESSION_TURN_CAP, ACP_SESSION_IDLE_TTL_MS, ACP_CROSS_RESTART_RESUME_MAX_TURNS,
  _resetTurnRunnerCachesForTests,
} from '../src/acp/turn-runner';
import {
  ACP_SESSION_EPOCH, globalAcpSessionStore, _resetAcpSessionStoreForTests,
} from '../src/acp/session-store.js';
import { _resetAcpAgentManagerForTests } from '../src/acp/agent-manager.js';

let dir: string;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;
const ORIG_STATE_DIR = process.env.ELANOUS_STATE_DIR;

interface StubCalls { newSession: number; loadSession: number; loadSessionIds: string[]; }

/** Install a PERSISTABLE (loadSession-capable) stub agent that counts
 *  newSession vs loadSession calls, so we can assert resume-vs-recycle. */
function installStubAgent(loadSessionImpl?: (req: { sessionId: string }) => Promise<unknown>): StubCalls {
  const calls: StubCalls = { newSession: 0, loadSession: 0, loadSessionIds: [] };
  _resetAcpAgentManagerForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/acp/agent-manager.js') as { globalAcpAgentManager: () => Record<string, unknown> };
  const live = mod.globalAcpAgentManager();
  const stub = {
    getCapabilities: () => ({ loadSession: true }),
    newSession: async () => { calls.newSession += 1; return `sess-new-${calls.newSession}`; },
    loadSession: async (req: { sessionId: string }) => {
      calls.loadSession += 1; calls.loadSessionIds.push(req.sessionId);
      if (loadSessionImpl) return loadSessionImpl(req);
      return undefined;
    },
    async prompt() { return { stopReason: 'end_turn' }; },
    cancel: async () => { /* noop */ },
  };
  live['getAgent'] = async () => stub as unknown;
  live['drop'] = () => { /* noop */ };
  return calls;
}

function seedStore(record: Record<string, unknown>): void {
  mkdirSync(join(dir, 'elanous'), { recursive: true });
  writeFileSync(join(dir, 'elanous', 'acp-sessions.json'), JSON.stringify([record], null, 2), 'utf-8');
  _resetAcpSessionStoreForTests();
}

// RECENT updatedAt by default so the SMART idle boundary (2026-07-11) doesn't
// fire — tests that want an idle recycle override it to an old timestamp.
const base = { chatId: '999', backendId: 'claude', sessionId: 'sess-x', updatedAt: new Date().toISOString() };
const OLD_TS = new Date(Date.now() - ACP_SESSION_IDLE_TTL_MS - 60_000).toISOString();
const RUN = { backendId: 'claude', promptText: 'hi', chatId: 999 };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acp-sess-bound-'));
  delete process.env.ELANOUS_STATE_DIR;
  process.env.XDG_CONFIG_HOME = dir;
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
});
afterEach(() => {
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
  rmSync(dir, { recursive: true, force: true });
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  if (ORIG_STATE_DIR === undefined) delete process.env.ELANOUS_STATE_DIR;
  else process.env.ELANOUS_STATE_DIR = ORIG_STATE_DIR;
});

describe('withResumeTimeout', () => {
  test('rejects with acp-resume-timeout when the inner promise overruns', async () => {
    await expect(withResumeTimeout(new Promise(() => { /* never */ }), 10)).rejects.toThrow('acp-resume-timeout');
  });
  test('passes a promise that resolves in time straight through', async () => {
    await expect(withResumeTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });
});

describe('ACP session bounding — resolveSessionId', () => {
  // S5 (2026-07-12) — 재시작 생존: a SMALL known-size claude session
  // survives a restart via a time-boxed loadSession instead of the old
  // unconditional recycle. Only large / unknown-size sessions keep the
  // eager fast path (replay would be 60s+).
  test('① prior epoch + SMALL session → cross-restart RESUME (time-boxed)', async () => {
    seedStore({ ...base, sessionId: 'sess-old', mintedEpoch: 'PRIOR-EPOCH', turnCount: 3 });
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(1);
    expect(calls.loadSessionIds).toEqual(['sess-old']);
    expect(calls.newSession).toBe(0);
  });

  test('① prior epoch + LARGE session (> resume threshold) → eager recycle, no replay', async () => {
    seedStore({ ...base, sessionId: 'sess-huge', mintedEpoch: 'PRIOR-EPOCH', turnCount: ACP_CROSS_RESTART_RESUME_MAX_TURNS + 1 });
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(0); // no 61s replay
    expect(calls.newSession).toBe(1);  // fresh mint instead
  });

  test('① absent epoch (pre-bounding record) also recycles', async () => {
    seedStore({ ...base, sessionId: 'sess-legacy' }); // no mintedEpoch / turnCount
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(0);
    expect(calls.newSession).toBe(1);
  });

  test('② turnCount ≥ cap (pathological BACKSTOP) → recycle', async () => {
    seedStore({ ...base, sessionId: 'sess-at-cap', mintedEpoch: ACP_SESSION_EPOCH, turnCount: ACP_SESSION_TURN_CAP });
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(0);
    expect(calls.newSession).toBe(1);
  });

  test('② turnCount > cap (pathological BACKSTOP) → recycle', async () => {
    seedStore({ ...base, sessionId: 'sess-over-cap', mintedEpoch: ACP_SESSION_EPOCH, turnCount: ACP_SESSION_TURN_CAP + 1 });
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(0);
    expect(calls.newSession).toBe(1);
  });

  // SMART idle boundary (2026-07-11) — replaces the crude 24-turn cap as the
  // primary lifecycle signal. A session untouched > TTL recycles (topic moved
  // on); context is refilled by the carry-in digest.
  test('idle > TTL → recycle (fresh mint), no cold resume', async () => {
    seedStore({ ...base, sessionId: 'sess-idle', mintedEpoch: ACP_SESSION_EPOCH, turnCount: 2, updatedAt: OLD_TS });
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(0);
    expect(calls.newSession).toBe(1);
  });

  test('recent activity + under cap → RESUME (continuity kept past 24 turns)', async () => {
    // 30 turns — would have hit the OLD crude cap (24). Now resumes.
    seedStore({ ...base, sessionId: 'sess-30', mintedEpoch: ACP_SESSION_EPOCH, turnCount: 30 });
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(1);
    expect(calls.newSession).toBe(0);
  });

  test('current epoch + under cap → RESUME (loadSession), no fresh mint', async () => {
    seedStore({ ...base, sessionId: 'sess-live', mintedEpoch: ACP_SESSION_EPOCH, turnCount: 2 });
    const calls = installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(1);
    expect(calls.loadSessionIds).toEqual(['sess-live']);
    expect(calls.newSession).toBe(0);
  });

  test('③ resume that overruns the time-box → recycle to fresh', async () => {
    seedStore({ ...base, sessionId: 'sess-live', mintedEpoch: ACP_SESSION_EPOCH, turnCount: 2 });
    // Simulate the time-box firing: loadSession rejects with the timeout shape.
    const calls = installStubAgent(async () => { throw new Error('acp-resume-timeout'); });
    await runAcpTurn({ ...RUN });
    expect(calls.loadSession).toBe(1); // attempted…
    expect(calls.newSession).toBe(1);  // …then recycled
  });

  // Fix B — the stale-epoch recycle (①) is EAGER_RECYCLE_BACKENDS-only.
  // codex's loadSession is a cheap re-attach (no transcript replay), so a
  // stale epoch RESUMES rather than churning a fresh thread + orphan.
  test('① codex with a stale epoch RESUMES (cheap re-attach), not recycle', async () => {
    // Seed the CANONICAL id; RUN with the 'codex' alias — exercises both
    // alias normalization and the codex-exempt stale-epoch behavior.
    seedStore({ ...base, backendId: 'codex-app-server', sessionId: 'sess-codex', mintedEpoch: 'PRIOR-EPOCH', turnCount: 3 });
    const calls = installStubAgent();
    await runAcpTurn({ backendId: 'codex', promptText: 'hi', chatId: 999 });
    expect(calls.loadSession).toBe(1);
    expect(calls.loadSessionIds).toEqual(['sess-codex']);
    expect(calls.newSession).toBe(0);
  });

  test('② codex recycles over the turn cap (backend-agnostic)', async () => {
    seedStore({ ...base, backendId: 'codex-app-server', sessionId: 'sess-codex-big', mintedEpoch: ACP_SESSION_EPOCH, turnCount: ACP_SESSION_TURN_CAP + 1 });
    const calls = installStubAgent();
    await runAcpTurn({ backendId: 'codex', promptText: 'hi', chatId: 999 });
    expect(calls.loadSession).toBe(0);
    expect(calls.newSession).toBe(1);
  });

  test('every completed turn bumps turnCount (drives ② over time)', async () => {
    seedStore({ ...base, sessionId: 'sess-live', mintedEpoch: ACP_SESSION_EPOCH, turnCount: 5 });
    installStubAgent();
    await runAcpTurn({ ...RUN });
    expect(globalAcpSessionStore().getRecord(999, 'claude')?.turnCount).toBe(6);
  });
});
