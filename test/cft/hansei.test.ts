// W9 Y5 · Hansei + RetrospectiveCard + method selector.

import { describe, expect, test } from 'bun:test';
import { renderHansei, type HanseiInput } from '../../src/cft/hansei';
import {
  retroCardFromThinkerOutput,
  retroCardFromWorkflowRun,
} from '../../src/cft/retrospective-card';
import { recommendMethod } from '../../src/cft/method-selector';
import type { ThinkerOutput } from '../../src/background-reasoning/thinker-tasks/types';

function baseInput(over: Partial<HanseiInput> = {}): HanseiInput {
  return {
    title: 'Q3 demo retro',
    what: 'Demo ran 45 min over time, audience drifted halfway.',
    why: 'Underestimated setup time on staging cluster.',
    lessons: ['Allocate 20% buffer to setup', 'Walk through twice the day before'],
    countermeasures: [
      { action: 'Add staging warmup step', owner: 'lead' },
      { action: 'Pre-run dress rehearsal', owner: '@self', due: '2026-05-19' },
    ],
    refId: 'run-1',
    source: 'mission',
    createdAt: 100,
    ...over,
  };
}

describe('renderHansei', () => {
  test('returns markdown + frontmatter + retrospective card', () => {
    const r = renderHansei(baseInput());
    expect(r.markdown).toContain('# Hansei — Q3 demo retro');
    expect(r.markdown).toContain('## What happened');
    expect(r.markdown).toContain('## Lessons');
    expect(r.markdown).toContain('- Allocate 20% buffer to setup');
    expect(r.markdown).toContain('**lead** — Add staging warmup step');
    expect(r.markdown).toContain('due 2026-05-19');
    expect(r.frontmatter.lessons_count).toBe(2);
    expect(r.frontmatter.countermeasures_count).toBe(2);
    expect(r.frontmatter.blame_flagged).toBe(false);
    expect(r.card.kind).toBe('retrospective');
    expect(r.card.outcome).toBe('mixed');
    expect(r.card.improvements).toEqual(['Add staging warmup step', 'Pre-run dress rehearsal']);
  });

  test('blame-language is flagged in notices + frontmatter', () => {
    const r = renderHansei(baseInput({
      what: 'Demo failed because the engineer was lazy.',
      lessons: ['Avoid blame'],
    }));
    expect(r.notices[0]).toContain('blame-language flagged');
    expect(r.frontmatter.blame_flagged).toBe(true);
    expect(r.card.outcome).toBe('partial');
  });

  test('metrics rendered when present', () => {
    const r = renderHansei(baseInput({ metrics: { cycle_time_ms: 4500, defect_count: 2 } }));
    expect(r.markdown).toContain('cycle_time_ms: 4500');
    expect(r.frontmatter.metrics).toEqual({ cycle_time_ms: 4500, defect_count: 2 });
  });

  test('missing required fields throw', () => {
    expect(() => renderHansei(baseInput({ title: '' }))).toThrow(/title/);
    expect(() => renderHansei(baseInput({ what: '' }))).toThrow(/what/);
    expect(() => renderHansei(baseInput({ lessons: [] }))).toThrow(/lesson/);
    expect(() => renderHansei(baseInput({ countermeasures: [] }))).toThrow(/countermeasure/);
  });

  test('why placeholder when missing', () => {
    const r = renderHansei(baseInput({ why: undefined }));
    expect(r.markdown).toContain('_TBD_');
  });
});

describe('retroCardFromWorkflowRun', () => {
  test('maps workflow run into retrospective card', () => {
    const card = retroCardFromWorkflowRun({
      runId: 'r-1', workflowName: 'wf', ok: true,
      summary: 'all green', lessons: ['fast'], improvements: ['next: parallelize'],
      createdAt: 999,
    });
    expect(card.kind).toBe('retrospective');
    expect(card.outcome).toBe('success');
    expect(card.source).toBe('workflow_run');
    expect(card.actions[0]!.action).toBe('next: parallelize');
    expect(card.actions[0]!.owner).toBe('@self');
    expect(card.links).toEqual(['workflow_run:wf:r-1']);
  });

  test('ok=false → outcome=fail', () => {
    const card = retroCardFromWorkflowRun({
      runId: 'r-2', workflowName: 'wf', ok: false,
      summary: 'node crashed', lessons: [], improvements: ['add retry'],
      createdAt: 100,
    });
    expect(card.outcome).toBe('fail');
  });
});

describe('retroCardFromThinkerOutput', () => {
  test('cross_workflow_pattern → mixed outcome + actions per workflow', () => {
    const out: Extract<ThinkerOutput, { kind: 'cross_workflow_pattern' }> = {
      kind: 'cross_workflow_pattern',
      affected: ['wf-a', 'wf-b'],
      suggestion: 'merge prelude step',
    };
    const card = retroCardFromThinkerOutput(out, 'ref-1', 500);
    expect(card.outcome).toBe('mixed');
    expect(card.actions.length).toBe(2);
    expect(card.actions[0]!.action).toContain('wf-a');
    expect(card.lessons).toEqual(['merge prelude step']);
  });

  test('prompt_patch → partial outcome + rootCause=process', () => {
    const out: Extract<ThinkerOutput, { kind: 'prompt_patch' }> = {
      kind: 'prompt_patch',
      target: 'skill',
      targetName: 'omni-digest',
      patch: 'You are concise.',
      rationale: 'too verbose',
    };
    const card = retroCardFromThinkerOutput(out, 'ref-2', 500);
    expect(card.outcome).toBe('partial');
    expect(card.rootCause?.category).toBe('process');
    expect(card.links).toEqual(['skill:omni-digest']);
  });
});

describe('recommendMethod', () => {
  test('success outcome → kaizen', () => {
    const card = retroCardFromWorkflowRun({
      runId: 'r', workflowName: 'wf', ok: true,
      summary: '', lessons: [], improvements: [], createdAt: 0,
    });
    expect(recommendMethod(card).primary).toBe('kaizen');
  });

  test('fail with no actions → a3 with 5why fallback', () => {
    const card = retroCardFromWorkflowRun({
      runId: 'r', workflowName: 'wf', ok: false,
      summary: '', lessons: [], improvements: [], createdAt: 0,
    });
    const rec = recommendMethod(card);
    expect(rec.primary).toBe('a3');
    expect(rec.fallback).toBe('5why');
  });

  test('root cause technology → fmea', () => {
    const card = retroCardFromWorkflowRun({
      runId: 'r', workflowName: 'wf', ok: false,
      summary: '', lessons: ['l'], improvements: ['fix bug'], createdAt: 0,
    });
    card.rootCause = { category: 'technology', note: '' };
    expect(recommendMethod(card).primary).toBe('fmea');
  });

  test('rich lessons + multi action → pdca', () => {
    const card = retroCardFromWorkflowRun({
      runId: 'r', workflowName: 'wf', ok: false,
      summary: '',
      lessons: ['l1', 'l2', 'l3'],
      improvements: ['a1', 'a2', 'a3'],
      createdAt: 0,
    });
    expect(recommendMethod(card).primary).toBe('pdca');
  });

  test('default → hansei', () => {
    const card = retroCardFromWorkflowRun({
      runId: 'r', workflowName: 'wf', ok: false,
      summary: '', lessons: ['one'], improvements: ['a'], createdAt: 0,
    });
    expect(recommendMethod(card).primary).toBe('hansei');
  });
});
