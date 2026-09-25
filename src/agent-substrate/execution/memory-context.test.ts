import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvent, openSurfaceEventsDb } from '../../domains/surface-events.js';
import { recallMemoryContext } from './memory-context.js';

const originalStateDir = process.env.MONAD_STATE_DIR;
const stateDirs: string[] = [];

afterEach(() => {
  if (originalStateDir === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = originalStateDir;
  for (const stateDir of stateDirs.splice(0)) rmSync(stateDir, { recursive: true, force: true });
});

describe('recallMemoryContext', () => {
  test('관측 장치 산출은 자식 프롬프트 컨텍스트에서 빼고 유지된 기억은 포맷한다', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'memory-context-'));
    stateDirs.push(stateDir);
    process.env.MONAD_STATE_DIR = stateDir;
    const db = openSurfaceEventsDb();
    try {
      recordEvent(db, { domain: 'monad', surface: 'test', direction: 'outbound', kind: 'utterance', text: '<task-notification>\n<summary>child memory probe one</summary>', importance: 10 });
      recordEvent(db, { domain: 'monad', surface: 'test', direction: 'outbound', kind: 'utterance', text: 'child memory probe pty_a4c9f0: capture', importance: 10 });
      recordEvent(db, { domain: 'monad', surface: 'test', direction: 'outbound', kind: 'impl', text: 'retained child memory probe one', summary: 'retained summary one', importance: 1 });
      recordEvent(db, { domain: 'monad', surface: 'test', direction: 'outbound', kind: 'impl', text: 'retained child memory probe two', summary: 'retained summary two', importance: 1 });
      const context = await recallMemoryContext('child memory probe', { limit: 2 });
      expect(context).not.toContain('<task-notification>');
      expect(context).not.toContain('pty_a4c9f0');
      expect(context).toContain('[memory source=surface-events/self-awareness;');
      expect(context).toContain('kind=impl] retained summary one');
      expect(context).toContain('kind=impl] retained summary two');
    } finally {
      db.close();
    }
  });
});
