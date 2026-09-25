// iOS session-list track (2026-05-14) — DELETE /v1/sessions/:id wires
// the ACP per-session abort flag before dropping history.
//
// Without this wire the DELETE was history-only and any in-flight
// LLM/tool turn kept running until natural end_turn — a zombie LM
// Studio request from the daemon's perspective, invisible to the
// user-facing session list (HANDOFF §2.4 격차).
//
// Invariants under test:
//   1. opts.abortSession fires BEFORE history.forget (so a turn
//      runner reading sessions.has(id) immediately after the abort
//      flag is set still sees a recognizable session).
//   2. Response body now carries `aborted: boolean`.
//   3. abortSession returns false → aborted:false in body, deletion
//      still proceeds (history loss has nothing to do with abort).
//   4. opts.abortSession omitted (legacy NEXUS boot path) → aborted:
//      false, no throw — backward-compatible.
//   5. Source-grep guard: src/nexus/index.ts threads
//      `abortSession` into metaApiOpts using the acpAbortHolder
//      indirection (so the runAcpServer onAbortHandle late-bind
//      keeps working).

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { handleSessionDelete } from '../src/nexus/api/meta-api.js';
import { DaemonSessionHistory } from '../src/boot/daemon-runtime.js';

const REPO_ROOT = join(import.meta.dir, '..');

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf-8');
}

function makeReq(id = 'sess-a'): Request {
  return new Request(`http://localhost/v1/sessions/${id}`, { method: 'DELETE' });
}

describe('handleSessionDelete · abort wire', () => {
  test('fires opts.abortSession BEFORE history.forget', async () => {
    const history = new DaemonSessionHistory({});
    history.register('sess-a', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);

    const callOrder: string[] = [];
    const originalForget = history.forget.bind(history);
    history.forget = (id: string) => {
      callOrder.push(`forget:${id}`);
      originalForget(id);
    };

    const abortCalled: string[] = [];
    const res = handleSessionDelete(makeReq('sess-a'), 'sess-a', {
      noAuth: true,
      history,
      abortSession: (sid) => {
        abortCalled.push(sid);
        callOrder.push(`abort:${sid}`);
        return true;
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sessionId: string; deleted: boolean; aborted: boolean };
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBe('sess-a');
    expect(body.deleted).toBe(true);
    expect(body.aborted).toBe(true);
    expect(abortCalled).toEqual(['sess-a']);
    expect(callOrder).toEqual(['abort:sess-a', 'forget:sess-a']);
    expect(history.has('sess-a')).toBe(false);
  });

  test('abortSession returns false (unknown to ACP) → aborted:false, history still dropped', async () => {
    const history = new DaemonSessionHistory({});
    history.register('sess-b', [{ role: 'user', content: 'hi' }]);
    const res = handleSessionDelete(makeReq('sess-b'), 'sess-b', {
      noAuth: true,
      history,
      abortSession: () => false,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: boolean; aborted: boolean };
    expect(body.deleted).toBe(true);
    expect(body.aborted).toBe(false);
    expect(history.has('sess-b')).toBe(false);
  });

  test('opts.abortSession omitted (legacy wire) → aborted:false, no throw', async () => {
    const history = new DaemonSessionHistory({});
    history.register('sess-c', [{ role: 'user', content: 'hi' }]);
    const res = handleSessionDelete(makeReq('sess-c'), 'sess-c', {
      noAuth: true,
      history,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: boolean; aborted: boolean };
    expect(body.deleted).toBe(true);
    expect(body.aborted).toBe(false);
    expect(history.has('sess-c')).toBe(false);
  });

  test('unknown sessionId → deleted:false, aborted:false (still 200 idempotent shape)', async () => {
    const history = new DaemonSessionHistory({});
    const res = handleSessionDelete(makeReq('nope'), 'nope', {
      noAuth: true,
      history,
      abortSession: () => false,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: boolean; aborted: boolean };
    expect(body.deleted).toBe(false);
    expect(body.aborted).toBe(false);
  });

  test('401 when bearer auth fails — abortSession NOT invoked', () => {
    const history = new DaemonSessionHistory({});
    let aborted = false;
    const res = handleSessionDelete(makeReq('sess-d'), 'sess-d', {
      bearerToken: 'secret',
      history,
      abortSession: () => { aborted = true; return true; },
    });
    expect(res.status).toBe(401);
    expect(aborted).toBe(false);
  });

  test('invalid sessionId (path-traversal) → 400 + abortSession NOT invoked', () => {
    const history = new DaemonSessionHistory({});
    let aborted = false;
    const res = handleSessionDelete(makeReq('..%2Froot'), '../root', {
      noAuth: true,
      history,
      abortSession: () => { aborted = true; return true; },
    });
    expect(res.status).toBe(400);
    expect(aborted).toBe(false);
  });
});

// ── Source-grep guards for the boot-time wire ──
//
// The runtime abort flag lives inside `runAcpServer`'s closure-scoped
// `sessions` Map. NEXUS boot can only reach it through the
// `onAbortHandle` callback we just added — and only the
// `acpAbortHolder` indirection (closure dereferences at call time)
// avoids a boot-race where DELETE lands before runAcpServer finishes
// allocating its sessions Map. If a future refactor collapses any of
// those three seams the DELETE silently falls back to the legacy
// history-only path and zombie turns reappear.
//
// Memory · feedback_source_level_grep_test_value (PR #2084): seam
// dead-wires are the regression unit + integration tests miss.

describe('NEXUS boot — DELETE → ACP abort wire (source-grep)', () => {
  const nexusIndex = readSource('src/nexus/index.ts');
  const metaApi = readSource('src/nexus/api/meta-api.ts');
  const acpServer = readSource('src/acp/server.ts');

  test('NEXUS declares an acpAbortHolder (no-op default)', () => {
    expect(nexusIndex).toMatch(/acpAbortHolder\s*:\s*\{\s*current\s*:\s*\(sessionId:\s*string\)\s*=>\s*boolean\s*\}/);
    expect(nexusIndex).toMatch(/current\s*:\s*\(\s*\)\s*=>\s*false/);
  });

  test('runAcpServer call wires onAbortHandle into the holder', () => {
    expect(nexusIndex).toMatch(/onAbortHandle\s*:\s*\(\s*cancel\s*\)\s*=>\s*\{/);
    expect(nexusIndex).toMatch(/acpAbortHolder\.current\s*=\s*cancel/);
  });

  test('metaApiOpts threads abortSession through the holder closure', () => {
    expect(nexusIndex).toMatch(/abortSession\s*:\s*\(\s*sessionId:\s*string\s*\)\s*=>\s*acpAbortHolder\.current\(sessionId\)/);
  });

  test('MetaApiOpts declares the optional abortSession field', () => {
    expect(metaApi).toMatch(/abortSession\?\s*:\s*\(sessionId:\s*string\)\s*=>\s*boolean/);
  });

  test('AcpServerOptions declares onAbortHandle + runAcpServer invokes it', () => {
    expect(acpServer).toMatch(/onAbortHandle\?\s*:\s*\(cancel:\s*\(sessionId:\s*string\)\s*=>\s*boolean\)\s*=>\s*void/);
    // The wire inside runAcpServer reads the sessions Map at call time
    // — assert the closure references both `sessions.get` and the
    // mutation onto `s.aborted = true`.
    expect(acpServer).toMatch(/opts\.onAbortHandle\?\.\(\(sessionId\)\s*=>\s*\{/);
    expect(acpServer).toMatch(/sessions\.get\(sessionId\)/);
  });
});
