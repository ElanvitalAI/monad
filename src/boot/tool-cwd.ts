import { randomUUID } from 'node:crypto';
import { relative, resolve } from 'node:path';

import { debug } from '../debug/log.js';
import { createWorktree, resolveMainRepoRoot } from '../git-fs/worktree.js';
import { type InstanceKind } from '../instance/resolve.js';
import { resolveCurrentInstance } from '../instance/current.js';
import { configuredWorktreeRoot } from '../user-config.js';

/** 관측 payload 의 `source` 폐쇄 집합. ⛔ 경로 문자열은 **절대 싣지 않는다** —
 *  로그에 사용자 디렉토리가 남는다. 여기 있는 분류값만 나간다. */
type ToolCwdSource = 'explicit-flag' | 'env' | 'cwd-fallback' | 'write-worktree' | 'refused' | 'surface-none';

/** 판정 관측 단일 출구. `source` 를 `ToolCwdSource` 로 좁혀 두면 오타·새 값이
 *  **컴파일 에러**가 되므로, 분류값 밖의 문자열(특히 경로)이 로그로 샐 수 없다. */
function emitToolCwdDecision(
  event: 'resolved' | 'refused',
  isolated: boolean,
  source: ToolCwdSource,
): void {
  debug.log('tool-cwd.resolve', event, { isolated, source });
  if (event === 'refused') debug.flush();
}

interface ResolveToolCwdOpts {
  tools: string;
  toolCwd?: string;
}

interface ResolveToolCwdDeps {
  envToolCwd?: string | undefined;
  cwd?: string;
  instanceKind?: InstanceKind;
}

export interface ToolCwdResolver {
  readonly cwd: string | undefined;
  resolveWriteCwd(): string;
}

interface ToolCwdResolverDeps extends ResolveToolCwdDeps {
  createWorktree?: typeof createWorktree;
  resolveMainRepoRoot?: typeof resolveMainRepoRoot;
  configuredWorktreeRoot?: typeof configuredWorktreeRoot;
  branch?: () => string;
}

export function resolveToolCwd(
  opts: ResolveToolCwdOpts,
  deps: ResolveToolCwdDeps = {},
): string | undefined {
  const instanceKind = deps.instanceKind ?? resolveCurrentInstance().kind;
  const isolated = instanceKind === 'test';
  if (opts.tools === 'none') {
    emitToolCwdDecision('resolved', isolated, 'surface-none');
    return undefined;
  }

  if (opts.toolCwd !== undefined) {
    emitToolCwdDecision('resolved', isolated, 'explicit-flag');
    return opts.toolCwd;
  }

  const envToolCwd = 'envToolCwd' in deps
    ? deps.envToolCwd
    : process.env.MONAD_TOOL_CWD?.trim();
  if (envToolCwd !== undefined) {
    emitToolCwdDecision('resolved', isolated, 'env');
    return envToolCwd;
  }

  if (isolated) {
    emitToolCwdDecision('refused', isolated, 'refused');
    throw new Error('Isolated instance requires an explicit tool cwd; pass --tool-cwd <path> or set MONAD_TOOL_CWD.');
  }

  const cwd = deps.cwd ?? process.cwd();
  emitToolCwdDecision('resolved', isolated, 'cwd-fallback');
  return cwd;
}

/** Supplies the human checkout to read-only tools and lazily switches the
 * first production write to a separately managed worktree. */
export function createToolCwdResolver(
  opts: ResolveToolCwdOpts,
  deps: ToolCwdResolverDeps = {},
): ToolCwdResolver {
  const cwd = resolveToolCwd(opts, deps);
  const instanceKind = deps.instanceKind ?? resolveCurrentInstance().kind;
  const envToolCwd = 'envToolCwd' in deps
    ? deps.envToolCwd
    : process.env.MONAD_TOOL_CWD?.trim();
  const mayCreateWorktree = opts.tools !== 'none'
    && instanceKind !== 'test'
    && opts.toolCwd === undefined
    && envToolCwd === undefined;
  let writeCwd: string | undefined;

  return {
    cwd,
    resolveWriteCwd(): string {
      if (cwd === undefined) throw new Error('Tool surface has no working directory.');
      if (!mayCreateWorktree) return cwd;
      if (writeCwd !== undefined) return writeCwd;

      const repoRoot = (deps.resolveMainRepoRoot ?? resolveMainRepoRoot)(cwd);
      if (!repoRoot) throw new Error('Tool write requires a git repository working directory.');
      const result = (deps.createWorktree ?? createWorktree)({
        repoRoot,
        branch: (deps.branch ?? (() => `tool-write/${randomUUID()}`))(),
        worktreeRoot: (deps.configuredWorktreeRoot ?? configuredWorktreeRoot)(),
      });
      writeCwd = resolve(result.path, relative(repoRoot, cwd));
      emitToolCwdDecision('resolved', false, 'write-worktree');
      return writeCwd;
    },
  };
}
