// exportSessionTranscript — 대화 전사 마크다운 내보내기 순수함수 테스트.
//
// 세션 디스크 소스 · 라이브 history 우선 · 기본/명시/디렉토리 경로 · 홈 밖 거부 ·
// not-found. root/home/nowMs 주입으로 결정론.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSessionTranscript } from '../src/session/export-transcript';

let root: string;
let home: string;
const NOW = Date.UTC(2026, 6, 24, 1, 2, 3); // 2026-07-24T01:02:03Z → slug 20260724-010203

function seed(id: string, title: string, msgs: Array<{ role: string; content: string }>): void {
  writeFileSync(join(root, `${id}.jsonl`), msgs.map(m => JSON.stringify({ ...m, ts: '2026-07-24T00:00:00Z' })).join('\n') + '\n');
  const meta = { id, title, source: 'cli', provider: 'anthropic', model: 'opus', messageCount: msgs.length, createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:10:00Z' };
  const idxPath = join(root, 'index.json');
  const idx = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : [];
  idx.push(meta);
  writeFileSync(idxPath, JSON.stringify(idx, null, 2));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sess-export-'));
  home = mkdtempSync(join(tmpdir(), 'sess-home-'));
  seed('aaaa1111-0000-0000-0000-000000000001', 'refactor turn-runner', [
    { role: 'user', content: 'help me refactor' },
    { role: 'assistant', content: 'sure — here is the plan' },
    { role: 'tool', content: 'TOOL NOISE should be dropped' },
  ]);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });

describe('exportSessionTranscript', () => {
  test('disk session → default ~/temp path, drops tool rows', () => {
    const r = exportSessionTranscript({ sessionId: 'aaaa', root, home, nowMs: NOW });
    expect(r.path).toBe(join(home, 'temp', 'monad-transcript-20260724-010203.md'));
    expect(r.messages).toBe(2); // tool row dropped
    expect(r.title).toBe('refactor turn-runner');
    const md = readFileSync(r.path, 'utf8');
    expect(md).toContain('# refactor turn-runner');
    expect(md).toContain('## User');
    expect(md).toContain('help me refactor');
    expect(md).toContain('## Assistant');
    expect(md).not.toContain('TOOL NOISE');
    expect(md).toContain('- **session:** aaaa1111-0000-0000-0000-000000000001');
  });

  test('explicit file path (inside home) is honored', () => {
    const to = join(home, 'sub', 'my-export.md');
    const r = exportSessionTranscript({ sessionId: 'aaaa', to, root, home, nowMs: NOW });
    expect(r.path).toBe(to);
    expect(existsSync(to)).toBe(true);
  });

  test('directory target appends default filename', () => {
    const dir = join(home, 'out'); mkdirSync(dir, { recursive: true });
    const r = exportSessionTranscript({ sessionId: 'aaaa', to: dir, root, home, nowMs: NOW });
    expect(r.path).toBe(join(dir, 'monad-transcript-20260724-010203.md'));
  });

  test('live history overrides disk source', () => {
    const r = exportSessionTranscript({
      sessionId: 'aaaa',
      history: [{ role: 'user', content: 'live only message' }],
      meta: { title: 'live session' },
      root, home, nowMs: NOW,
    });
    const md = readFileSync(r.path, 'utf8');
    expect(md).toContain('live only message');
    expect(md).not.toContain('help me refactor'); // disk not used
    expect(r.messages).toBe(1);
  });

  test('rejects writing outside home', () => {
    expect(() => exportSessionTranscript({ sessionId: 'aaaa', to: '/etc/evil.md', root, home, nowMs: NOW }))
      .toThrow(/outside home/);
  });

  test('unknown session id → error', () => {
    expect(() => exportSessionTranscript({ sessionId: 'zzzz', root, home, nowMs: NOW }))
      .toThrow(/not found|no session/);
  });
});
