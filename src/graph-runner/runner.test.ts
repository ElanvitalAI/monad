import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGraph } from './runner.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(command: string, loop = false): { graph: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'graph-runner-'));
  dirs.push(root);
  writeFileSync(join(root, 'recipes.yaml'), `first:\n  command: "${command}"\nsecond:\n  command: "exit 0"\n`);
  const graph = join(root, 'graph.yaml');
  writeFileSync(graph, `graph_id: test-graph\nversion: 1\nentry_node: first\nterminal_nodes: [done, failed]\nnodes:\n  - { node_id: first, kind: agent, recipe: 'cmd:first', max_visits: 1 }\n  - { node_id: second, kind: agent, recipe: 'cmd:second', max_visits: 1 }\n  - { node_id: done, kind: gate, max_visits: 1 }\n  - { node_id: failed, kind: gate, max_visits: 1 }\nedges:\n  - from: first\n    on: outcome\n    map: { ok: ${loop ? 'first' : 'second'}, fail: failed }\n  - from: second\n    on: outcome\n    map: { ok: done, fail: failed }\n`);
  return { graph, root };
}

test('two successful commands reach done and persist both outcomes', async () => {
  const { graph, root } = fixture('exit 0');
  const result = await runGraph(graph, { runId: 'success', deps: { root } });
  expect(result.status).toBe('done');
  expect(result.path).toEqual(['first', 'second', 'done']);
  expect(result.executed).toBe(2);
  expect(JSON.parse(readFileSync(result.statePath, 'utf8')).nodes.slice(0, 2)).toEqual([
    { nodeId: 'first', ok: true, exit: 0, executed: true },
    { nodeId: 'second', ok: true, exit: 0, executed: true },
  ]);
});

test('failed first command branches to failed without executing second', async () => {
  const { graph, root } = fixture('exit 1');
  const result = await runGraph(graph, { deps: { root } });
  expect(result.status).toBe('failed');
  expect(result.path).toEqual(['first', 'failed']);
  expect(result.nodes[0]).toMatchObject({ ok: false, exit: 1 });
  expect(result.executed).toBe(1);
});

test('missing outcome mapping uses fallback without executing the second command', async () => {
  const { graph, root } = fixture('exit 1');
  writeFileSync(graph, readFileSync(graph, 'utf8').replace('map: { ok: second, fail: failed }', 'map: { ok: second }\n    fallback:\n      - { node: failed, requires: [] }'));
  const result = await runGraph(graph, { deps: { root } });
  expect(result.status).toBe('failed');
  expect(result.path).toEqual(['first', 'failed']);
  expect(result.executed).toBe(1);
});

test('a revisit beyond max_visits is blocked before running again', async () => {
  const { graph, root } = fixture('exit 0', true);
  const result = await runGraph(graph, { deps: { root } });
  expect(result.status).toBe('budget-exceeded');
  expect(result.path).toEqual(['first']);
  expect(result.executed).toBe(1);
  expect(JSON.parse(readFileSync(result.statePath, 'utf8')).status).toBe('budget-exceeded');
});

test('unregistered inherited recipe is rejected before any command executes', async () => {
  const { graph, root } = fixture('exit 0');
  writeFileSync(graph, readFileSync(graph, 'utf8').replace('cmd:second', 'cmd:toString'));
  let executed = 0;
  await expect(runGraph(graph, { deps: { root, runBash: async () => {
    executed++;
    return { stdout: '', stderr: '', exitCode: 0 };
  } } })).rejects.toThrow('unknown command recipe for second: cmd:toString');
  expect(executed).toBe(0);
});

test('unsupported terminal name cannot silently report a failed branch as done', async () => {
  const { graph, root } = fixture('exit 1');
  writeFileSync(graph, readFileSync(graph, 'utf8')
    .replace('terminal_nodes: [done, failed]', 'terminal_nodes: [done, rejected]')
    .replace('node_id: failed', 'node_id: rejected')
    .replaceAll('fail: failed', 'fail: rejected'));
  let executed = 0;
  await expect(runGraph(graph, { deps: { root, runBash: async () => {
    executed++;
    return { stdout: '', stderr: '', exitCode: 1 };
  } } })).rejects.toThrow('unsupported terminal node: rejected');
  expect(executed).toBe(0);
});

test('dry run assumes ok and never invokes the injected command executor', async () => {
  const { graph, root } = fixture('exit 1');
  const result = await runGraph(graph, { dryRun: true, deps: { root, runBash: async () => { throw new Error('executed'); } } });
  expect(result.status).toBe('done');
  expect(result.path).toEqual(['first', 'second', 'done']);
  expect(result.executed).toBe(0);
});
