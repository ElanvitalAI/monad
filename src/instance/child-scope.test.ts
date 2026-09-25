import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetMonadConfigDir, setMonadConfigDir } from '../monad-config-dir.js';
import { effectiveInstanceRoot, prodInstanceRoot, resetEffectiveInstanceRoot, setTreeDerivedTestForTesting } from './resolve.js';
import { childInstanceScope } from './child-scope.js';

const originalStateDir = process.env.MONAD_STATE_DIR;

function resetProcessResolution(): void {
  resetMonadConfigDir();
  setTreeDerivedTestForTesting(undefined);
  resetEffectiveInstanceRoot();
  if (originalStateDir === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = originalStateDir;
}

afterEach(resetProcessResolution);

async function captureChildSpawn(scope: { configDir?: string; stateDir?: string }): Promise<{ argv: string[]; env: NodeJS.ProcessEnv }> {
  let argv: string[] = [];
  let env: NodeJS.ProcessEnv = {};
  const { defaultSeams } = await import('../self-implement/seams.js');
  await defaultSeams({
    ...scope,
    ptyAvailable: () => false,
    implementMaxWaitSec: 1,
    spawnSync: ((_command: string, args: string[], options: { env?: NodeJS.ProcessEnv } | undefined) => {
      argv = args;
      env = options?.env ?? {};
      return { status: 0, stdout: 'GOAL-COMPLETE\n', stderr: '', signal: null };
    }) as never,
  }).implement!({ cwd: process.cwd(), feature: 'noop', runId: 'child-scope-capture' });
  return { argv, env };
}

describe('childInstanceScope', () => {
  test('[layer3] tree-derived parent resolves once and pins both child spawn axes', () => {
    const home = mkdtempSync(join(tmpdir(), 'child-scope-home-'));
    try {
      mkdirSync(join(home, '.monad'));
      writeFileSync(join(home, '.monad', 'config.json'), JSON.stringify({ instance: { treeDerivedTest: true } }));
      writeFileSync(join(home, '.monad', 'leader.json'), JSON.stringify({ tree: '/another/leader', promotedAt: 'test' }));
      const script = `
        const {childInstanceScope}=require('${process.cwd()}/src/instance/child-scope.ts');
        const {effectiveInstanceRoot}=require('${process.cwd()}/src/instance/resolve.ts');
        console.log(JSON.stringify({root:effectiveInstanceRoot(),scope:childInstanceScope()}));
      `;
      const result = spawnSync('bun', ['-e', script], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, HOME: home, MONAD_STATE_DIR: '', MONAD_CONFIG_DIR: '', MONAD_NEXUS_DIR: '', MONAD_SESSION_ROOT: '' },
      });
      expect(result.status).toBe(0);
      const out = JSON.parse((result.stdout ?? '').trim().split('\n').pop() ?? '{}') as { root: string; scope: { configDir?: string; stateDir?: string; monadBinRoot: string } };
      expect(out.root.endsWith('.monad-test')).toBe(true);
      expect(out.scope).toEqual({ configDir: out.root, stateDir: out.root, monadBinRoot: expect.any(String) });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);

  test('[prod] operational parent receives a resolver-derived isolated child scope by default', () => {
    const events: Array<{ event: string; data: Record<string, unknown>; warn?: boolean }> = [];
    const scope = childInstanceScope({
      effectiveRoot: () => '/prod',
      prodRoot: () => '/prod',
      derivedRoot: () => '/worktree/.monad-test',
      childInstanceMode: () => 'isolated',
      log: (event, data, warn) => events.push({ event, data, warn }),
    });
    // ⭐ 2026-08-19(`OBS-T121`): 파생 우주에는 ***「파생이다」라는 출처***가 «같이» 실린다 —
    //   그 딱지가 없으면 자식이 「사람이 말한 격리」로 읽어 바깥 계정 상태까지 그 우주에서 읽는다(429 5회).
    expect(scope).toEqual({ configDir: '/worktree/.monad-test', stateDir: '/worktree/.monad-test', monadBinRoot: expect.any(String), stateDirSource: 'derived' });
    expect(events).toEqual([expect.objectContaining({
      event: 'child-scope',
      data: expect.objectContaining({ parentIsProduction: true, mode: 'isolated', scope }),
    })]);
  });

  test('[prod] inheritance mode keeps the operational parent universe unpinned', () => {
    expect(childInstanceScope({
      effectiveRoot: () => '/prod',
      prodRoot: () => '/prod',
      childInstanceMode: () => 'inherit',
      derivedRoot: () => { throw new Error('must not derive while inheriting'); },
      log: () => {},
    })).toEqual({ monadBinRoot: expect.any(String) });
  });

  test('[non-prod] preserves the existing parent universe regardless of child mode', () => {
    expect(childInstanceScope({
      effectiveRoot: () => '/parent-test',
      prodRoot: () => '/prod',
      childInstanceMode: () => 'isolated',
      derivedRoot: () => { throw new Error('must not derive non-production parents'); },
      log: () => {},
    })).toEqual({ configDir: '/parent-test', stateDir: '/parent-test', monadBinRoot: expect.any(String) });
  });

  test('[failure] failed child-root derivation refuses an operational-universe spawn and logs the reason loudly', () => {
    const events: Array<{ event: string; data: Record<string, unknown>; warn?: boolean }> = [];
    expect(() => childInstanceScope({
      effectiveRoot: () => '/prod',
      prodRoot: () => '/prod',
      childInstanceMode: () => 'isolated',
      derivedRoot: () => { throw new Error('resolver unavailable'); },
      log: (event, data, warn) => events.push({ event, data, warn }),
    })).toThrow('unable to derive isolated child universe: resolver unavailable');
    expect(events).toEqual([expect.objectContaining({
      event: 'child-scope-failed',
      warn: true,
      data: expect.objectContaining({ parentIsProduction: true, mode: 'isolated', reason: 'resolver unavailable' }),
    })]);
  });

  test('[layer12] explicit config-dir and MONAD_STATE_DIR preserve their resolved root on both axes', () => {
    setTreeDerivedTestForTesting(false);
    setMonadConfigDir('/tmp/child-scope-explicit');
    expect(childInstanceScope()).toEqual({ configDir: '/tmp/child-scope-explicit', stateDir: '/tmp/child-scope-explicit', monadBinRoot: expect.any(String) });

    resetMonadConfigDir();
    resetEffectiveInstanceRoot();
    process.env.MONAD_STATE_DIR = '/tmp/child-scope-stamp';
    expect(childInstanceScope()).toEqual({ configDir: '/tmp/child-scope-stamp', stateDir: '/tmp/child-scope-stamp', monadBinRoot: expect.any(String) });
  });

  test('[runtime] default user config and resolver-derived production scope reach child spawn axes', () => {
    const home = mkdtempSync(join(tmpdir(), 'child-scope-runtime-home-'));
    try {
      mkdirSync(join(home, '.monad'));
      writeFileSync(join(home, '.monad', 'config.json'), JSON.stringify({
        tools: { selfImplement: { childInstanceMode: 'isolated' } },
      }));
      const script = `
        const { childInstanceScope } = require('${process.cwd()}/src/instance/child-scope.ts');
        const { defaultSeams } = require('${process.cwd()}/src/self-implement/seams.ts');
        (async () => {
          const scope = childInstanceScope();
          let argv = []; let env = {};
          await defaultSeams({ ...scope, ptyAvailable: () => false, implementMaxWaitSec: 1,
            spawnSync: (_command, args, options) => {
              argv = args; env = options?.env ?? {};
              return { status: 0, stdout: 'GOAL-COMPLETE\\n', stderr: '', signal: null };
            },
          }).implement({ cwd: process.cwd(), feature: 'noop', runId: 'child-scope-runtime' });
          console.log(JSON.stringify({ scope, argv, stateDir: env.MONAD_STATE_DIR }));
        })().catch((error) => { console.error(error); process.exit(1); });
      `;
      const result = spawnSync('bun', ['-e', script], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, HOME: home, MONAD_STATE_DIR: '', MONAD_CONFIG_DIR: '', MONAD_NEXUS_DIR: '', MONAD_SESSION_ROOT: '' },
      });
      expect(result.status).toBe(0);
      const out = JSON.parse((result.stdout ?? '').trim().split('\n').pop() ?? '{}') as {
        scope: { configDir?: string; stateDir?: string }; argv: string[]; stateDir?: string;
      };
      expect(out.scope.configDir).toBeDefined();
      expect(out.scope.stateDir).toBe(out.scope.configDir);
      expect(out.argv).toContain('--config-dir');
      expect(out.argv).toContain(out.scope.configDir!);
      expect(out.stateDir).toBe(out.scope.stateDir);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);

  test('[callsites] shared seam options reach the child argv and environment together', async () => {
    const root = '/tmp/child-scope-child';
    const spawned = await captureChildSpawn({ configDir: root, stateDir: root });
    expect(spawned.argv).toContain('--config-dir');
    expect(spawned.argv).toContain(root);
    expect(spawned.env.MONAD_STATE_DIR).toBe(root);
  });

  test('[mutation] inherited production scope does not activate explicitRoot on the child seam', async () => {
    const spawned = await captureChildSpawn(childInstanceScope({
      effectiveRoot: () => '/prod',
      prodRoot: () => '/prod',
      childInstanceMode: () => 'inherit',
      log: () => {},
    }));
    expect(spawned.argv).not.toContain('--config-dir');
    expect(spawned.env.MONAD_STATE_DIR).toBe(process.env.MONAD_STATE_DIR);
  });
});
