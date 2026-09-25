// PLAN §4.4 · Phase 1.4 — invoke + store integration tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  invokeResearch, setResearchInvoker,
  setResearchArchiveDir, getResearchArchiveDir,
  getRecentResults, clearResults,
} from '../../src/research-bridge/index.js';

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'research-bridge-'));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  setResearchArchiveDir(mkdir());
  clearResults();
});

afterEach(() => {
  setResearchInvoker(null);
  setResearchArchiveDir(null);
  clearResults();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('invokeResearch — happy path', () => {
  test('default skill is omni-crawl, topic is forwarded as args', async () => {
    let observedSkill = '';
    let observedArgs = '';
    setResearchInvoker(async (skillName, args) => {
      observedSkill = skillName;
      observedArgs = args;
      return { output: '# results\n- one\n- two', ok: true };
    });
    const result = await invokeResearch('cursor pause patterns');
    expect(observedSkill).toBe('omni-crawl');
    expect(observedArgs).toBe('cursor pause patterns');
    expect(result.skill).toBe('omni-crawl');
    expect(result.topic).toBe('cursor pause patterns');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('# results');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('skill override is honoured', async () => {
    let observed = '';
    setResearchInvoker(async (skillName) => {
      observed = skillName;
      return { output: 'x', ok: true };
    });
    const result = await invokeResearch('topic', { skill: 'apify-x-asset-sentiment' });
    expect(observed).toBe('apify-x-asset-sentiment');
    expect(result.skill).toBe('apify-x-asset-sentiment');
  });

  test('onProgress chunks reach the caller', async () => {
    const progress: string[] = [];
    setResearchInvoker(async (_, __, onProgress) => {
      onProgress?.('chunk-1');
      onProgress?.('chunk-2');
      return { output: 'final', ok: true };
    });
    await invokeResearch('topic', { onProgress: (d) => progress.push(d) });
    expect(progress).toEqual(['chunk-1', 'chunk-2']);
  });
});

describe('invokeResearch — failure modes', () => {
  test('empty output marks result not ok', async () => {
    setResearchInvoker(async () => ({ output: '', ok: true }));
    const result = await invokeResearch('topic');
    expect(result.ok).toBe(false);
  });

  test('explicit error surfaces in result.error', async () => {
    setResearchInvoker(async () => ({
      output: '',
      ok: false,
      error: 'skill not found',
    }));
    const result = await invokeResearch('topic');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('skill not found');
  });
});

describe('store — recordResult + ring + archive', () => {
  test('recent results are newest-first', async () => {
    setResearchInvoker(async (_, args) => ({
      output: `output for ${args}`,
      ok: true,
    }));
    await invokeResearch('first');
    // small delay so finishedAt timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    await invokeResearch('second');
    const recent = getRecentResults();
    expect(recent.length).toBe(2);
    expect(recent[0]?.topic).toBe('second');
    expect(recent[1]?.topic).toBe('first');
  });

  test('ring is bounded at 20 entries', async () => {
    setResearchInvoker(async () => ({ output: 'x', ok: true }));
    for (let i = 0; i < 25; i++) {
      await invokeResearch(`q${i}`);
    }
    const recent = getRecentResults(50);
    expect(recent.length).toBe(20);
    // First-in entries (q0..q4) should have rotated out.
    expect(recent.every((r) => Number(r.topic.slice(1)) >= 5)).toBe(true);
  });

  test('archive file is written under the configured dir', async () => {
    setResearchInvoker(async () => ({
      output: '## findings\n\nimportant fact',
      ok: true,
    }));
    await invokeResearch('test query');
    const entries = readdirSync(getResearchArchiveDir());
    expect(entries.length).toBe(1);
    const file = join(getResearchArchiveDir(), entries[0]!);
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, 'utf8');
    expect(body).toContain('# test query');
    expect(body).toContain('skill: omni-crawl');
    expect(body).toContain('important fact');
  });

  test('output longer than 16 KiB is truncated in the ring (and archive)', async () => {
    const longBody = 'a'.repeat(20 * 1024);
    setResearchInvoker(async () => ({ output: longBody, ok: true }));
    const result = await invokeResearch('big');
    // The returned result still carries the full output...
    expect(result.output.length).toBe(20 * 1024);
    // ...but the ring entry is capped (we read it back).
    const ringEntry = getRecentResults(1)[0]!;
    expect(ringEntry.output.length).toBeLessThan(longBody.length);
    expect(ringEntry.output).toContain('truncated');
  });

  test('clearResults empties the ring (archive untouched)', async () => {
    setResearchInvoker(async () => ({ output: 'x', ok: true }));
    await invokeResearch('one');
    expect(getRecentResults().length).toBe(1);
    clearResults();
    expect(getRecentResults().length).toBe(0);
    // Archive file persists.
    expect(readdirSync(getResearchArchiveDir()).length).toBe(1);
  });
});
