import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchAgent } from '../src/skills/tools/agent.js';
import { globalAgentRegistry } from '../src/agent/registry.js';
import type { AgentDefinition } from '../src/agent/types.js';
import type { LLMProvider } from '../src/llm.js';
import { debug } from '../src/debug/log.js';
import { __resetSessionWorkingDir, setSessionCwd } from '../src/session/working-dir.js';
import { enterWorktreeRuntime } from '../src/tool-runtime/git-worktree-runtimes.js';

let worktreeRun: (req: { name: string }) => Promise<{ path: string; branch: string }>;
let restoreWorktreeRunSpy = () => {};

const definition: AgentDefinition = {
  name: 'worker',
  systemPrompt: 'work',
};

function provider(): LLMProvider {
  return {
    name: 'fake',
    defaultModel: 'fake',
    available: () => true,
    async *streamChat() {
      yield { type: 'text', delta: 'completed' };
    },
    async *chat() {
      yield 'completed';
    },
  };
}

function args(isolation?: 'worktree' | 'cwd') {
  return {
    description: 'isolated worker',
    prompt: 'complete the task',
    subagent_type: 'worker',
    ...(isolation ? { isolation } : {}),
  };
}

function opts() {
  return {
    provider: provider(),
    resolveAgentDef: (name: string) => name === 'worker' ? definition : undefined,
  };
}

beforeEach(() => {
  const worktreeRunSpy = spyOn(enterWorktreeRuntime, 'run').mockImplementation(req => (
    worktreeRun({ name: String(req.name ?? '') }) as ReturnType<typeof enterWorktreeRuntime.run>
  ));
  restoreWorktreeRunSpy = () => worktreeRunSpy.mockRestore();
  globalAgentRegistry.clear();
  debug.enable();
  debug.clear();
});

afterEach(() => {
  restoreWorktreeRunSpy();
  globalAgentRegistry.clear();
  __resetSessionWorkingDir();
  debug.disable();
});

describe('dispatchAgent worktree isolation', () => {
  test('inherits the session cwd without reporting isolation', async () => {
    const sessionCwd = mkdtempSync(join(tmpdir(), 'agent-inherited-cwd-'));
    setSessionCwd(sessionCwd, 'tool');

    try {
      const result = await dispatchAgent(args(), opts());
      const task = globalAgentRegistry.get(result.taskId);

      expect(result.cwd).toBe(sessionCwd);
      expect(result.isolation).toBeUndefined();
      expect(task?.cwd).toBe(sessionCwd);
      expect(debug.tail(20).join('\n')).toContain('[agent.spawn] inherited-cwd');
    } finally {
      rmSync(sessionCwd, { recursive: true, force: true });
    }
  });

  test('falls back to the non-git session cwd and reports cwd isolation', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'agent-non-git-'));
    setSessionCwd(nonGitCwd, 'tool');
    worktreeRun = async () => {
      throw new Error(`EnterWorktree: session cwd ${nonGitCwd} is not inside a git repo`);
    };

    try {
      const result = await dispatchAgent(args('worktree'), opts());
      const task = globalAgentRegistry.get(result.taskId);

      expect(result.output).toBe('completed');
      expect(result.cwd).toBe(nonGitCwd);
      expect(result.isolation).toBe('cwd');
      expect(task?.cwd).toBe(nonGitCwd);
      expect(debug.tail(20).join('\n')).toContain('[agent.spawn] worktree-fallback-cwd');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  test('preserves worktree cwd and reports worktree isolation when creation succeeds', async () => {
    const worktreeCwd = '/tmp/agent-created-worktree';
    worktreeRun = async (req) => {
      expect(req.name).toMatch(/^worker-[a-f0-9]{8}$/);
      return { path: worktreeCwd, branch: `agent/${req.name}` };
    };

    const result = await dispatchAgent(args('worktree'), opts());
    const task = globalAgentRegistry.get(result.taskId);

    expect(result.cwd).toBe(worktreeCwd);
    expect(result.isolation).toBe('worktree');
    expect(task?.cwd).toBe(worktreeCwd);
    expect(debug.tail(20).join('\n')).toContain('[agent.spawn] worktree');
  });

  test('preserves explicit cwd isolation without entering a worktree', async () => {
    const sessionCwd = mkdtempSync(join(tmpdir(), 'agent-cwd-'));
    setSessionCwd(sessionCwd, 'tool');
    let enteredWorktree = false;
    worktreeRun = async () => {
      enteredWorktree = true;
      return { path: '/tmp/unexpected-worktree', branch: 'unexpected' };
    };

    try {
      const result = await dispatchAgent(args('cwd'), opts());
      const task = globalAgentRegistry.get(result.taskId);

      expect(enteredWorktree).toBe(false);
      expect(result.cwd).toBe(sessionCwd);
      expect(result.isolation).toBe('cwd');
      expect(task?.cwd).toBe(sessionCwd);
    } finally {
      rmSync(sessionCwd, { recursive: true, force: true });
    }
  });

  test('propagates worktree failures other than a non-git session cwd', async () => {
    worktreeRun = async () => {
      throw new Error('EnterWorktree: branch already exists');
    };

    await expect(dispatchAgent(args('worktree'), opts())).rejects.toThrow('EnterWorktree: branch already exists');
  });
});
