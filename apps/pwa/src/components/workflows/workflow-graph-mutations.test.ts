// Archon-port T2B Phase 2 (2026-05-08) — pure mutation tests.

import { describe, expect, it } from 'bun:test';
import {
  addEdge,
  addNode,
  clearLayout,
  definitionToYaml,
  deleteNode,
  duplicateNode,
  editNode,
  nextFreeNodeId,
  removeEdge,
  renameNode,
  safeParseWorkflowYaml,
  setNodePosition,
} from './workflow-graph-mutations';
import type { WorkflowDefinitionLike } from './workflow-graph-layout';

const seed: WorkflowDefinitionLike = {
  name: 'demo',
  description: 'desc',
  nodes: [
    { id: 'a', bash: 'echo a' },
    { id: 'b', bash: 'echo b', depends_on: ['a'] },
    { id: 'c', prompt: 'analyze', depends_on: ['a', 'b'] },
  ],
};

describe('nextFreeNodeId', () => {
  it('returns variant-1 for an empty definition', () => {
    expect(nextFreeNodeId({ name: 'x', nodes: [] }, 'bash')).toBe('bash-1');
  });
  it('skips taken slots', () => {
    expect(
      nextFreeNodeId(
        { name: 'x', nodes: [{ id: 'bash-1', bash: '' }, { id: 'bash-2', bash: '' }] },
        'bash',
      ),
    ).toBe('bash-3');
  });
});

describe('addNode', () => {
  it('appends a new node and does not mutate input', () => {
    const before = JSON.stringify(seed);
    const after = addNode(seed, 'bash');
    expect(JSON.stringify(seed)).toBe(before);
    expect(after.nodes).toHaveLength(seed.nodes.length + 1);
  });

  it('chooses scaffold by variant', () => {
    expect(addNode(seed, 'prompt').nodes.at(-1)).toMatchObject({ prompt: expect.any(String) });
    expect(addNode(seed, 'skill').nodes.at(-1)).toMatchObject({ skill: 'omni-digest' });
    expect(addNode(seed, 'cft').nodes.at(-1)).toMatchObject({ cft: 'pdca' });
    expect(addNode(seed, 'approval').nodes.at(-1)).toMatchObject({
      approval: { message: expect.any(String) },
    });
  });

  it('honors an explicit id override', () => {
    const after = addNode(seed, 'bash', { id: 'custom-x' });
    expect(after.nodes.at(-1)?.id).toBe('custom-x');
  });
});

describe('deleteNode', () => {
  it('removes the target node', () => {
    const r = deleteNode(seed, 'b');
    expect(r.nodes.find((n) => n.id === 'b')).toBeUndefined();
    expect(r.nodes).toHaveLength(2);
  });

  it('strips deleted id from other nodes depends_on', () => {
    const r = deleteNode(seed, 'b');
    const c = r.nodes.find((n) => n.id === 'c')!;
    expect(c.depends_on).toEqual(['a']);
  });

  it('drops depends_on entirely when it becomes empty', () => {
    const def: WorkflowDefinitionLike = {
      name: 'd',
      nodes: [
        { id: 'a', bash: 'a' },
        { id: 'b', bash: 'b', depends_on: ['a'] },
      ],
    };
    const r = deleteNode(def, 'a');
    const b = r.nodes.find((n) => n.id === 'b')!;
    expect(b.depends_on).toBeUndefined();
  });

  it('is a no-op for an unknown id', () => {
    const r = deleteNode(seed, 'no-such');
    expect(r.nodes).toHaveLength(seed.nodes.length);
  });
});

describe('addEdge', () => {
  it('appends source to target.depends_on', () => {
    const r = addEdge({ name: 'x', nodes: [{ id: 'a', bash: 'a' }, { id: 'b', bash: 'b' }] }, 'a', 'b');
    expect(r.nodes.find((n) => n.id === 'b')?.depends_on).toEqual(['a']);
  });

  it('is idempotent — duplicate add is a no-op', () => {
    const once = addEdge(seed, 'a', 'b');
    const twice = addEdge(once, 'a', 'b');
    expect(twice).toEqual(once);
  });

  it('refuses self-loops', () => {
    const r = addEdge(seed, 'a', 'a');
    expect(r.nodes.find((n) => n.id === 'a')?.depends_on).toBeUndefined();
  });
});

describe('removeEdge', () => {
  it('removes a single dep entry', () => {
    const r = removeEdge(seed, 'a', 'c');
    expect(r.nodes.find((n) => n.id === 'c')?.depends_on).toEqual(['b']);
  });

  it('drops the depends_on array when it becomes empty', () => {
    const r = removeEdge(seed, 'a', 'b');
    expect(r.nodes.find((n) => n.id === 'b')?.depends_on).toBeUndefined();
  });

  it('no-op when edge is absent', () => {
    const r = removeEdge(seed, 'b', 'a');
    expect(r).toEqual(seed);
  });
});

describe('editNode (ROADMAP W2)', () => {
  it('patches bash content in place', () => {
    const r = editNode(seed, 'a', { bash: 'echo updated' });
    expect(r.nodes.find((n) => n.id === 'a')?.['bash']).toBe('echo updated');
    // Other nodes untouched.
    expect(r.nodes.find((n) => n.id === 'b')?.['bash']).toBe('echo b');
  });

  it('does not mutate input', () => {
    const before = JSON.stringify(seed);
    editNode(seed, 'a', { bash: 'echo zzz' });
    expect(JSON.stringify(seed)).toBe(before);
  });

  it('renames via id patch and updates depends_on references', () => {
    const r = editNode(seed, 'a', { id: 'alpha', bash: 'echo a-renamed' });
    expect(r.nodes.find((n) => n.id === 'alpha')?.['bash']).toBe('echo a-renamed');
    expect(r.nodes.find((n) => n.id === 'b')?.depends_on).toEqual(['alpha']);
    expect(r.nodes.find((n) => n.id === 'c')?.depends_on).toEqual(['alpha', 'b']);
  });

  it('rejects an id rename when target id is taken', () => {
    const r = editNode(seed, 'a', { id: 'b', bash: 'new' });
    // rename fails silently, but the bash patch still lands on the
    // original id 'a' (so the user's content edit isn't lost).
    expect(r.nodes.find((n) => n.id === 'a')?.['bash']).toBe('new');
    expect(r.nodes.filter((n) => n.id === 'b').length).toBe(1);
  });

  it('switches variant by stripping the old key + sidecars', () => {
    const skillSeed: WorkflowDefinitionLike = {
      name: 'x',
      nodes: [{ id: 'one', skill: 'omni-digest', arguments: '$ARGUMENTS' }],
    };
    const r = editNode(skillSeed, 'one', { bash: 'echo migrated' });
    const node = r.nodes[0]!;
    expect(node['bash']).toBe('echo migrated');
    expect(node['skill']).toBeUndefined();
    expect(node['arguments']).toBeUndefined();
  });

  it('strips cft sidecar (config) when switching away from cft', () => {
    const cftSeed: WorkflowDefinitionLike = {
      name: 'x',
      nodes: [{ id: 'one', cft: 'pdca', config: { goal: 'TBD' } }],
    };
    const r = editNode(cftSeed, 'one', { prompt: 'analyze' });
    const node = r.nodes[0]!;
    expect(node['prompt']).toBe('analyze');
    expect(node['cft']).toBeUndefined();
    expect(node['config']).toBeUndefined();
  });

  it('writes when expression (string sets)', () => {
    const r = editNode(seed, 'b', { when: "$a.output == 'ok'" });
    expect(r.nodes.find((n) => n.id === 'b')?.['when']).toBe("$a.output == 'ok'");
  });

  it('deletes when expression (null deletes)', () => {
    const seedWithWhen: WorkflowDefinitionLike = {
      ...seed,
      nodes: seed.nodes.map((n) => (n.id === 'b' ? { ...n, when: 'truthy' } : n)),
    };
    const r = editNode(seedWithWhen, 'b', { when: null });
    expect(r.nodes.find((n) => n.id === 'b')?.['when']).toBeUndefined();
  });

  it('rewrites depends_on (non-empty array replaces)', () => {
    const r = editNode(seed, 'c', { depends_on: ['b'] });
    expect(r.nodes.find((n) => n.id === 'c')?.depends_on).toEqual(['b']);
  });

  it('drops depends_on key when empty array', () => {
    const r = editNode(seed, 'c', { depends_on: [] });
    expect(r.nodes.find((n) => n.id === 'c')?.depends_on).toBeUndefined();
  });

  it('writes approval payload', () => {
    const apvSeed: WorkflowDefinitionLike = {
      name: 'x',
      nodes: [{ id: 'gate', approval: { message: 'old' } }],
    };
    const r = editNode(apvSeed, 'gate', {
      approval: { message: 'new', delivery: 'pushcut' },
    });
    expect(r.nodes[0]!['approval']).toEqual({ message: 'new', delivery: 'pushcut' });
  });

  it('is a no-op when node id is missing', () => {
    const r = editNode(seed, 'missing-node', { bash: 'echo nope' });
    expect(r).toBe(seed);
  });
});

describe('renameNode', () => {
  it('renames the node and updates references', () => {
    const r = renameNode(seed, 'a', 'alpha');
    expect(r.nodes.find((n) => n.id === 'alpha')).toBeDefined();
    expect(r.nodes.find((n) => n.id === 'a')).toBeUndefined();
    expect(r.nodes.find((n) => n.id === 'b')?.depends_on).toEqual(['alpha']);
    expect(r.nodes.find((n) => n.id === 'c')?.depends_on).toEqual(['alpha', 'b']);
  });

  it('is a no-op when target id is taken', () => {
    const r = renameNode(seed, 'a', 'b');
    expect(r).toEqual(seed);
  });
});

describe('setNodePosition (ROADMAP W3 layout persistence)', () => {
  it('writes a layout entry under _meta.layout.{id}', () => {
    const r = setNodePosition(seed, 'a', { x: 120.4, y: 80.6 });
    const meta = r['_meta'] as { layout: Record<string, { x: number; y: number }> };
    expect(meta.layout.a).toEqual({ x: 120, y: 81 });
  });

  it('rounds positions to integers for tidy yaml', () => {
    const r = setNodePosition(seed, 'a', { x: 12.34, y: 56.78 });
    const meta = r['_meta'] as { layout: Record<string, { x: number; y: number }> };
    expect(meta.layout.a.x).toBe(12);
    expect(meta.layout.a.y).toBe(57);
  });

  it('preserves entries for other nodes', () => {
    const withA = setNodePosition(seed, 'a', { x: 1, y: 2 });
    const withAB = setNodePosition(withA, 'b', { x: 100, y: 200 });
    const meta = withAB['_meta'] as { layout: Record<string, { x: number; y: number }> };
    expect(meta.layout.a).toEqual({ x: 1, y: 2 });
    expect(meta.layout.b).toEqual({ x: 100, y: 200 });
  });

  it('garbage-collects entries for nodes that no longer exist', () => {
    // Seed _meta with stale entries.
    const stale: WorkflowDefinitionLike = {
      ...seed,
      _meta: { layout: { a: { x: 1, y: 1 }, ghost: { x: 99, y: 99 } } },
    };
    const r = setNodePosition(stale, 'a', { x: 5, y: 5 });
    const meta = r['_meta'] as { layout: Record<string, { x: number; y: number }> };
    expect(meta.layout['ghost']).toBeUndefined();
    expect(meta.layout['a']).toEqual({ x: 5, y: 5 });
  });

  it('is a no-op when node id is missing', () => {
    const r = setNodePosition(seed, 'missing-node', { x: 10, y: 20 });
    expect(r).toBe(seed);
  });

  it('does not mutate input', () => {
    const before = JSON.stringify(seed);
    setNodePosition(seed, 'a', { x: 1, y: 2 });
    expect(JSON.stringify(seed)).toBe(before);
  });
});

describe('definitionToYaml ↔ safeParseWorkflowYaml round-trip', () => {
  it('round-trip preserves the definition shape', () => {
    const yaml = definitionToYaml(seed);
    const parsed = safeParseWorkflowYaml(yaml);
    expect(parsed).toEqual(seed);
  });

  it('puts name + description first in the rendered YAML', () => {
    const yaml = definitionToYaml(seed);
    const lines = yaml.split('\n').slice(0, 3);
    expect(lines[0]).toMatch(/^name:/);
    expect(lines[1]).toMatch(/^description:/);
  });

  it('survives an addNode → toYaml → parse round trip', () => {
    const after = addNode(seed, 'bash');
    const yaml = definitionToYaml(after);
    const parsed = safeParseWorkflowYaml(yaml);
    expect(parsed?.nodes).toHaveLength(seed.nodes.length + 1);
  });

  it('safeParseWorkflowYaml returns null for malformed yaml', () => {
    expect(safeParseWorkflowYaml(':::')).toBeNull();
    expect(safeParseWorkflowYaml('justastring')).toBeNull();
    expect(safeParseWorkflowYaml('name: x\nnodes: not-an-array')).toBeNull();
  });
});

describe('clearLayout (Tier E4.1)', () => {
  it('strips _meta.layout entirely (returns def with no layout key)', () => {
    const def: WorkflowDefinitionLike = {
      name: 'demo',
      nodes: [{ id: 'a', bash: 'a' }],
      _meta: { layout: { a: { x: 100, y: 200 } } },
    };
    const after = clearLayout(def);
    expect(after['_meta']).toBeUndefined();
  });

  it('preserves other _meta keys when present', () => {
    const def: WorkflowDefinitionLike = {
      name: 'demo',
      nodes: [{ id: 'a', bash: 'a' }],
      _meta: { layout: { a: { x: 1, y: 2 } }, owner: 'team-a' },
    };
    const after = clearLayout(def);
    expect(after['_meta']).toEqual({ owner: 'team-a' });
  });

  it('is a no-op when _meta is missing or has no layout key', () => {
    const noMeta: WorkflowDefinitionLike = { name: 'x', nodes: [] };
    expect(clearLayout(noMeta)).toBe(noMeta);
    const otherMeta: WorkflowDefinitionLike = {
      name: 'x',
      nodes: [],
      _meta: { owner: 'a' },
    };
    expect(clearLayout(otherMeta)).toBe(otherMeta);
  });
});

describe('duplicateNode (Tier E3.2)', () => {
  it('appends a fresh node copy with the next free id of the same variant', () => {
    const after = duplicateNode(seed, 'a');
    expect(after.nodes).toHaveLength(4);
    const fresh = after.nodes[3];
    expect(fresh.id).toBe('bash-1');
    expect((fresh as { bash?: string }).bash).toBe('echo a');
  });

  it('preserves variant payload but drops depends_on', () => {
    const after = duplicateNode(seed, 'b');
    const fresh = after.nodes[after.nodes.length - 1];
    expect((fresh as { bash?: string }).bash).toBe('echo b');
    expect(fresh.depends_on).toBeUndefined();
  });

  it('handles a prompt variant', () => {
    const after = duplicateNode(seed, 'c');
    const fresh = after.nodes[after.nodes.length - 1];
    expect((fresh as { prompt?: string }).prompt).toBe('analyze');
    expect(fresh.id).toBe('prompt-1');
  });

  it('is a no-op for an unknown id', () => {
    const after = duplicateNode(seed, 'does-not-exist');
    expect(after).toEqual(seed);
  });

  it('produces ids that don\'t collide with existing ones', () => {
    const seeded: WorkflowDefinitionLike = {
      name: 'demo',
      nodes: [
        { id: 'bash-1', bash: 'a' },
        { id: 'bash-2', bash: 'b' },
        { id: 'bash-3', bash: 'c' },
      ],
    };
    const after = duplicateNode(seeded, 'bash-1');
    expect(after.nodes[after.nodes.length - 1].id).toBe('bash-4');
  });
});
