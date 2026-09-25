// BACKLOG #3 — pure-helper test for the sidebar workflow invoker's
// dropdown grouping logic. The component itself is a thin wrapper
// around hooks + grouping; we test the grouping in isolation to keep
// it stable as the WorkflowSummary shape evolves.

import { describe, expect, test } from 'bun:test';
import { groupBySource } from './SidebarWorkflowInvoker';
import type { WorkflowSummary } from '@/nexus/client';

function wf(name: string, source: WorkflowSummary['source']): WorkflowSummary {
  return {
    name,
    description: '',
    source,
    path: `/fake/${source}/${name}.yaml`,
    nodeCount: 1,
  };
}

describe('groupBySource (BACKLOG #3)', () => {
  test('orders project → global → builtin even when input is reverse', () => {
    const result = groupBySource([
      wf('a-builtin', 'builtin'),
      wf('b-global', 'global'),
      wf('c-project', 'project'),
    ]);
    expect(result.map((g) => g.source)).toEqual(['project', 'global', 'builtin']);
  });

  test('alphabetises within each source bucket', () => {
    const result = groupBySource([
      wf('zeta', 'builtin'),
      wf('alpha', 'builtin'),
      wf('mike', 'builtin'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].items.map((w) => w.name)).toEqual(['alpha', 'mike', 'zeta']);
  });

  test('skips empty source buckets', () => {
    const result = groupBySource([wf('only-builtin', 'builtin')]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('builtin');
  });

  test('returns empty array for empty input', () => {
    expect(groupBySource([])).toEqual([]);
  });

  test('attaches human-readable group label', () => {
    const result = groupBySource([
      wf('a', 'project'),
      wf('b', 'global'),
      wf('c', 'builtin'),
    ]);
    expect(result.map((g) => g.label)).toEqual(['Project', 'Global', 'Built-in']);
  });

  test('mixed sources preserve source-order across multiple items per bucket', () => {
    const result = groupBySource([
      wf('build-workflow', 'builtin'),
      wf('quick-summary', 'builtin'),
      wf('my-workflow', 'project'),
      wf('shared', 'global'),
      wf('code-review', 'builtin'),
      wf('another-project-wf', 'project'),
    ]);
    expect(result.map((g) => g.source)).toEqual(['project', 'global', 'builtin']);
    expect(result[0].items.map((w) => w.name)).toEqual(['another-project-wf', 'my-workflow']);
    expect(result[1].items.map((w) => w.name)).toEqual(['shared']);
    expect(result[2].items.map((w) => w.name)).toEqual(['build-workflow', 'code-review', 'quick-summary']);
  });
});
