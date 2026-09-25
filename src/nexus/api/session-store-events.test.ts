// 세션 이벤트 브릿지(S3a) — 생성 발행 + 갱신 스로틀 검증.
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, appendMessage } from '../../session/index.js';
import { wireSessionStoreEvents } from './session-store-events.js';

const roots: string[] = [];
function tmpRoot(): string { const r = mkdtempSync(join(tmpdir(), 'sess-ev-')); roots.push(r); return r; }
afterEach(() => { for (const r of roots.splice(0)) try { rmSync(r, { recursive: true, force: true }); } catch { /* noop */ } });

describe('wireSessionStoreEvents', () => {
  it('세션 생성 → session.created 발행', () => {
    const root = tmpRoot();
    const events: { kind: string; detail?: Record<string, unknown> }[] = [];
    const off = wireSessionStoreEvents({ publish: (e) => events.push(e) });
    try {
      createSession({ source: 'telegram' }, root);
      const created = events.filter((e) => e.kind === 'session.created');
      expect(created.length).toBe(1);
      expect(created[0]!.detail?.source).toBe('telegram');
    } finally { off(); }
  });

  it('메시지 append → session.updated (세션별 2s 스로틀)', () => {
    const root = tmpRoot();
    const events: { kind: string }[] = [];
    let clock = 0;
    const off = wireSessionStoreEvents({ publish: (e) => events.push(e) }, () => clock);
    try {
      const s = createSession({ source: 'cli' }, root);
      clock = 1000; appendMessage(s.id, { role: 'user', content: 'a', ts: 'x' }, root);      // 발행
      clock = 1500; appendMessage(s.id, { role: 'assistant', content: 'b', ts: 'x' }, root); // 스로틀(억제)
      clock = 4000; appendMessage(s.id, { role: 'user', content: 'c', ts: 'x' }, root);      // 발행
      const updated = events.filter((e) => e.kind === 'session.updated');
      expect(updated.length).toBe(2);
    } finally { off(); }
  });
});
