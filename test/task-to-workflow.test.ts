// V2.2-7 (2026-05-11) — task-to-workflow helper coverage.
//
// Pure helper module — no IO, no daemon. Tests verify:
//   1. parseTaskScheduleText accepts cron + "every Xm/Xh" interval
//      and rejects one-shot / ISO timestamp shapes with a clear error.
//   2. surfaceToBodyNode maps every TaskSurface variant to a workflow
//      node — natural mapping for 4 (terminal-pane → bash, skill →
//      skill, llm-direct/subagent → prompt) + prompt fallback for the
//      others (chat-prompt, cron, vw-slot, acx-session).
//   3. taskToWorkflowEntry composes a 2-node WorkflowDefinition
//      (scheduleTrigger + body) with a deterministic workflow name.

import { describe, it, expect } from 'bun:test';
import {
  parseTaskScheduleText,
  promptFromTaskSurface,
  surfaceToBodyNode,
  taskToWorkflowEntry,
} from '../src/task-orchestrator/task-to-workflow.js';
import { createTask, type Task, type TaskSurface } from '../src/task-orchestrator/types.js';

function mkTask(surface: TaskSurface, overrides: Partial<{ title: string; description: string }> = {}): Task {
  return createTask({
    title: overrides.title ?? 'sample',
    description: overrides.description,
    surface,
  });
}

describe('parseTaskScheduleText', () => {
  it('5-field cron pattern parses as cron trigger', () => {
    const trigger = parseTaskScheduleText('0 9 * * *');
    expect(trigger).toEqual({ type: 'cron', cron: '0 9 * * *' });
  });

  it('cron with steps + ranges + lists is accepted', () => {
    const trigger = parseTaskScheduleText('*/5 9-17 * * 1,3,5');
    expect(trigger).toEqual({ type: 'cron', cron: '*/5 9-17 * * 1,3,5' });
  });

  it('"every 5m" parses to interval 300000 ms', () => {
    const trigger = parseTaskScheduleText('every 5m');
    expect(trigger).toEqual({ type: 'interval', interval: 5 * 60_000 });
  });

  it('"every 2h" parses to interval 7200000 ms', () => {
    const trigger = parseTaskScheduleText('every 2h');
    expect(trigger).toEqual({ type: 'interval', interval: 2 * 3_600_000 });
  });

  it('"every 1d" parses to interval 86400000 ms', () => {
    const trigger = parseTaskScheduleText('every 1d');
    expect(trigger).toEqual({ type: 'interval', interval: 86_400_000 });
  });

  it('trims surrounding whitespace', () => {
    const trigger = parseTaskScheduleText('   0 9 * * *   ');
    expect(trigger).toEqual({ type: 'cron', cron: '0 9 * * *' });
  });

  it('one-shot duration "30m" throws V2.2-7 v1 scope error', () => {
    expect(() => parseTaskScheduleText('30m')).toThrow(/one-shot schedule/);
  });

  it('ISO timestamp throws V2.2-7 v1 scope error', () => {
    expect(() => parseTaskScheduleText('2026-05-20T09:00:00')).toThrow(/one-shot schedule/);
  });

  it('empty input throws', () => {
    expect(() => parseTaskScheduleText('')).toThrow(/scheduleText is required/);
    expect(() => parseTaskScheduleText('   ')).toThrow(/scheduleText is required/);
  });

  it('invalid "every" duration throws', () => {
    expect(() => parseTaskScheduleText('every 0m')).toThrow(/invalid interval schedule/);
  });
});

describe('promptFromTaskSurface', () => {
  it('llm-direct → surface.prompt', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'do the thing' });
    expect(promptFromTaskSurface(t)).toBe('do the thing');
  });

  it('subagent → surface.prompt', () => {
    const t = mkTask({ kind: 'subagent', definitionName: 'reviewer', prompt: 'review please' });
    expect(promptFromTaskSurface(t)).toBe('review please');
  });

  it('acx-session → surface.prompt', () => {
    const t = mkTask({ kind: 'acx-session', sessionId: 'sid', agentBrand: 'claude-code', prompt: 'hi' });
    expect(promptFromTaskSurface(t)).toBe('hi');
  });

  it('skill → "Run skill: <name>" + description', () => {
    const t = mkTask({ kind: 'skill', skillName: 'omni-crawl' }, { description: 'fetch top tweets' });
    expect(promptFromTaskSurface(t)).toBe('Run skill: omni-crawl\nfetch top tweets');
  });

  it('chat-prompt → question.question', () => {
    const t = mkTask({
      kind: 'chat-prompt',
      question: { header: 'pick', question: 'A or B?', options: [{ label: 'A' }, { label: 'B' }] },
    });
    expect(promptFromTaskSurface(t)).toBe('A or B?');
  });

  it('terminal-pane → spec.command when set', () => {
    const t = mkTask({ kind: 'terminal-pane', spec: { command: 'bun run build' } });
    expect(promptFromTaskSurface(t)).toBe('bun run build');
  });

  it('terminal-pane → description fallback when command empty', () => {
    const t = mkTask({ kind: 'terminal-pane', spec: {} }, { description: 'no command set' });
    expect(promptFromTaskSurface(t)).toBe('no command set');
  });

  it('cron → description (or title)', () => {
    const t = mkTask({ kind: 'cron', scheduleText: '0 9 * * *' }, { description: 'daily report' });
    expect(promptFromTaskSurface(t)).toBe('daily report');
  });

  it('vw-slot → description', () => {
    const t = mkTask({ kind: 'vw-slot', windowId: 'w', slotId: 's' }, { title: 'slot task' });
    // description is omitted → title fallback
    expect(promptFromTaskSurface(t)).toBe('slot task');
  });
});

describe('surfaceToBodyNode', () => {
  it('terminal-pane with command emits bash node', () => {
    const t = mkTask({ kind: 'terminal-pane', spec: { command: 'echo hi' } });
    const node = surfaceToBodyNode(t);
    expect(node).toMatchObject({ id: 'body', depends_on: ['trigger'], bash: 'echo hi' });
  });

  it('terminal-pane without command falls back to prompt node', () => {
    const t = mkTask({ kind: 'terminal-pane', spec: {} }, { title: 'fallback' });
    const node = surfaceToBodyNode(t) as { prompt?: string };
    expect(node.prompt).toBe('fallback');
  });

  it('skill emits skill node with JSON arguments when args present', () => {
    const t = mkTask({ kind: 'skill', skillName: 'omni-crawl', args: { q: 'tweets' } });
    const node = surfaceToBodyNode(t);
    expect(node).toMatchObject({
      id: 'body',
      depends_on: ['trigger'],
      skill: 'omni-crawl',
      arguments: JSON.stringify({ q: 'tweets' }),
    });
  });

  it('skill emits skill node without arguments when args undefined', () => {
    const t = mkTask({ kind: 'skill', skillName: 'notify' });
    const node = surfaceToBodyNode(t);
    expect(node).toMatchObject({ id: 'body', skill: 'notify' });
    expect((node as unknown as { arguments?: unknown }).arguments).toBeUndefined();
  });

  it('llm-direct emits prompt node', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'summarize' });
    const node = surfaceToBodyNode(t);
    expect(node).toMatchObject({ id: 'body', depends_on: ['trigger'], prompt: 'summarize' });
  });

  it('subagent + acx-session + chat-prompt + cron + vw-slot all map to prompt fallback', () => {
    const cases: TaskSurface[] = [
      { kind: 'subagent', definitionName: 'r', prompt: 'sub-text' },
      { kind: 'acx-session', sessionId: 's', agentBrand: 'codex', prompt: 'acx-text' },
      { kind: 'chat-prompt', question: { header: 'h', question: 'chat-text', options: [{ label: 'a' }, { label: 'b' }] } },
      { kind: 'cron', scheduleText: '* * * * *' },
      { kind: 'vw-slot', windowId: 'w', slotId: 's' },
    ];
    for (const s of cases) {
      const node = surfaceToBodyNode(mkTask(s, { title: 'fallback' })) as { prompt?: string; bash?: string; skill?: string };
      expect(node.prompt).toBeDefined();
      expect(node.bash).toBeUndefined();
      expect(node.skill).toBeUndefined();
    }
  });
});

describe('taskToWorkflowEntry', () => {
  it('builds 2-node definition: scheduleTrigger + body', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'summarize daily' });
    const entry = taskToWorkflowEntry(t, '0 9 * * *');
    expect(entry.definition.nodes).toHaveLength(2);
    expect(entry.definition.nodes[0]!).toMatchObject({
      id: 'trigger',
      scheduleTrigger: { type: 'cron', cron: '0 9 * * *' },
    });
    expect(entry.definition.nodes[1]!).toMatchObject({
      id: 'body',
      depends_on: ['trigger'],
      prompt: 'summarize daily',
    });
  });

  it('workflow name is deterministic = `tox-task-<id>`', () => {
    const t = mkTask({ kind: 'skill', skillName: 'notify' });
    const entry = taskToWorkflowEntry(t, 'every 10m');
    expect(entry.definition.name).toBe(`tox-task-${t.id}`);
  });

  it('description preserved from task', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'p' }, { description: 'why this task' });
    const entry = taskToWorkflowEntry(t, '* * * * *');
    expect(entry.definition.description).toBe('why this task');
  });

  it('description fallback = title when task has no description', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'p' }, { title: 'just a title' });
    const entry = taskToWorkflowEntry(t, '* * * * *');
    expect(entry.definition.description).toBe('just a title');
  });

  it('interval schedule preserved in trigger node', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'p' });
    const entry = taskToWorkflowEntry(t, 'every 30m');
    const trigger = entry.definition.nodes[0]! as { scheduleTrigger: { type: string; interval: number } };
    expect(trigger.scheduleTrigger).toEqual({ type: 'interval', interval: 30 * 60_000 });
  });

  it('one-shot scheduleText throws (V2.2-7 v1 scope)', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'p' });
    expect(() => taskToWorkflowEntry(t, '30m')).toThrow(/one-shot schedule/);
  });

  it('source has marker path for in-memory TOX entry', () => {
    const t = mkTask({ kind: 'llm-direct', prompt: 'p' });
    const entry = taskToWorkflowEntry(t, '* * * * *');
    expect(entry.source.path).toBe(`<tox:${t.id}>`);
    expect(entry.source.source).toBe('global');
  });
});
