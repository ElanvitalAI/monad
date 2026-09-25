// Node-catalog N4.1 + N4.2 (2026-05-11) — Schedule + Webhook triggers.
//
// v1 = schema + pass-through executor. Daemon-side cron / dynamic
// HTTP route registration is deferred to a follow-up; the tests here
// pin the schema validation and pass-through output shape so the
// workflow round-trips through validate → run → outputs even before
// the daemon side lands.

import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runWorkflowToCompletion,
  type WorkflowDeps,
  type WorkflowDefinition,
} from '../src/workflow-runtime/index.js';
import { validateWorkflow } from '../src/workflow-runtime/schema.js';

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-trig-test-'));
}

function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async () => '',
    runBash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    ...over,
  };
}

describe('schema · scheduleTrigger', () => {
  it('accepts cron type with a cron string', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 't', scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } }],
    });
    expect(r.ok).toBe(true);
  });

  it('accepts interval type with positive ms', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 't', scheduleTrigger: { type: 'interval', interval: 60_000 } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown type', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 't', scheduleTrigger: { type: 'manual' } }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects cron type without cron string', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 't', scheduleTrigger: { type: 'cron' } }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects interval type with zero or negative interval', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 't', scheduleTrigger: { type: 'interval', interval: -1 } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe('schema · webhookTrigger', () => {
  it('accepts well-formed webhook', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 'wh', webhookTrigger: { method: 'POST', path: '/hooks/x' } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects non-leading-slash path', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 'wh', webhookTrigger: { method: 'POST', path: 'hooks/x' } }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown method', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{ id: 'wh', webhookTrigger: { method: 'WAT', path: '/hooks/x' } }],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts bearer auth', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{
        id: 'wh',
        webhookTrigger: {
          method: 'POST', path: '/hooks/x',
          auth: { type: 'bearer', token: 'abc' },
        },
      }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects bad auth.type', () => {
    const r = validateWorkflow({
      name: 'demo', description: 'd',
      nodes: [{
        id: 'wh',
        webhookTrigger: {
          method: 'POST', path: '/hooks/x',
          auth: { type: 'oauth' },
        },
      }],
    });
    expect(r.ok).toBe(false);
  });
});

describe('executor · pass-through trigger nodes', () => {
  it('scheduleTrigger emits the descriptor as output', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo', description: 'd',
      nodes: [{ id: 't', scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } }],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['t']?.output).toEqual({
      kind: 'schedule', type: 'cron', cron: '0 9 * * *',
    });
  });

  it('webhookTrigger emits the descriptor (auth.type only, no secrets)', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo', description: 'd',
      nodes: [{
        id: 'wh',
        webhookTrigger: {
          method: 'POST', path: '/hooks/x',
          auth: { type: 'bearer', token: 'secret-do-not-leak' },
        },
      }],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['wh']?.output).toEqual({
      kind: 'webhook', method: 'POST', path: '/hooks/x', authType: 'bearer',
    });
    // Confirm secret never leaked into output.
    const serialized = JSON.stringify(outputs['wh']?.output);
    expect(serialized).not.toContain('secret-do-not-leak');
  });

  it('reports the right variant in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo', description: 'd',
      nodes: [
        { id: 's', scheduleTrigger: { type: 'interval', interval: 1000 } },
        { id: 'w', webhookTrigger: { method: 'GET', path: '/ping' }, depends_on: ['s'] },
      ],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    const starts = events.filter((e) => e.type === 'node_start');
    expect(starts.length).toBe(2);
    expect((starts[0] as { nodeType: string }).nodeType).toBe('scheduleTrigger');
    expect((starts[1] as { nodeType: string }).nodeType).toBe('webhookTrigger');
  });
});
