// ── PX-3 P6: agent-team Turn-hook dogfood ──
//
// Minimal test that the agent-team plugin's bg-task-warning hook
// reads from globalTaskNotificationQueue and injects a banner only
// when there's something to report.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { globalHookDispatcher } from '../src/plugin-hooks/dispatcher';
import { globalTaskNotificationQueue } from '../src/agent/task-notification';

// We don't want to boot the full plugin-host for this test — just
// import and register the hook handler by reaching into the plugin
// module's exports. Since plugin.ts exports the ElanousPlugin default
// + constructs the hook inline, we lift the hook inline here for
// isolation.

import type { TurnHookInput, TurnHookOutput } from '../src/plugin-hooks/events';

function buildBgTaskHook() {
  return {
    id: 'agent-team:bg-task-warning',
    event: 'Turn' as const,
    priority: 20,
    invoke(_input: TurnHookInput): TurnHookOutput {
      const n = globalTaskNotificationQueue.size;
      if (n === 0) return {};
      return {
        systemPromptInject:
          `🟡 ${n} background task(s) completed — see <task-notification> in the most recent user message.`,
      };
    },
  };
}

describe('agent-team bg-task-warning', () => {
  beforeEach(() => {
    globalHookDispatcher.clear();
    globalTaskNotificationQueue.clear();
  });

  afterEach(() => {
    globalHookDispatcher.clear();
    globalTaskNotificationQueue.clear();
  });

  test('empty queue → no injection', async () => {
    globalHookDispatcher.register(buildBgTaskHook());
    const r = await globalHookDispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.output.systemPromptInject).toBeUndefined();
  });

  test('1 pending task → banner with count 1', async () => {
    globalTaskNotificationQueue.enqueue({
      taskId: 't1', agentName: 'research', state: 'done',
      output: 'ok', truncated: false, durationMs: 100, finishedAt: Date.now(),
    });
    globalHookDispatcher.register(buildBgTaskHook());
    const r = await globalHookDispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.output.systemPromptInject).toContain('🟡');
    expect(r.output.systemPromptInject).toContain('1 background task');
  });

  test('3 pending tasks → banner with count 3', async () => {
    for (let i = 0; i < 3; i++) {
      globalTaskNotificationQueue.enqueue({
        taskId: `t${i}`, agentName: 'research', state: 'done',
        output: 'ok', truncated: false, durationMs: 100, finishedAt: Date.now(),
      });
    }
    globalHookDispatcher.register(buildBgTaskHook());
    const r = await globalHookDispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.output.systemPromptInject).toContain('3 background task');
  });
});
