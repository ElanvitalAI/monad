// Round 3 PR1 (β-3 · 2026-05-08) — endpoint tests for the PWA
// Pushcut settings card backend. Covers GET /v1/hitl/audit/recent
// and POST /v1/hitl/test-pushcut.

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  handleHitlAuditRecent,
  handleHitlTestPushcut,
} from '../src/nexus/api/hitl-pushcut-settings.js';
import type { PushcutClient, PushcutNotification, PushcutSendResult } from '../src/pushcut/client.js';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function makeTmpAuditFile(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pushcut-set-'));
  tmpDirs.push(dir);
  const path = join(dir, 'hitl-log.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return path;
}

const sampleEntry = (over: Partial<{
  ts: number; requestId: string; channel: string; answer: boolean;
}> = {}): object => ({
  ts: 1_700_000_000_000,
  requestId: 'req-1',
  prompt: 'Approve?',
  channel: 'pushcut',
  answer: true,
  elapsedMs: 1200,
  ...over,
});

describe('GET /v1/hitl/audit/recent', () => {
  it('returns the audit tail (default limit 50)', async () => {
    const lines: object[] = [];
    for (let i = 0; i < 70; i++) {
      lines.push(sampleEntry({ requestId: `r-${i}`, ts: 1_000_000 + i }));
    }
    const auditPath = makeTmpAuditFile(lines);
    const req = new Request('http://x/v1/hitl/audit/recent');
    const res = await handleHitlAuditRecent(req, { auditPath });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.path).toBe(auditPath);
    expect(body.count).toBe(50);
    // tail = most recent 50
    expect(body.entries[0].requestId).toBe('r-20');
    expect(body.entries[49].requestId).toBe('r-69');
  });

  it('honors ?limit=N query param', async () => {
    const lines = Array.from({ length: 5 }, (_, i) => sampleEntry({ requestId: `r-${i}` }));
    const auditPath = makeTmpAuditFile(lines);
    const req = new Request('http://x/v1/hitl/audit/recent?limit=3');
    const res = await handleHitlAuditRecent(req, { auditPath });
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.entries.map((e: { requestId: string }) => e.requestId)).toEqual(['r-2', 'r-3', 'r-4']);
  });

  it('honors ?channel= filter (e.g. pushcut only)', async () => {
    const auditPath = makeTmpAuditFile([
      sampleEntry({ requestId: 'pc-1', channel: 'pushcut' }),
      sampleEntry({ requestId: 'tg-1', channel: 'telegram' }),
      sampleEntry({ requestId: 'pc-2', channel: 'pushcut' }),
    ]);
    const req = new Request('http://x/v1/hitl/audit/recent?channel=pushcut');
    const res = await handleHitlAuditRecent(req, { auditPath });
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.entries.map((e: { requestId: string }) => e.requestId)).toEqual(['pc-1', 'pc-2']);
  });

  it('returns empty entries when the audit file does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-audit-'));
    tmpDirs.push(dir);
    const req = new Request('http://x/v1/hitl/audit/recent');
    const res = await handleHitlAuditRecent(req, { auditPath: join(dir, 'never.jsonl') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.entries).toEqual([]);
  });
});

function fakeClient(over: Partial<PushcutClient> = {}): PushcutClient {
  const calls: { name: string; payload: PushcutNotification }[] = [];
  const client: PushcutClient = {
    configured: true,
    async notify(name, payload): Promise<PushcutSendResult> {
      calls.push({ name, payload });
      return { ok: true };
    },
    async sendAutomation() { return { ok: true } as PushcutSendResult; },
    ...over,
  } as PushcutClient;
  // expose calls for assertions
  (client as PushcutClient & { __calls: typeof calls }).__calls = calls;
  return client;
}

describe('POST /v1/hitl/test-pushcut', () => {
  it('fires a default-prompt notification when configured', async () => {
    const client = fakeClient();
    const req = new Request('http://x/v1/hitl/test-pushcut', { method: 'POST' });
    const res = await handleHitlTestPushcut(req, { client, notificationName: 'elanous-test-notif' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.notificationName).toBe('elanous-test-notif');
    expect(body.prompt).toContain('β-3 test');
    expect(typeof body.sentAt).toBe('number');
    const calls = (client as PushcutClient & { __calls: { name: string; payload: PushcutNotification }[] }).__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('elanous-test-notif');
    expect(calls[0].payload.title).toContain('β-3 test');
  });

  it('honors a caller-supplied prompt', async () => {
    const client = fakeClient();
    const req = new Request('http://x/v1/hitl/test-pushcut', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello iPad — manual fire' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await handleHitlTestPushcut(req, { client });
    const body = await res.json();
    expect(body.prompt).toBe('Hello iPad — manual fire');
  });

  it('returns 503 when Pushcut is not configured', async () => {
    const client = fakeClient({ configured: false });
    const req = new Request('http://x/v1/hitl/test-pushcut', { method: 'POST' });
    const res = await handleHitlTestPushcut(req, { client });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('pushcut-not-configured');
    expect(body.hint).toContain('PUSHCUT_API_KEY');
  });

  it('returns 502 when notify rejects (e.g. wrong API key)', async () => {
    const client = fakeClient({
      async notify() { return { ok: false, reason: 'pushcut-api-error' }; },
    });
    const req = new Request('http://x/v1/hitl/test-pushcut', { method: 'POST' });
    const res = await handleHitlTestPushcut(req, { client });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.reason).toBe('pushcut-api-error');
  });

  it('rejects malformed JSON body with 400', async () => {
    const client = fakeClient();
    const req = new Request('http://x/v1/hitl/test-pushcut', {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await handleHitlTestPushcut(req, { client });
    expect(res.status).toBe(400);
  });

  it('caps prompt length at 200 chars', async () => {
    const client = fakeClient();
    const longPrompt = 'x'.repeat(500);
    const req = new Request('http://x/v1/hitl/test-pushcut', {
      method: 'POST',
      body: JSON.stringify({ prompt: longPrompt }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await handleHitlTestPushcut(req, { client });
    const body = await res.json();
    expect(body.prompt.length).toBe(200);
  });
});
