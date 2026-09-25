// M4-4.2 (FU8 PR #1 · 2026-05-12) — pin executor seam tests.
//
// Verifies that `runWorkflow` short-circuits a node when a pin is
// set for the workflow + node id pair, and that downstream
// emit hooks (signal bus + intent log) fire for each pin hit.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkflowToCompletion } from '../src/workflow-runtime/executor';
import { setWorkflowPin } from '../src/workflow-runtime/pin-data';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir';
import { _resetSignalBus } from '../src/signal-bus/bus';
import { _resetUserIntentLogger } from '../src/user-intent/logger';
import type { WorkflowDefinition, WorkflowDeps } from '../src/workflow-runtime/types';
import type { SignalEnvelope } from '../src/signal-bus/types';
import type { UserIntentEvent } from '../src/user-intent/types';

let tmp: string;
let bashCalls: string[];
let promptCalls: string[];
let bus: ReturnType<typeof _resetSignalBus>;
let intent: ReturnType<typeof _resetUserIntentLogger>;
let intentEvents: UserIntentEvent[];

function makeDeps(): WorkflowDeps {
  return {
    callLLM: async ({ prompt }) => {
      promptCalls.push(prompt);
      return 'LLM-real-response';
    },
    runBash: async (body) => {
      bashCalls.push(body);
      return { stdout: 'bash-real-output', stderr: '', exitCode: 0 };
    },
    runSkill: async () => 'unused',
    runCft: async () => ({ ok: false, error: 'unused' }) as never,
    requestApproval: async () => 'approved',
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wf-pin-seam-'));
  setMonadConfigDir(tmp);
  bashCalls = [];
  promptCalls = [];
  bus = _resetSignalBus();
  intent = _resetUserIntentLogger();
  intentEvents = [];
  intent.setSinks([{ name: 'capture', write: (ev) => { intentEvents.push(ev); } }]);
});

afterEach(() => {
  resetMonadConfigDir();
  _resetSignalBus();
  _resetUserIntentLogger();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

const WF: WorkflowDefinition = {
  name: 'pin-seam-wf',
  description: 'M4-4.2 seam fixture',
  nodes: [
    { id: 'b', bash: 'echo hi' },
    { id: 'p', prompt: 'summarize', depends_on: ['b'] },
  ] as never,
};

describe('M4-4.2 pin executor seam', () => {
  test('no pin → real bash + LLM both fire (baseline)', async () => {
    const r = await runWorkflowToCompletion(
      { workflow: WF, arguments: '', artifactsDir: join(tmp, 'artifacts') },
      makeDeps(),
    );
    expect(r.ok).toBe(true);
    expect(bashCalls).toHaveLength(1);
    expect(promptCalls).toHaveLength(1);
    expect(typeof r.outputs.b?.output).toBe('string');
    expect(r.outputs.p?.output).toBe('LLM-real-response');
  });

  test('pin on the bash node returns pin.value · skips bash · LLM still real', async () => {
    setWorkflowPin('pin-seam-wf', 'b', 'frozen-bash-stdout', { note: 'fast iter' });
    const r = await runWorkflowToCompletion(
      { workflow: WF, arguments: '', artifactsDir: join(tmp, 'artifacts') },
      makeDeps(),
    );
    expect(r.ok).toBe(true);
    expect(bashCalls).toHaveLength(0);
    expect(promptCalls).toHaveLength(1);
    expect(r.outputs.b?.output).toBe('frozen-bash-stdout');
    expect(r.outputs.p?.output).toBe('LLM-real-response');
  });

  test('pin on every node returns pin.value · skips all real calls', async () => {
    setWorkflowPin('pin-seam-wf', 'b', 'frozen-b');
    setWorkflowPin('pin-seam-wf', 'p', 'frozen-p');
    const r = await runWorkflowToCompletion(
      { workflow: WF, arguments: '', artifactsDir: join(tmp, 'artifacts') },
      makeDeps(),
    );
    expect(r.ok).toBe(true);
    expect(bashCalls).toHaveLength(0);
    expect(promptCalls).toHaveLength(0);
    expect(r.outputs.b?.output).toBe('frozen-b');
    expect(r.outputs.p?.output).toBe('frozen-p');
  });

  test('pin emits Signal Bus + intent log (reference 3-sink fan-out)', async () => {
    setWorkflowPin('pin-seam-wf', 'b', 'frozen-b', { note: 'observability' });
    const captured: SignalEnvelope[] = [];
    bus.subscribe({ sourceGlob: 'workflow.*', minTier: 'info', handler: (e) => { captured.push(e); } });
    await runWorkflowToCompletion(
      { workflow: WF, arguments: '', artifactsDir: join(tmp, 'artifacts') },
      makeDeps(),
    );
    expect(captured.map((s) => s.source)).toContain('workflow.pin_used');
    expect(intentEvents.map((e) => e.intent.kind)).toContain('system.workflow.pin_used');
    const pinIntent = intentEvents.find((e) => e.intent.kind === 'system.workflow.pin_used');
    expect(pinIntent?.intent.target).toEqual({ kind: 'workflow', id: 'pin-seam-wf' });
  });

  test('pin returns structured JSON object (not just strings)', async () => {
    setWorkflowPin('pin-seam-wf', 'b', { kind: 'json', items: [1, 2, 3] });
    const r = await runWorkflowToCompletion(
      { workflow: WF, arguments: '', artifactsDir: join(tmp, 'artifacts') },
      makeDeps(),
    );
    expect(r.outputs.b?.output).toEqual({ kind: 'json', items: [1, 2, 3] });
  });
});
