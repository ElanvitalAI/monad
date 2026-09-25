// PLAN §4.1 · Phase 1.1 — capture-side tests for the turn-checkpoint primitive.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  setCheckpointDir, getCheckpointDir,
  maybeCaptureDecision, isDecisionBoundary,
  requestPause, isPauseRequested, resetPauseFlag,
  loadCheckpoints, loadLatest, listCheckpointTurns,
} from '../../src/turn-checkpoint/index.js';
import { mintTurnUri } from '../../src/mss/uri/builder.js';
import type { LLMMessage } from '../../src/llm.js';

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'turn-checkpoint-'));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  resetPauseFlag();
  setCheckpointDir(mkdir());
});

afterEach(() => {
  resetPauseFlag();
  setCheckpointDir(null);
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const emptyLoop = {
  execution: {
    lastCommand: null, lastSummary: null,
    primarySourceFile: null, interestingLine: null,
  },
  verification: {
    lastCommand: null, lastSummary: null,
    historyLen: 0, needsRefresh: false,
  },
  finalization: { verificationStillCurrent: true, forceFinalAnswer: false },
  signal: {
    primarySourceFile: null, primaryTestFile: null, interestingLine: null,
  },
};

const sampleHistory: LLMMessage[] = [
  { role: 'user', content: 'first user message' },
  { role: 'assistant', content: 'first assistant text' },
];

describe('isDecisionBoundary', () => {
  test('Edit is a decision boundary', () => {
    expect(isDecisionBoundary([{ name: 'Edit' }])).toBe(true);
  });
  test('Bash is a decision boundary', () => {
    expect(isDecisionBoundary([{ name: 'Bash' }])).toBe(true);
  });
  test('Agent is a decision boundary', () => {
    expect(isDecisionBoundary([{ name: 'Agent' }])).toBe(true);
  });
  test('Read alone is not a decision boundary', () => {
    expect(isDecisionBoundary([{ name: 'Read' }, { name: 'Grep' }])).toBe(false);
  });
  test('mixed batch with one decision tool counts', () => {
    expect(isDecisionBoundary([
      { name: 'Read' }, { name: 'Edit' }, { name: 'Grep' },
    ])).toBe(true);
  });
  test('empty batch is not a boundary', () => {
    expect(isDecisionBoundary([])).toBe(false);
  });
});

describe('maybeCaptureDecision — non-boundary tools', () => {
  test('skips when only Read/Grep are pending', () => {
    const res = maybeCaptureDecision({
      turnUri: mintTurnUri(),
      toolIndex: 0,
      history: sampleHistory,
      loop: emptyLoop,
      pendingCalls: [{ name: 'Read', args: { file_path: '/tmp/x.ts' } }],
    });
    expect(res.captured).toBe(false);
    expect(res.paused).toBe(false);
    expect(readdirSync(getCheckpointDir())).toEqual([]);
  });
});

describe('maybeCaptureDecision — decision boundaries', () => {
  test('captures on Edit and writes a JSONL row', () => {
    const turnUri = mintTurnUri();
    const res = maybeCaptureDecision({
      turnUri,
      toolIndex: 0,
      history: sampleHistory,
      loop: emptyLoop,
      pendingCalls: [{ name: 'Edit', args: { file_path: 'src/foo.ts', old_string: 'a', new_string: 'b' } }],
    });
    expect(res.captured).toBe(true);
    expect(res.paused).toBe(false);

    const rows = loadCheckpoints(turnUri);
    expect(rows.length).toBe(1);
    expect(rows[0]?.decision.kind).toBe('edit');
    expect(rows[0]?.decision.preview).toContain('Edit');
    expect(rows[0]?.toolIndex).toBe(0);
    expect(rows[0]?.messageCount).toBe(2);
    expect(rows[0]?.recentMessages?.length).toBe(2);
  });

  test('classifies Bash as shell, git commit as commit', () => {
    const turnUri = mintTurnUri();
    maybeCaptureDecision({
      turnUri, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Bash', args: { command: 'ls -la' } }],
    });
    maybeCaptureDecision({
      turnUri, toolIndex: 1, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Bash', args: { command: 'git commit -m "x"' } }],
    });
    const rows = loadCheckpoints(turnUri);
    expect(rows.length).toBe(2);
    expect(rows[0]?.decision.kind).toBe('shell');
    expect(rows[1]?.decision.kind).toBe('commit');
  });

  test('classifies Agent as agent-spawn', () => {
    const turnUri = mintTurnUri();
    maybeCaptureDecision({
      turnUri, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Agent', args: { description: 'sub task' } }],
    });
    expect(loadLatest(turnUri)?.decision.kind).toBe('agent-spawn');
  });

  test('captures recent assistant text trimmed to 240 chars', () => {
    const long = 'x'.repeat(800);
    const turnUri = mintTurnUri();
    maybeCaptureDecision({
      turnUri, toolIndex: 0,
      history: [{ role: 'assistant', content: long }],
      loop: emptyLoop,
      pendingCalls: [{ name: 'Edit', args: { file_path: 'a.ts' } }],
    });
    expect(loadLatest(turnUri)?.recentText?.length).toBe(240);
  });
});

describe('maybeCaptureDecision — pause path', () => {
  test('pause flag forces capture even with non-boundary calls', () => {
    requestPause();
    const turnUri = mintTurnUri();
    const res = maybeCaptureDecision({
      turnUri, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Read', args: { file_path: 'a' } }],
    });
    expect(res.captured).toBe(true);
    expect(res.paused).toBe(true);
    expect(isPauseRequested()).toBe(false); // consumed
    expect(loadLatest(turnUri)?.decision.kind).toBe('pause');
  });

  test('pause request is consume-once: a second decision boundary captures normally', () => {
    requestPause();
    const turnUri = mintTurnUri();
    maybeCaptureDecision({
      turnUri, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Edit', args: { file_path: 'a' } }],
    });
    const second = maybeCaptureDecision({
      turnUri, toolIndex: 1, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Edit', args: { file_path: 'b' } }],
    });
    expect(second.paused).toBe(false);
    const rows = loadCheckpoints(turnUri);
    expect(rows.length).toBe(2);
    expect(rows[0]?.decision.kind).toBe('pause');
    expect(rows[1]?.decision.kind).toBe('edit');
  });

  test('pause without any pending calls still writes a checkpoint', () => {
    requestPause();
    const turnUri = mintTurnUri();
    const res = maybeCaptureDecision({
      turnUri, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [],
    });
    expect(res.paused).toBe(true);
    const cp = loadLatest(turnUri);
    expect(cp?.decision.kind).toBe('pause');
    expect(cp?.decision.preview).toContain('paused');
  });
});

describe('checkpoint store — file layout', () => {
  test('writes one JSONL file per turn, append mode', () => {
    const turnUri = mintTurnUri();
    for (let i = 0; i < 3; i++) {
      maybeCaptureDecision({
        turnUri, toolIndex: i, history: sampleHistory, loop: emptyLoop,
        pendingCalls: [{ name: 'Edit', args: { file_path: `f${i}.ts` } }],
      });
    }
    const safe = (turnUri as string).replace(/[/\\:%]/g, '_');
    const file = join(getCheckpointDir(), `${safe}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.length).toBe(3);
  });

  test('listCheckpointTurns returns turns newest-first', async () => {
    const t1 = mintTurnUri();
    maybeCaptureDecision({
      turnUri: t1, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Edit', args: {} }],
    });
    // Force ≥1 ms gap so mtime ordering is stable.
    await new Promise((r) => setTimeout(r, 5));
    const t2 = mintTurnUri();
    maybeCaptureDecision({
      turnUri: t2, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Edit', args: {} }],
    });
    const list = listCheckpointTurns();
    expect(list.length).toBe(2);
    expect(list[0]).toBe(t2);
    expect(list[1]).toBe(t1);
  });

  test('store survives a malformed JSONL line', () => {
    const turnUri = mintTurnUri();
    maybeCaptureDecision({
      turnUri, toolIndex: 0, history: sampleHistory, loop: emptyLoop,
      pendingCalls: [{ name: 'Edit', args: {} }],
    });
    const safe = (turnUri as string).replace(/[/\\:%]/g, '_');
    const file = join(getCheckpointDir(), `${safe}.jsonl`);
    // Append a corrupt row.
    require('fs').appendFileSync(file, '{not-json\n', 'utf8');
    const rows = loadCheckpoints(turnUri);
    expect(rows.length).toBe(1); // malformed row skipped
    expect(rows[0]?.decision.kind).toBe('edit');
  });
});
