// B (session carry-in) — a delegation's FIRST prompt carries a bounded digest
// of the recent chat so the coding agent can resolve "그거/아까". Behavioral:
// seed an isolated telegram session with a few turns, assert the preamble.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAcpContextPreamble } from '../src/telegram-commands';
import { createSession, appendMessage } from '../src/session/index';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acp-carryin-'));
  process.env.ELANOUS_SESSION_ROOT = join(root, 'sessions');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.ELANOUS_SESSION_ROOT;
});

describe('buildAcpContextPreamble', () => {
  test('empty for a fresh chat (no session)', () => {
    expect(buildAcpContextPreamble(42, undefined, 'BOT')).toBe('');
  });

  test('carries recent user/assistant turns as a bounded digest', () => {
    const s = createSession({ source: 'telegram', sourceKind: 'telegram', tgChatId: 42, tgBotId: 'BOT', provider: 'x', model: 'y', title: 't' });
    appendMessage(s.id, { role: 'user', content: 'add.ts 의 곱셈 함수 얘기 기억해?', ts: new Date().toISOString() });
    appendMessage(s.id, { role: 'assistant', content: '네, mul(a,b) 말씀이죠.', ts: new Date().toISOString() });

    const pre = buildAcpContextPreamble(42, undefined, 'BOT');
    expect(pre).toContain('최근 대화 맥락');
    expect(pre).toContain('사용자: add.ts 의 곱셈 함수');
    expect(pre).toContain('elanous: 네, mul(a,b)');
    expect(pre.endsWith('---\n')).toBe(true);
  });

  test('tool rows are excluded (only user/assistant carried)', () => {
    const s = createSession({ source: 'telegram', sourceKind: 'telegram', tgChatId: 7, tgBotId: 'BOT', provider: 'x', model: 'y', title: 't' });
    appendMessage(s.id, { role: 'user', content: 'hello', ts: new Date().toISOString() });
    appendMessage(s.id, { role: 'tool', content: '⚙️ Bash', toolName: 'Bash', ts: new Date().toISOString() });
    appendMessage(s.id, { role: 'assistant', content: 'hi', ts: new Date().toISOString() });
    const pre = buildAcpContextPreamble(7, undefined, 'BOT');
    expect(pre).toContain('사용자: hello');
    expect(pre).toContain('elanous: hi');
    expect(pre).not.toContain('Bash');
  });

  // Interweave — a CONTINUED session carries only the DELTA since the backend
  // last ran, so `/cc → self → /cc` picks up the interleaved self work.
  test('sinceTs mode carries only turns AFTER the mark (interleave delta)', () => {
    const s = createSession({ source: 'telegram', sourceKind: 'telegram', tgChatId: 9, tgBotId: 'BOT', provider: 'x', model: 'y', title: 't' });
    appendMessage(s.id, { role: 'user', content: 'CDX-EARLY 코딩 지시', ts: '2026-07-11T00:00:00.000Z' });
    appendMessage(s.id, { role: 'assistant', content: 'cdx 완료', ts: '2026-07-11T00:00:01.000Z' });
    const mark = '2026-07-11T00:00:02.000Z'; // backend last ran here
    appendMessage(s.id, { role: 'user', content: 'SELF-INTERLEAVE 편집', ts: '2026-07-11T00:00:03.000Z' });
    appendMessage(s.id, { role: 'assistant', content: 'self 편집함', ts: '2026-07-11T00:00:04.000Z' });

    const delta = buildAcpContextPreamble(9, undefined, 'BOT', { sinceTs: mark });
    expect(delta).toContain('직전 위임 이후');
    expect(delta).toContain('SELF-INTERLEAVE');       // interleaved work carried
    expect(delta).not.toContain('CDX-EARLY');          // pre-mark turns excluded
  });
});
