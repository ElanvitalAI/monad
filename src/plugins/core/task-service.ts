import { join } from 'path';
import type { ExecutionSurfaceHandle, ExecutionSurfaceSpec } from '../../display/index.js';
import { ExecutionHistoryStore, type ExecutionHistoryRecord } from '../../execution-history.js';
import type { PluginTaskContribution } from './manifest.js';

export interface PluginTaskRuntime {
  pluginId: string;
  pluginDir: string;
  workspaceDir: string;
  execution?: {
    spawn(spec: ExecutionSurfaceSpec): ExecutionSurfaceHandle | Promise<ExecutionSurfaceHandle>;
  };
}

export interface PluginTaskRunOptions {
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  focus?: boolean;
  placement?: ExecutionSurfaceSpec['placement'];
  reveal?: PluginTaskContribution['reveal'];
}

export class PluginTaskService {
  private tasks = new Map<string, { task: PluginTaskContribution; runtime: PluginTaskRuntime }>();
  private activeRuns = new Map<string, ExecutionSurfaceHandle>();
  private runRecords = new Map<string, string>();

  constructor(private readonly history = new ExecutionHistoryStore()) {}

  registerPluginTasks(tasks: PluginTaskContribution[], runtime: PluginTaskRuntime): { dispose(): void } {
    const ids: string[] = [];
    for (const task of tasks) {
      const key = scopedTaskId(runtime.pluginId, task.id);
      this.tasks.set(key, { task, runtime });
      ids.push(key);
    }
    return {
      dispose: () => {
        for (const id of ids) {
          const handle = this.activeRuns.get(id);
          if (handle) handle.dispose();
          this.activeRuns.delete(id);
          this.tasks.delete(id);
        }
      },
    };
  }

  list(pluginId?: string): PluginTaskContribution[] {
    return [...this.tasks.entries()]
      .filter(([id]) => !pluginId || id.startsWith(`${pluginId}:`))
      .map(([, entry]) => entry.task)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string, pluginId?: string): PluginTaskContribution | undefined {
    return this.resolve(id, pluginId)?.task;
  }

  async run(id: string, opts: PluginTaskRunOptions = {}, pluginId?: string): Promise<ExecutionSurfaceHandle> {
    const entry = this.resolve(id, pluginId);
    if (!entry) throw new Error(`plugin task not found: ${id}`);
    if (!entry.runtime.execution) throw new Error(`plugin task "${id}" requires execution service`);

    const key = scopedTaskId(entry.runtime.pluginId, entry.task.id);
    const previous = this.activeRuns.get(key);
    if (previous?.terminal.isAlive && entry.task.allowConcurrentRuns !== true) {
      throw new Error(`plugin task "${entry.task.id}" is already running`);
    }

    const spec = taskToExecutionSpec(entry.task, entry.runtime, opts);
    const record = this.history.start({
      pluginId: entry.runtime.pluginId,
      taskId: entry.task.id,
      spec,
    });
    const handle = await entry.runtime.execution.spawn(spec);
    this.activeRuns.set(key, handle);
    this.runRecords.set(record.id, key);
    handle.start();
    return handle;
  }

  executionList(limit = 50): ExecutionHistoryRecord[] {
    return this.history.list(limit);
  }

  executionGet(id: string): ExecutionHistoryRecord | null {
    return this.history.get(id);
  }

  executionCancel(id: string): ExecutionHistoryRecord {
    const record = this.history.get(id);
    if (!record) throw new Error(`execution record not found: ${id}`);
    const key = this.runRecords.get(id);
    const handle = key ? this.activeRuns.get(key) : undefined;
    if (handle?.terminal.isAlive) handle.stop();
    if (key) this.activeRuns.delete(key);
    return this.history.finish(id, 'cancelled');
  }

  async executionRerun(id: string): Promise<ExecutionSurfaceHandle> {
    const record = this.history.get(id);
    if (!record?.taskId) throw new Error(`execution record not found or not rerunnable: ${id}`);
    return this.run(record.taskId, {}, record.pluginId);
  }

  private resolve(id: string, pluginId?: string): { task: PluginTaskContribution; runtime: PluginTaskRuntime } | undefined {
    if (pluginId) return this.tasks.get(scopedTaskId(pluginId, id));
    if (this.tasks.has(id)) return this.tasks.get(id);
    const matches = [...this.tasks.entries()].filter(([key, entry]) => key.endsWith(`:${id}`) || entry.task.id === id);
    return matches.length === 1 ? matches[0]![1] : undefined;
  }
}

export function taskToExecutionSpec(
  task: PluginTaskContribution,
  runtime: PluginTaskRuntime,
  opts: PluginTaskRunOptions = {},
): ExecutionSurfaceSpec {
  const vars = {
    plugin: runtime.pluginDir,
    workspace: runtime.workspaceDir,
  };
  const cwd = interpolate(opts.cwd ?? task.cwd ?? '${workspace}', vars);
  const args = [...(task.args ?? []), ...(opts.args ?? [])].map(arg => interpolate(arg, vars));
  const command = [interpolate(task.command, vars), ...args.map(shellQuote)].join(' ').trim();
  return {
    id: `execution:${runtime.pluginId}:${task.id}`,
    mode: executionModeForTask(task),
    title: task.label ?? task.id,
    cwd,
    command,
    env: { ...(task.env ?? {}), ...(opts.env ?? {}) },
    focus: opts.focus ?? ((opts.reveal ?? task.reveal ?? 'always') === 'always'),
    placement: opts.placement ?? task.placement ?? 'preview',
  };
}

function executionModeForTask(task: PluginTaskContribution): ExecutionSurfaceSpec['mode'] {
  if (task.kind === 'background') {
    throw new Error(`plugin task "${task.id}" uses unsupported background execution`);
  }
  return task.kind ?? 'pty';
}

function scopedTaskId(pluginId: string, taskId: string): string {
  return `${pluginId}:${taskId}`;
}

function interpolate(value: string, vars: { plugin: string; workspace: string }): string {
  return value
    .replace(/\$\{plugin\}/g, vars.plugin)
    .replace(/\$\{workspace\}/g, vars.workspace)
    .replace(/\$\{plugin:([^}]+)\}/g, (_m, rel) => join(vars.plugin, rel));
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
