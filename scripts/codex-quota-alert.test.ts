import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from './codex-quota-alert.js';

const script = new URL('./codex-quota-alert.ts', import.meta.url).pathname;

describe('codex quota alert poller log sink', () => {
  test('CLI entry registers the prescribed sink before the poller runs', async () => {
    const calls: string[] = [];
    await main({
      ensureCronNodePath: () => { calls.push('path'); },
      registerStandaloneLogSink: async surface => { calls.push(`sink:${surface}`); return true; },
      runCodexQuotaAlert: async () => { calls.push('poll'); },
    });
    expect(calls).toEqual(['path', 'sink:codex-quota-alert', 'poll']);
  });

  test('false sink registration is named and the poller continues', async () => {
    const calls: string[] = [];
    await main({
      ensureCronNodePath: () => { calls.push('path'); },
      registerStandaloneLogSink: async () => false,
      runCodexQuotaAlert: async () => { calls.push('poll'); },
      error: line => { calls.push(`error:${line}`); },
    });
    expect(calls).toEqual([
      'path',
      'error:⚠️ registerStandaloneLogSink(codex-quota-alert) failed; continuing quota poll',
      'poll',
    ]);
  });

  test('thrown sink registration is named and the poller continues', async () => {
    const calls: string[] = [];
    await main({
      ensureCronNodePath: () => { calls.push('path'); },
      registerStandaloneLogSink: async () => { throw new Error('SINK_UNAVAILABLE'); },
      runCodexQuotaAlert: async () => { calls.push('poll'); },
      error: line => { calls.push(`error:${line}`); },
    });
    expect(calls).toEqual([
      'path',
      'error:⚠️ registerStandaloneLogSink(codex-quota-alert) failed; continuing quota poll: SINK_UNAVAILABLE',
      'poll',
    ]);
  });

  test('importing the poller module has no standalone sink side effect', () => {
    const entry = join(import.meta.dir, './codex-quota-alert.ts');
    const sink = join(import.meta.dir, '../src/domains/standalone-log-sink.ts');
    const probe = `
      import { mock } from 'bun:test';
      let calls = 0;
      mock.module(${JSON.stringify(sink)}, () => ({
        registerStandaloneLogSink: async () => { calls++; return true; },
      }));
      await import(${JSON.stringify(entry)});
      console.log(JSON.stringify({ calls }));
    `;
    const run = spawnSync('bun', ['-e', probe], { cwd: join(import.meta.dir, '..'), encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout.trim())).toEqual({ calls: 0 });
  });

  test('the poller source calls registerStandaloneLogSink("codex-quota-alert") before observations', () => {
    const source = readFileSync(script, 'utf8');
    const sinkCall = "registerStandaloneLogSink)('codex-quota-alert')";
    expect(source).toContain("import { registerStandaloneLogSink } from '../src/domains/standalone-log-sink.js';");
    expect(source).toContain(sinkCall);
    expect(source.indexOf(sinkCall)).toBeLessThan(source.indexOf('runCodexQuotaAlert)()'));
    expect(source).toContain('if (import.meta.main) await main();');
  });
});
