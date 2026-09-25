import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { main as runCorpusMain, NL_ROUTING_UNSAFE_RUN_ENV, resolveCorpusRunSafety } from './measure-nl-routing-corpus.js';
import type { EvalPromptResult } from '../src/eval-prompt-cli.js';

const resolveCorpusRunSafetyFromProcessEnv = (surfaceToolNames: readonly string[]) => resolveCorpusRunSafety(process.env, undefined, surfaceToolNames);

async function withRunnerEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  try {
    process.argv = process.argv.slice(0, 2);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv, env);
    return await fn();
  } finally {
    process.argv = originalArgv;
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
}

describe('measure-nl-routing-corpus runner cwd safety', () => {
  test('requires CORPUS_CWD after explicit unsafe bypass and before corpus loading', async () => {
    let corpusLoads = 0;
    await withRunnerEnv({ [NL_ROUTING_UNSAFE_RUN_ENV]: '1' }, async () => {
      await expect(runCorpusMain(
        () => {
          corpusLoads += 1;
          return { description: 'test', surface: 'cli', tiers: {}, items: [] };
        },
        async (): Promise<EvalPromptResult> => { throw new Error('runPrompt must not run'); },
        resolveCorpusRunSafetyFromProcessEnv,
      )).rejects.toThrow('CORPUS_CWD is required; provide the tool working directory for corpus measurement.');
    });
    expect(corpusLoads).toBe(0);
  });

  test('uses the final corpus surface for the single safety decision instead of a provisional cli surface', async () => {
    const outDir = mkdtempSync(resolve(tmpdir(), 'nl-routing-out-'));
    const out = resolve(outDir, 'corpus.json');
    const safetyInputs: string[][] = [];
    try {
      await withRunnerEnv({
        MONAD_SELF_IMPLEMENT_OBSERVE_ONLY: '1',
        CORPUS_CWD: outDir,
        CORPUS_OUT: out,
        CORPUS_REPEATS: '1',
        CORPUS_BUDGETS: '1',
        CORPUS_CONCURRENCY: '1',
      }, async () => {
        await runCorpusMain(
          () => ({ description: 'test', surface: 'chat', tiers: { test: 'test' }, items: [{ id: 'item', tier: 'test', prompt: 'prompt', accept: ['Read'] }] }),
          async (options): Promise<EvalPromptResult> => ({
            text: '', modelFamily: 'test', modelId: 'test', turnCount: 1, toolCallCount: 1,
            toolBreakdown: { Read: 1 }, toolSurface: options.tools!, surfaceToolNames: ['Read'], surfaceToolCount: 1,
            durationMs: 0, logPath: null, eventCounts: {}, assertions: [],
          }),
          (surfaceToolNames) => {
            safetyInputs.push([...surfaceToolNames]);
            return resolveCorpusRunSafety(process.env, undefined, surfaceToolNames);
          },
          (surface) => (surface === 'chat' ? ['Read'] : ['Bash']),
        );
      });
      expect(safetyInputs).toEqual([['Read']]);
      const output = JSON.parse(readFileSync(out, 'utf8')) as { surface: string; exposedMutatingTools: string[]; records: unknown[] };
      expect(output.surface).toBe('chat');
      expect(output.exposedMutatingTools).toEqual([]);
      expect(output.records).toHaveLength(1);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('passes CORPUS_CWD to runEvalPrompt seam and logs the tool cwd', async () => {
    const outDir = mkdtempSync(resolve(tmpdir(), 'nl-routing-out-'));
    const toolCwd = mkdtempSync(resolve(tmpdir(), 'nl-routing-tool-cwd-'));
    const out = resolve(outDir, 'corpus.json');
    const logs: string[] = [];
    const originalLog = console.log;
    const seenCwds: Array<string | undefined> = [];
    try {
      console.log = ((line: string) => logs.push(line)) as typeof console.log;
      await withRunnerEnv({
        MONAD_SELF_IMPLEMENT_OBSERVE_ONLY: '1',
        CORPUS_CWD: toolCwd,
        CORPUS_OUT: out,
        CORPUS_REPEATS: '1',
        CORPUS_BUDGETS: '1',
        CORPUS_CONCURRENCY: '1',
      }, async () => {
        await runCorpusMain(
          () => ({ description: 'test', surface: 'cli', tiers: { test: 'test' }, items: [{ id: 'item', tier: 'test', prompt: 'prompt', accept: ['Read'] }] }),
          async (options): Promise<EvalPromptResult> => {
            seenCwds.push(options.cwd);
            return {
              text: '', modelFamily: 'test', modelId: 'test', turnCount: 1, toolCallCount: 1,
              toolBreakdown: { Read: 1 }, toolSurface: options.tools!, surfaceToolNames: ['Read'], surfaceToolCount: 1,
              durationMs: 0, logPath: null, eventCounts: {}, assertions: [],
            };
          },
          resolveCorpusRunSafetyFromProcessEnv,
          () => ['Read'],
        );
      });
      expect(logs[0]).toContain(`tool-cwd ${toolCwd}`);
      expect(logs[0]).toContain('exposed-mutating-tools (none)');
      expect(seenCwds).toEqual([toolCwd]);
      expect(seenCwds[0]).not.toBe(process.cwd());
      const output = JSON.parse(readFileSync(out, 'utf8')) as { records: unknown[] };
      expect(output.records).toHaveLength(1);
    } finally {
      console.log = originalLog;
      rmSync(outDir, { recursive: true, force: true });
      rmSync(toolCwd, { recursive: true, force: true });
    }
  });

  test('safety refusal requires the caller to pass the observed surface before naming mutating tools', () => {
    expect(() => resolveCorpusRunSafety({}, { enabled: false, source: 'default' }, ['SelfImplement', 'Bash', 'Edit', 'Write'])).toThrow('Exposed mutating tools: Bash, Edit, Write, SelfImplement.');
    expect(() => resolveCorpusRunSafety({}, { enabled: true, source: 'flag' }, ['Bash', 'Edit', 'Write'])).toThrow('Unprotected host mutating tools exposed: Bash, Edit, Write.');
    expect(resolveCorpusRunSafety({}, { enabled: true, source: 'flag' }, ['SelfImplement'])).toEqual({
      observeOnly: { enabled: true, source: 'flag' },
      bypassed: false,
      exposedMutatingTools: [],
    });
    expect(() => resolveCorpusRunSafety({}, { enabled: false, source: 'config' }, ['SelfImplement'])).toThrow('Exposed mutating tools: SelfImplement.');
    expect(resolveCorpusRunSafety({ [NL_ROUTING_UNSAFE_RUN_ENV]: '1' }, { enabled: false, source: 'config' }, ['Bash'])).toEqual({
      observeOnly: { enabled: false, source: 'config' },
      bypassed: true,
      exposedMutatingTools: ['Bash'],
    });
  });
});
