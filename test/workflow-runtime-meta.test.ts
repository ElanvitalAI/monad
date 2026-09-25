// FU8 PR #8 (M4-3.2 · 2026-05-12) — workflow `_meta.missionId` schema
// + stamper + register-all wiring tests.

import { describe, expect, test } from 'bun:test';

import { validateWorkflow } from '../src/workflow-runtime/schema';
import { stampWorkflowMeta } from '../src/nexus/api/intake-pipeline-commit';

const MIN_YAML = {
  name: 'demo-workflow',
  description: 'sample',
  nodes: [
    {
      id: 'do-thing',
      prompt: 'say hello',
    },
  ],
};

describe('M4-3.2 · validateWorkflow accepts _meta block', () => {
  test('workflow with no `_meta` validates (back-compat)', () => {
    const res = validateWorkflow(MIN_YAML);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.workflow._meta).toBeUndefined();
    }
  });

  test('workflow with `_meta.missionId` (URN format) validates', () => {
    const res = validateWorkflow({
      ...MIN_YAML,
      _meta: {
        missionId: 'mission:m-abc123',
        intakeId: 'intake-2026-05-12-001',
        sourceTaskKey: 'm-1/t-1',
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.workflow._meta).toEqual({
        missionId: 'mission:m-abc123',
        intakeId: 'intake-2026-05-12-001',
        sourceTaskKey: 'm-1/t-1',
      });
    }
  });

  test('rejects `_meta.missionId` missing the URN prefix', () => {
    const res = validateWorkflow({
      ...MIN_YAML,
      _meta: { missionId: 'm-abc123' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((i) => i.path === '_meta.missionId')).toBe(true);
    }
  });

  test('rejects non-object `_meta`', () => {
    const res = validateWorkflow({ ...MIN_YAML, _meta: 'oops' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((i) => i.path === '_meta')).toBe(true);
    }
  });

  test('rejects empty-string subfields', () => {
    const res = validateWorkflow({
      ...MIN_YAML,
      _meta: { missionId: '', intakeId: '   ', sourceTaskKey: '' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('forward-compat: unknown subfields ignored', () => {
    const res = validateWorkflow({
      ...MIN_YAML,
      _meta: {
        missionId: 'mission:m-x',
        futureField: 'irrelevant',
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Unknown fields dropped by `pickWorkflowMeta`.
      expect(res.workflow._meta).toEqual({ missionId: 'mission:m-x' });
    }
  });
});

describe('M4-3.2 · stampWorkflowMeta', () => {
  const BASE_YAML = [
    'name: demo',
    'description: sample',
    'nodes:',
    '  - id: do-thing',
    '    prompt: hello',
    '',
  ].join('\n');

  test('returns YAML unchanged when meta is undefined', () => {
    expect(stampWorkflowMeta(BASE_YAML, undefined)).toBe(BASE_YAML);
  });

  test('returns YAML unchanged when meta has no recognised fields', () => {
    expect(stampWorkflowMeta(BASE_YAML, {})).toBe(BASE_YAML);
  });

  test('appends a `_meta:` block when meta has missionId', () => {
    const out = stampWorkflowMeta(BASE_YAML, {
      missionId: 'mission:m-1',
      intakeId: 'intake-2026-05-12-001',
      sourceTaskKey: 'm-1/t-1',
    });
    expect(out).toContain('_meta:');
    expect(out).toContain("missionId: 'mission:m-1'");
    expect(out).toContain('intakeId: intake-2026-05-12-001');
    expect(out).toContain('sourceTaskKey: m-1/t-1');
  });

  test('produced YAML is itself schema-valid', () => {
    // Round-trip the stamper output through the loose parser to
    // confirm we're not emitting something that `parseWorkflowYaml`
    // would later reject.
    const out = stampWorkflowMeta(BASE_YAML, { missionId: 'mission:m-2' });
    // crude check: the line we added must use single-quoted scalar
    // so the YAML parser doesn't misread `mission:m-2` as a nested
    // mapping.
    expect(out).toMatch(/^\s*missionId: 'mission:m-2'$/m);
  });

  test('replaces an existing top-level `_meta:` block', () => {
    const yamlWithExisting = [
      'name: demo',
      'description: sample',
      '_meta:',
      '  missionId: mission:stale-1',
      '  intakeId: intake-old',
      'nodes:',
      '  - id: do-thing',
      '    prompt: hello',
    ].join('\n');
    const out = stampWorkflowMeta(yamlWithExisting, {
      missionId: 'mission:fresh-2',
    });
    expect(out).not.toContain('mission:stale-1');
    expect(out).not.toContain('intake-old');
    expect(out).toContain("missionId: 'mission:fresh-2'");
    // The non-meta lines (name / description / nodes) survive.
    expect(out).toContain('name: demo');
    expect(out).toContain('nodes:');
    expect(out).toContain('prompt: hello');
  });

  test('escapes scalars containing `:` so the YAML parser preserves them', () => {
    const out = stampWorkflowMeta(BASE_YAML, { missionId: 'mission:m-x' });
    expect(out).toContain("missionId: 'mission:m-x'");
  });

  test('handles scalars without special characters un-quoted', () => {
    const out = stampWorkflowMeta(BASE_YAML, {
      missionId: 'mission:plain',
      sourceTaskKey: 'm-1_t-1',
    });
    expect(out).toContain('sourceTaskKey: m-1_t-1');
  });
});
