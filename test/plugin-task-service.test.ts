import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExecutionHistoryStore } from '../src/execution-history.js';
import { PluginTaskService, taskToExecutionSpec } from '../src/plugins/core/task-service.js';
import type { PluginTaskContribution } from '../src/plugins/core/manifest.js';

const task: PluginTaskContribution = {
  id: 'demo.test',
  label: 'Demo Test',
  command: 'python3',
  args: ['${plugin}/scripts/test.py', '${workspace}', 'hello world'],
  cwd: '${workspace}',
  reveal: 'always',
};

describe('PluginTaskService', () => {
  test('interpolates task variables into an execution spec', () => {
    const spec = taskToExecutionSpec(task, {
      pluginId: 'demo',
      pluginDir: '/plugins/demo',
      workspaceDir: '/workspace',
    });

    expect(spec).toMatchObject({
      id: 'execution:demo:demo.test',
      mode: 'pty',
      cwd: '/workspace',
      title: 'Demo Test',
      placement: 'preview',
      focus: true,
    });
    expect(spec.command).toBe("python3 /plugins/demo/scripts/test.py /workspace 'hello world'");
  });

  test('runs a task through execution surface and blocks concurrent reruns by default', async () => {
    const starts: string[] = [];
    const service = new PluginTaskService();
    service.registerPluginTasks([task], {
      pluginId: 'demo',
      pluginDir: '/plugins/demo',
      workspaceDir: '/workspace',
      execution: {
        spawn: (spec) => ({
          id: spec.id ?? 'execution:test',
          surface: { id: spec.id ?? 'execution:test', kind: 'execution', owner: 'plugin:demo', focus: 'owns', priority: 0, render: () => [] },
          terminal: { start: () => {}, stop: () => {}, resize: () => {}, write: () => {}, render: () => '', isAlive: true },
          start: () => { starts.push(spec.command ?? ''); },
          stop: () => {},
          resize: () => {},
          write: () => {},
          render: () => [],
          dispose: () => {},
        }),
      },
    });

    await service.run('demo.test', {}, 'demo');
    await expect(service.run('demo.test', {}, 'demo')).rejects.toThrow(/already running/);
    expect(starts).toEqual(["python3 /plugins/demo/scripts/test.py /workspace 'hello world'"]);
  });

  test('records, cancels, and reruns execution history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-execution-history-'));
    try {
      const starts: string[] = [];
      const stops: string[] = [];
      const service = new PluginTaskService(new ExecutionHistoryStore(join(root, 'history.json')));
      service.registerPluginTasks([task], {
        pluginId: 'demo',
        pluginDir: '/plugins/demo',
        workspaceDir: '/workspace',
        execution: {
          spawn: (spec) => ({
            id: spec.id ?? 'execution:test',
            surface: { id: spec.id ?? 'execution:test', kind: 'execution', owner: 'plugin:demo', focus: 'owns', priority: 0, render: () => [] },
            terminal: { start: () => {}, stop: () => {}, resize: () => {}, write: () => {}, render: () => '', isAlive: true },
            start: () => { starts.push(spec.command ?? ''); },
            stop: () => { stops.push(spec.command ?? ''); },
            resize: () => {},
            write: () => {},
            render: () => [],
            dispose: () => {},
          }),
        },
      });

      await service.run('demo.test', {}, 'demo');
      const [record] = service.executionList();
      expect(record?.status).toBe('active');
      expect(record?.spec.command).toBe("python3 /plugins/demo/scripts/test.py /workspace 'hello world'");

      const cancelled = service.executionCancel(record!.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.durationMs).toBeGreaterThanOrEqual(0);
      expect(stops).toHaveLength(1);

      await service.executionRerun(record!.id);
      expect(starts).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
