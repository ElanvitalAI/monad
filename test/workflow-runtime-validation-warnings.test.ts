// M4-2 (2026-05-12 · Phase 4 N5-2) — pre-create validation framework.
//
// 7 deterministic rule 의 각 happy + fire 케이스를 lock + cross-rule
// 적용. validateWorkflow 가 ok=true 시 warnings 도 반환하는지 확인.

import { describe, expect, it } from 'bun:test';
import { validateWorkflow } from '../src/workflow-runtime/schema';
import { buildWarnings, type ValidationWarning } from '../src/workflow-runtime/validation-warnings';
import type { WorkflowDefinition } from '../src/workflow-runtime/types';

function wf(nodes: Array<Record<string, unknown>>): WorkflowDefinition {
  return {
    name: 'wf-test',
    description: 'test',
    nodes: nodes as never,
  };
}

function codes(warnings: ValidationWarning[]): string[] {
  return warnings.map(w => w.code).sort();
}

describe('buildWarnings · cron-too-frequent (rule 1)', () => {
  it('fires on `* * * * *` (every minute)', () => {
    const w = buildWarnings(wf([
      { id: 'in', scheduleTrigger: { type: 'cron', cron: '* * * * *' } },
      { id: 'reply', depends_on: ['in'], bash: 'echo hi' },
    ]));
    expect(w.map(x => x.code)).toContain('cron-too-frequent');
    const m = w.find(x => x.code === 'cron-too-frequent')!;
    expect(m.severity).toBe('high');
    expect(m.nodeId).toBe('in');
    expect(m.suggestion).toBeDefined();
  });

  it('does NOT fire on `*/5 * * * *` (every 5 minutes)', () => {
    const w = buildWarnings(wf([
      { id: 'in', scheduleTrigger: { type: 'cron', cron: '*/5 * * * *' } },
      { id: 'reply', depends_on: ['in'], bash: 'echo hi' },
    ]));
    expect(codes(w)).not.toContain('cron-too-frequent');
  });

  it('does NOT fire on `0 9 * * *` (daily 9 AM)', () => {
    const w = buildWarnings(wf([
      { id: 'in', scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } },
      { id: 'reply', depends_on: ['in'], bash: 'echo hi' },
    ]));
    expect(codes(w)).not.toContain('cron-too-frequent');
  });
});

describe('buildWarnings · interval-too-small (rule 2)', () => {
  it('fires on interval < 60_000', () => {
    const w = buildWarnings(wf([
      { id: 'in', scheduleTrigger: { type: 'interval', interval: 1000 } },
      { id: 'reply', depends_on: ['in'], bash: 'echo hi' },
    ]));
    const m = w.find(x => x.code === 'interval-too-small');
    expect(m).toBeDefined();
    expect(m?.severity).toBe('high');
  });

  it('does NOT fire on interval ≥ 60_000', () => {
    const w = buildWarnings(wf([
      { id: 'in', scheduleTrigger: { type: 'interval', interval: 60_000 } },
      { id: 'reply', depends_on: ['in'], bash: 'echo hi' },
    ]));
    expect(codes(w)).not.toContain('interval-too-small');
  });
});

describe('buildWarnings · missing-upstream-output (rule 3)', () => {
  it('fires when prompt references a non-existent node', () => {
    const w = buildWarnings(wf([
      { id: 'in', manualTrigger: {} },
      { id: 'p', depends_on: ['in'], prompt: 'use $ghost.output here' },
    ]));
    const m = w.find(x => x.code === 'missing-upstream-output');
    expect(m).toBeDefined();
    expect(m?.message).toContain('ghost');
    expect(m?.nodeId).toBe('p');
  });

  it('does NOT fire when reference resolves', () => {
    const w = buildWarnings(wf([
      { id: 'in', manualTrigger: {} },
      { id: 'a', depends_on: ['in'], bash: 'echo hi' },
      { id: 'p', depends_on: ['a'], prompt: 'use $a.output here' },
    ]));
    expect(codes(w)).not.toContain('missing-upstream-output');
  });

  it('scans bash + template fields too', () => {
    const w = buildWarnings(wf([
      { id: 'in', manualTrigger: {} },
      { id: 'b', depends_on: ['in'], bash: 'echo $missing.output' },
      { id: 't', depends_on: ['in'], template: { template: 'hi {{ alsoMissing.output }}' } },
    ]));
    const refs = w.filter(x => x.code === 'missing-upstream-output');
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it('field access (`$a.output.field`) also tracked', () => {
    const w = buildWarnings(wf([
      { id: 'in', manualTrigger: {} },
      { id: 'p', depends_on: ['in'], prompt: 'use $absent.output.score here' },
    ]));
    expect(codes(w)).toContain('missing-upstream-output');
  });
});

describe('buildWarnings · excessive-llm-nodes (rule 4)', () => {
  it('fires when LLM node count ≥ 5', () => {
    const nodes: Array<Record<string, unknown>> = [
      { id: 'in', manualTrigger: {} },
    ];
    for (let i = 0; i < 5; i++) {
      nodes.push({ id: `p${i}`, depends_on: ['in'], prompt: `${i}` });
    }
    const w = buildWarnings(wf(nodes));
    expect(codes(w)).toContain('excessive-llm-nodes');
  });

  it('does NOT fire with 4 LLM nodes', () => {
    const nodes: Array<Record<string, unknown>> = [
      { id: 'in', manualTrigger: {} },
    ];
    for (let i = 0; i < 4; i++) {
      nodes.push({ id: `p${i}`, depends_on: ['in'], prompt: `${i}` });
    }
    const w = buildWarnings(wf(nodes));
    expect(codes(w)).not.toContain('excessive-llm-nodes');
  });

  it('counts classify + extract toward the 5 threshold', () => {
    const w = buildWarnings(wf([
      { id: 'in', manualTrigger: {} },
      { id: 'p1', depends_on: ['in'], prompt: 'a' },
      { id: 'p2', depends_on: ['in'], prompt: 'b' },
      { id: 'c1', depends_on: ['in'], classify: { input: 'x', classes: ['a', 'b'] } },
      { id: 'e1', depends_on: ['in'], extract: { input: 'x', schema: { name: 'n' } } },
      { id: 'e2', depends_on: ['in'], extract: { input: 'y', schema: { val: 'v' } } },
    ]));
    expect(codes(w)).toContain('excessive-llm-nodes');
  });
});

describe('buildWarnings · no-trigger-node (rule 5)', () => {
  it('fires when no trigger variant is present', () => {
    const w = buildWarnings(wf([
      { id: 'a', bash: 'echo hi' },
      { id: 'b', depends_on: ['a'], bash: 'echo bye' },
    ]));
    expect(codes(w)).toContain('no-trigger-node');
  });

  it('does NOT fire for manualTrigger only', () => {
    const w = buildWarnings(wf([
      { id: 'in', manualTrigger: {} },
      { id: 'a', depends_on: ['in'], bash: 'echo hi' },
    ]));
    expect(codes(w)).not.toContain('no-trigger-node');
  });

  it('chat / schedule / webhook / discord / telegram all count', () => {
    const variants = [
      { id: 'a', chatTrigger: { path: '/c' } },
      { id: 'b', scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } },
      { id: 'c', webhookTrigger: { method: 'GET', path: '/w' } },
      { id: 'd', discordTrigger: { kind: 'message' } },
      { id: 'e', telegramTrigger: { kind: 'message' } },
    ];
    for (const t of variants) {
      const w = buildWarnings(wf([t, { id: 'body', depends_on: [t.id], bash: 'echo' }]));
      expect(codes(w)).not.toContain('no-trigger-node');
    }
  });
});

describe('buildWarnings · hosted-chat-no-auth (rule 6)', () => {
  it('fires when hostedUi.enabled=true and no bearer is set anywhere', () => {
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: true } } },
      { id: 'r', depends_on: ['in'], prompt: 'hi' },
    ]));
    const m = w.find(x => x.code === 'hosted-chat-no-auth');
    expect(m).toBeDefined();
    expect(m?.severity).toBe('high');
  });

  it('does NOT fire when hostedUi.bearer is set', () => {
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: true, bearer: 'secret' } } },
      { id: 'r', depends_on: ['in'], prompt: 'hi' },
    ]));
    expect(codes(w)).not.toContain('hosted-chat-no-auth');
  });

  it('does NOT fire when auth.bearer is set (auth covers hosted)', () => {
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c', auth: { type: 'bearer', token: 'tok' }, hostedUi: { enabled: true } } },
      { id: 'r', depends_on: ['in'], prompt: 'hi' },
    ]));
    expect(codes(w)).not.toContain('hosted-chat-no-auth');
  });

  it('does NOT fire when hostedUi is disabled', () => {
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: false } } },
      { id: 'r', depends_on: ['in'], prompt: 'hi' },
    ]));
    expect(codes(w)).not.toContain('hosted-chat-no-auth');
  });
});

describe('buildWarnings · chat-streaming-no-llm (rule 7)', () => {
  it('fires when streaming=true and no LLM node in workflow', () => {
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c', streaming: true } },
      { id: 'b', depends_on: ['in'], bash: 'echo only-bash' },
    ]));
    expect(codes(w)).toContain('chat-streaming-no-llm');
  });

  it('does NOT fire when at least one prompt node exists', () => {
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c', streaming: true } },
      { id: 'p', depends_on: ['in'], prompt: 'hi' },
    ]));
    expect(codes(w)).not.toContain('chat-streaming-no-llm');
  });

  it('does NOT fire when streaming is omitted', () => {
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c' } },
      { id: 'b', depends_on: ['in'], bash: 'echo' },
    ]));
    expect(codes(w)).not.toContain('chat-streaming-no-llm');
  });
});

describe('validateWorkflow integration · warnings on ok=true', () => {
  it('returns warnings field even when schema-valid', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'in', scheduleTrigger: { type: 'cron', cron: '* * * * *' } },
        { id: 'r', depends_on: ['in'], bash: 'echo' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(r.warnings.map(w => w.code)).toContain('cron-too-frequent');
  });

  it('returns warnings=[] when schema-invalid (no false propagation)', () => {
    const r = validateWorkflow({
      name: '',  // schema-invalid
      description: 'd',
      nodes: [{ id: 'a', bash: 'echo' }],
    });
    expect(r.ok).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('returns warnings=[] for clean workflow', () => {
    const r = validateWorkflow({
      name: 'clean',
      description: 'd',
      nodes: [
        { id: 'in', scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } },
        { id: 'p', depends_on: ['in'], prompt: 'hi' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

describe('buildWarnings · multi-rule firing on one workflow', () => {
  it('fires multiple rules at once when applicable', () => {
    // Workflow with cron freq + missing ref + no-trigger? (mutually
    // exclusive with cron). Use cron freq + missing ref + hosted-no-auth.
    const w = buildWarnings(wf([
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: true } } },
      { id: 'sched', scheduleTrigger: { type: 'cron', cron: '* * * * *' } },
      { id: 'p', depends_on: ['in'], prompt: 'use $missing.output here' },
    ]));
    const got = codes(w);
    expect(got).toContain('cron-too-frequent');
    expect(got).toContain('missing-upstream-output');
    expect(got).toContain('hosted-chat-no-auth');
  });
});
