// ROADMAP Tier 2 W5 (2026-05-11) — pure helper unit tests for inline
// validation + DAG cycle detection.

import { describe, expect, it } from 'bun:test';
import type { WorkflowDefinitionLike } from './workflow-graph-layout';
import {
  detectCycle,
  groupIssuesByNodeId,
  parseIssueNodeId,
  type ValidationIssue,
} from './validation-helpers';

const sampleDef: WorkflowDefinitionLike = {
  name: 'demo',
  nodes: [
    { id: 'first', bash: 'echo a' },
    { id: 'second', prompt: 'do x', depends_on: ['first'] },
    { id: 'gate', approval: { message: 'ok?', delivery: 'modal' }, depends_on: ['second'] },
  ],
};

describe('parseIssueNodeId', () => {
  it('returns nodeId for nodes[idx] paths', () => {
    expect(parseIssueNodeId('nodes[0].bash', sampleDef)).toBe('first');
    expect(parseIssueNodeId('nodes[2].approval.delivery', sampleDef)).toBe('gate');
  });

  it('returns null for root-level paths', () => {
    expect(parseIssueNodeId('name', sampleDef)).toBeNull();
    expect(parseIssueNodeId('', sampleDef)).toBeNull();
    expect(parseIssueNodeId('description', sampleDef)).toBeNull();
  });

  it('returns null for out-of-bounds index', () => {
    expect(parseIssueNodeId('nodes[99].bash', sampleDef)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseIssueNodeId('nodes[abc].x', sampleDef)).toBeNull();
    // @ts-expect-error testing runtime tolerance
    expect(parseIssueNodeId(undefined, sampleDef)).toBeNull();
  });

  it('returns null when node has no id', () => {
    const def: WorkflowDefinitionLike = {
      name: 'x',
      nodes: [{ id: '', bash: 'echo' } as never],
    };
    expect(parseIssueNodeId('nodes[0].bash', def)).toBeNull();
  });
});

describe('groupIssuesByNodeId', () => {
  it('buckets node-scoped issues by id and root issues separately', () => {
    const issues: ValidationIssue[] = [
      { path: 'nodes[0].bash', message: 'cmd empty' },
      { path: 'nodes[2].approval.delivery', message: 'bad channel' },
      { path: 'name', message: 'must be kebab-case' },
      { path: 'nodes[0].when', message: 'expr invalid' },
    ];
    const { byNodeId, rootIssues } = groupIssuesByNodeId(issues, sampleDef);
    expect(Object.keys(byNodeId).sort()).toEqual(['first', 'gate']);
    expect(byNodeId.first!).toHaveLength(2);
    expect(byNodeId.gate!).toHaveLength(1);
    expect(rootIssues).toHaveLength(1);
    expect(rootIssues[0]!.path).toBe('name');
  });

  it('returns empty buckets for empty input', () => {
    const { byNodeId, rootIssues } = groupIssuesByNodeId([], sampleDef);
    expect(byNodeId).toEqual({});
    expect(rootIssues).toEqual([]);
  });

  it('preserves issue order within a node bucket', () => {
    const issues: ValidationIssue[] = [
      { path: 'nodes[0].bash', message: 'first' },
      { path: 'nodes[0].when', message: 'second' },
    ];
    const { byNodeId } = groupIssuesByNodeId(issues, sampleDef);
    expect(byNodeId.first!.map((i) => i.message)).toEqual(['first', 'second']);
  });
});

describe('detectCycle', () => {
  it('returns empty set on acyclic DAG', () => {
    expect(detectCycle(sampleDef).size).toBe(0);
  });

  it('flags a 2-node back-edge cycle', () => {
    const def: WorkflowDefinitionLike = {
      name: 'cycle2',
      nodes: [
        { id: 'a', bash: 'x', depends_on: ['b'] },
        { id: 'b', bash: 'y', depends_on: ['a'] },
      ],
    };
    const cyc = detectCycle(def);
    expect(cyc.has('a')).toBe(true);
    expect(cyc.has('b')).toBe(true);
  });

  it('flags a 3-node cycle', () => {
    const def: WorkflowDefinitionLike = {
      name: 'cycle3',
      nodes: [
        { id: 'a', bash: 'x', depends_on: ['c'] },
        { id: 'b', bash: 'y', depends_on: ['a'] },
        { id: 'c', bash: 'z', depends_on: ['b'] },
      ],
    };
    const cyc = detectCycle(def);
    expect(cyc.size).toBe(3);
    expect(cyc.has('a') && cyc.has('b') && cyc.has('c')).toBe(true);
  });

  it('does not flag nodes outside the cycle', () => {
    const def: WorkflowDefinitionLike = {
      name: 'mixed',
      nodes: [
        { id: 'pre', bash: 'p' },
        { id: 'a', bash: 'x', depends_on: ['pre', 'b'] },
        { id: 'b', bash: 'y', depends_on: ['a'] },
        { id: 'tail', bash: 't', depends_on: ['a'] },
      ],
    };
    const cyc = detectCycle(def);
    expect(cyc.has('a')).toBe(true);
    expect(cyc.has('b')).toBe(true);
    expect(cyc.has('pre')).toBe(false);
    expect(cyc.has('tail')).toBe(false);
  });

  it('ignores depends_on entries that reference unknown nodes', () => {
    const def: WorkflowDefinitionLike = {
      name: 'phantom',
      nodes: [
        { id: 'a', bash: 'x', depends_on: ['ghost'] },
        { id: 'b', bash: 'y', depends_on: ['a'] },
      ],
    };
    expect(detectCycle(def).size).toBe(0);
  });

  it('ignores malformed depends_on entries', () => {
    const def: WorkflowDefinitionLike = {
      name: 'malformed',
      nodes: [
        { id: 'a', bash: 'x', depends_on: [null, '', 'b'] as never },
        { id: 'b', bash: 'y' },
      ],
    };
    expect(detectCycle(def).size).toBe(0);
  });

  it('handles disconnected components separately', () => {
    const def: WorkflowDefinitionLike = {
      name: 'two-graphs',
      nodes: [
        { id: 'a', bash: 'x' },
        { id: 'b', bash: 'y', depends_on: ['a'] },
        { id: 'c', bash: 'z', depends_on: ['d'] },
        { id: 'd', bash: 'w', depends_on: ['c'] },
      ],
    };
    const cyc = detectCycle(def);
    expect(cyc.has('a')).toBe(false);
    expect(cyc.has('b')).toBe(false);
    expect(cyc.has('c')).toBe(true);
    expect(cyc.has('d')).toBe(true);
  });
});
