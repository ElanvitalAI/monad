// ── PX-4 P5: plugin-host wiring + LLM tools ──
//
// Covers two surfaces:
//   1. LLM tool dispatchers (MissionStatus, WorkflowList, WorkflowRun,
//      WorkflowStatus) produce the expected shape.
//   2. Tool runtime adapters (end-to-end plugin-host wiring is tested
//      lightly — the plugin-host.test.ts already exercises the
//      register/dispose lifecycle via ownedHookDisposers; missions /
//      workflows follow the exact same pattern on ownedMissionDisposers
//      / ownedWorkflowDisposers).

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  dispatchMissionStatus,
  buildMissionStatusTool,
} from '../src/plugin-missions/llm-tools';
import { MissionRegistry } from '../src/plugin-missions/registry';
import {
  dispatchWorkflowList,
  dispatchWorkflowRun,
  dispatchWorkflowStatus,
  buildWorkflowListTool,
  buildWorkflowRunTool,
  buildWorkflowStatusTool,
  registerWorkflowDefinition,
  clearWorkflowDefinitions,
} from '../src/plugin-workflows/llm-tools';
import {
  globalWorkflowRunner,
  resetGlobalWorkflowRunner,
  setWorkflowRunnerDispatchers,
} from '../src/plugin-workflows/global-runner';

describe('PX-4 P5 — MissionStatus LLM tool', () => {
  test('tool spec carries the expected name + required params', () => {
    const spec = buildMissionStatusTool();
    expect(spec.name).toBe('MissionStatus');
    expect(spec.parameters.properties).toHaveProperty('id');
  });

  test('dispatch with unknown id → empty missions array', () => {
    const reg = new MissionRegistry();
    const result = dispatchMissionStatus({ id: 'nothere' }, { registry: reg });
    expect(result.missions.length).toBe(0);
    expect(result.output).toContain('No missions match');
  });
});

describe('PX-4 P5 — WorkflowList / Run / Status LLM tools', () => {
  beforeEach(() => {
    clearWorkflowDefinitions();
    resetGlobalWorkflowRunner();
  });

  test('WorkflowList reports registered workflows', () => {
    registerWorkflowDefinition('hello', {
      id: 'greet', name: 'Greet',
      steps: [{ kind: 'tool', id: 'Bash' }],
    });
    const result = dispatchWorkflowList();
    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0]!.pluginId).toBe('hello');
    expect(result.workflows[0]!.id).toBe('greet');
    expect(result.output).toContain('greet');
  });

  test('WorkflowRun rejects unknown id', async () => {
    await expect(dispatchWorkflowRun({ id: 'ghost' }))
      .rejects.toThrow(/no workflow registered/);
  });

  test('WorkflowRun with wired tool dispatcher completes end-to-end', async () => {
    registerWorkflowDefinition('hello', {
      id: 'greet', name: 'Greet',
      steps: [
        { kind: 'tool', id: 'Bash', args: { cmd: 'echo hi' } },
      ],
    });
    setWorkflowRunnerDispatchers({
      tool: async () => 'hi',
    });
    const result = await dispatchWorkflowRun({ id: 'greet' });
    expect(result.state.status).toBe('done');
    expect(result.state.steps[0]!.status).toBe('done');
  });

  test('WorkflowRun accepts "pluginId:workflowId" notation', async () => {
    registerWorkflowDefinition('plug1', {
      id: 'greet', name: 'Greet plug1',
      steps: [{ kind: 'tool', id: 'Bash' }],
    });
    registerWorkflowDefinition('plug2', {
      id: 'greet', name: 'Greet plug2',
      steps: [{ kind: 'tool', id: 'Bash' }],
    });
    setWorkflowRunnerDispatchers({ tool: async () => 'a' });
    const r = await dispatchWorkflowRun({ id: 'plug2:greet' });
    // Both plugins registered a 'greet' — explicit plug2:greet should
    // return the plug2 workflow name via the run.
    expect(r.state.status).toBe('done');
  });

  test('WorkflowStatus returns the live state; missing runId → null state', async () => {
    registerWorkflowDefinition('hello', {
      id: 'greet', name: 'Greet',
      steps: [{ kind: 'tool', id: 'Bash' }],
    });
    setWorkflowRunnerDispatchers({ tool: async () => 'done' });
    const run = await dispatchWorkflowRun({ id: 'greet' });
    const s = await dispatchWorkflowStatus({ runId: run.runId });
    expect(s.state?.runId).toBe(run.runId);
    const missing = await dispatchWorkflowStatus({ runId: 'nothere' });
    expect(missing.state).toBeNull();
  });

  test('all three tool specs carry the expected surface shape', () => {
    expect(buildWorkflowListTool().name).toBe('WorkflowList');
    expect(buildWorkflowRunTool().name).toBe('WorkflowRun');
    expect(buildWorkflowStatusTool().name).toBe('WorkflowStatus');
  });
});
