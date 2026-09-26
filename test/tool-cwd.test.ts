import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { debug } from '../src/debug/log.js';
import { toolSurface } from '../src/boot/daemon-tools/index.js';
import { createToolCwdResolver, resolveToolCwd } from '../src/boot/tool-cwd.js';

describe('resolveToolCwd', () => {
  test('refuses an isolated instance with tools and no explicit tool cwd', () => {
    expect(() => resolveToolCwd(
      { tools: 'readonly' },
      { instanceKind: 'test', envToolCwd: undefined, cwd: '/repo' },
    )).toThrow('--tool-cwd <path> or set ELANOUS_TOOL_CWD');
  });

  test('flushes the refused decision before throwing in an isolated instance', () => {
    const order: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category === 'tool-cwd.resolve' && event === 'refused') order.push('refused');
    }) as typeof debug.log);
    const flush = spyOn(debug, 'flush').mockImplementation(() => {
      order.push('flush');
    });
    try {
      expect(() => resolveToolCwd(
        { tools: 'readonly' },
        { instanceKind: 'test', envToolCwd: undefined, cwd: '/repo' },
      )).toThrow('--tool-cwd <path> or set ELANOUS_TOOL_CWD');
      expect(order).toEqual(['refused', 'flush']);
    } finally {
      flush.mockRestore();
      log.mockRestore();
    }
  });

  test('uses the exact explicit tool cwd in an isolated instance without reading process cwd', () => {
    const cwd = spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('process.cwd must not run');
    });
    try {
      expect(resolveToolCwd(
        { tools: 'readonly', toolCwd: '/explicit-repo' },
        { instanceKind: 'test', envToolCwd: undefined },
      )).toBe('/explicit-repo');
      expect(cwd).toHaveBeenCalledTimes(0);
    } finally {
      cwd.mockRestore();
    }
  });

  test('uses the exact environment tool cwd in an isolated instance without reading process cwd', () => {
    const cwd = spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('process.cwd must not run');
    });
    try {
      expect(resolveToolCwd(
        { tools: 'readonly' },
        { instanceKind: 'test', envToolCwd: '/env-repo' },
      )).toBe('/env-repo');
      expect(cwd).toHaveBeenCalledTimes(0);
    } finally {
      cwd.mockRestore();
    }
  });

  test('returns undefined when the tool surface is none in an isolated instance', () => {
    expect(resolveToolCwd(
      { tools: 'none' },
      { instanceKind: 'test', envToolCwd: undefined, cwd: '/repo' },
    )).toBe(undefined);
  });

  test('uses the exact process cwd fallback in a non-isolated instance', () => {
    expect(resolveToolCwd(
      { tools: 'webterm' },
      { instanceKind: 'prod', cwd: '/production-repo' },
    )).toBe('/production-repo');
  });

  // 수용 기준 2 — payload 에 경로가 실리면 사용자 디렉토리가 로그에 남는다.
  // 값 집합까지 정확값으로 고정해 두면 새 분기가 분류값을 안 늘리고 경로를
  // 흘리는 회귀가 이 테스트에서 잡힌다.
  test('emits only the source classification — never a path — for every branch', () => {
    const calls: Array<{ event: string; data: unknown }> = [];
    const log = spyOn(debug, 'log').mockImplementation(
      ((category: string, event: string, data?: unknown) => {
        if (category === 'tool-cwd.resolve') calls.push({ event, data });
      }) as typeof debug.log,
    );
    try {
      resolveToolCwd({ tools: 'none' }, { instanceKind: 'test', envToolCwd: undefined });
      resolveToolCwd(
        { tools: 'readonly', toolCwd: '/explicit-repo' },
        { instanceKind: 'test', envToolCwd: undefined },
      );
      resolveToolCwd({ tools: 'readonly' }, { instanceKind: 'test', envToolCwd: '/env-repo' });
      resolveToolCwd({ tools: 'webterm' }, { instanceKind: 'prod', cwd: '/production-repo' });
      expect(() => resolveToolCwd(
        { tools: 'readonly' },
        { instanceKind: 'test', envToolCwd: undefined, cwd: '/repo' },
      )).toThrow();
    } finally {
      log.mockRestore();
    }

    expect(calls.map((c) => c.event)).toEqual([
      'resolved', 'resolved', 'resolved', 'resolved', 'refused',
    ]);
    expect(calls.map((c) => (c.data as { source: string }).source)).toEqual([
      'surface-none', 'explicit-flag', 'env', 'cwd-fallback', 'refused',
    ]);
    for (const call of calls) {
      expect(Object.keys(call.data as object).sort()).toEqual(['isolated', 'source']);
      expect(JSON.stringify(call.data)).not.toContain('/');
    }
  });

  test('keeps reads in the human checkout and sends Write through one lazy worktree transition', async () => {
    const humanRoot = mkdtempSync(join(tmpdir(), 'tool-cwd-human-'));
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'tool-cwd-worktree-'));
    const worktree = mkdtempSync(join(tmpdir(), 'tool-cwd-target-'));
    const events: unknown[] = [];
    const log = spyOn(debug, 'log').mockImplementation(
      ((category: string, _event: string, data?: unknown) => {
        if (category === 'tool-cwd.resolve') events.push(data);
      }) as typeof debug.log,
    );
    try {
      const humanCwd = join(humanRoot, 'packages', 'feature');
      const worktreeCwd = join(worktree, 'packages', 'feature');
      mkdirSync(humanCwd, { recursive: true });
      mkdirSync(worktreeCwd, { recursive: true });
      writeFileSync(join(humanCwd, 'read.txt'), 'human content', 'utf8');
      let creates = 0;
      const resolver = createToolCwdResolver(
        { tools: 'chat' },
        {
          cwd: humanCwd,
          instanceKind: 'prod',
          resolveMainRepoRoot: () => humanRoot,
          configuredWorktreeRoot: () => worktreeRoot,
          createWorktree: () => {
            creates++;
            return { path: worktree, branch: 'tool-write/test', base: 'HEAD', resolvedBase: 'test', baseFreshness: 'head' };
          },
        },
      );
      const surface = toolSurface('chat');
      const ctx = {
        cwd: resolver.cwd!,
        resolveWriteCwd: resolver.resolveWriteCwd,
        signal: new AbortController().signal,
      };

      const read = await surface.dispatch('Read', { file_path: 'read.txt' }, ctx) as { content: string };
      await surface.dispatch('Write', { file_path: 'written.txt', content: 'worktree content' }, ctx);

      expect(read.content).toContain('human content');
      expect(creates).toBe(1);
      expect(existsSync(join(humanCwd, 'written.txt'))).toBe(false);
      expect(readFileSync(join(worktreeCwd, 'written.txt'), 'utf8')).toBe('worktree content');
      expect(events).toContainEqual({ isolated: false, source: 'write-worktree' });
      for (const event of events) expect(JSON.stringify(event)).not.toContain(worktree);
    } finally {
      log.mockRestore();
      rmSync(humanRoot, { recursive: true, force: true });
      rmSync(worktreeRoot, { recursive: true, force: true });
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});
