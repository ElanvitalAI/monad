import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { debug } from '../debug/log.js';
import { effectiveInstanceRoot } from '../instance/resolve.js';
import { parseGraphTemplateYaml, type GraphEdgeSpec } from '../self-implement/graph-yaml.js';
import { executeBashNode } from '../workflow-runtime/nodes/bash.js';
import type { BashNode, NodeExecContext, WorkflowDeps } from '../workflow-runtime/types.js';

type BashRun = WorkflowDeps['runBash'];

export interface GraphRunState {
  graphId: string;
  runId: string;
  status: 'running' | 'done' | 'failed' | 'budget-exceeded';
  path: string[];
  nodes: Array<{ nodeId: string; ok: boolean; exit: number | null; executed: boolean; error?: string }>;
  executed: number;
  dryRun: boolean;
  statePath: string;
}

export interface GraphRunOptions {
  dryRun?: boolean;
  runId?: string;
  deps?: { root?: string; runBash?: BashRun; log?: (event: string, data: Record<string, unknown>) => void };
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') {
    throw new Error(`invalid graph run identifier: ${value}`);
  }
  return value;
}

function recipesFor(path: string): Record<string, { command: string; timeout_ms?: number }> {
  const file = join(dirname(path), 'recipes.yaml');
  const parsed: unknown = parseYaml(readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`invalid recipes: ${file}`);
  const recipes: Record<string, { command: string; timeout_ms?: number }> = Object.create(null);
  for (const [id, raw] of Object.entries(parsed)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`invalid recipe: ${id}`);
    const item = raw as Record<string, unknown>;
    if (typeof item.command !== 'string' || !item.command.trim() ||
      (item.timeout_ms !== undefined && (!Number.isSafeInteger(item.timeout_ms) || (item.timeout_ms as number) <= 0))) {
      throw new Error(`invalid recipe: ${id}`);
    }
    recipes[id] = { command: item.command, ...(item.timeout_ms === undefined ? {} : { timeout_ms: item.timeout_ms as number }) };
  }
  return recipes;
}

const realRunBash: BashRun = (body, opts) => new Promise((resolve, reject) => {
  execFile('/bin/bash', ['-c', body], { cwd: opts.cwd, timeout: opts.timeoutMs, signal: opts.signal, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && typeof (error as NodeJS.ErrnoException).code !== 'number') {
      reject(error);
      return;
    }
    resolve({ stdout, stderr, exitCode: error ? (error as unknown as { code: number }).code : 0 });
  });
});

function nextNode(edges: readonly GraphEdgeSpec[], nodeId: string, outcome: 'ok' | 'fail'): string | undefined {
  const edge = edges.find((e) => e.from === nodeId);
  if (!edge) return undefined;
  if (edge.to !== undefined) return edge.to;
  if (edge.on !== 'outcome') throw new Error(`unsupported edge condition: ${edge.on}`);
  return edge.map?.[outcome] ?? edge.fallback?.[0]?.node;
}

export async function runGraph(path: string, options: GraphRunOptions = {}): Promise<GraphRunState> {
  const source = readFileSync(path, 'utf8');
  // The shared YAML parser requires a recipe string. A command-less node in
  // this runner is represented internally as `none`, without changing that parser.
  const raw: unknown = parseYaml(source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`invalid graph: ${path}`);
  const document = raw as Record<string, unknown>;
  if (Array.isArray(document.nodes)) {
    document.nodes = document.nodes.map((node: unknown) => node && typeof node === 'object' && !Array.isArray(node) && !('recipe' in node)
      ? { ...node, recipe: 'none' } : node);
  }
  const parsed = parseGraphTemplateYaml(stringifyYaml(document), path);
  if (!parsed.template || parsed.errors.length) throw new Error(parsed.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
  const graph = parsed.template;
  for (const terminal of graph.terminalNodes) {
    if (terminal !== 'done' && terminal !== 'failed') {
      throw new Error(`unsupported terminal node: ${terminal} (expected done or failed)`);
    }
  }
  const recipes = recipesFor(path);
  // Resolve all commands before executing any node; an unknown recipe must never produce a partial publication.
  for (const node of graph.nodes) {
    if (node.recipe !== 'none' && (!node.recipe.startsWith('cmd:') || !Object.hasOwn(recipes, node.recipe.slice(4)))) {
      throw new Error(`unknown command recipe for ${node.nodeId}: ${node.recipe}`);
    }
  }
  const graphId = safeSegment(graph.graphId);
  const runId = safeSegment(options.runId ?? randomUUID());
  const statePath = join(options.deps?.root ?? effectiveInstanceRoot(), 'graph-runs', graphId, `${runId}.json`);
  const state: GraphRunState = { graphId, runId, status: 'running', path: [], nodes: [], executed: 0, dryRun: options.dryRun === true, statePath };
  const persist = () => {
    mkdirSync(dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n');
    renameSync(temporary, statePath);
  };
  const log = options.deps?.log ?? ((event: string, data: Record<string, unknown>) => debug.log('graph.runner', event, data));
  const visits = new Map<string, number>();
  let current: string | undefined = graph.entryNode;
  persist();
  while (current !== undefined) {
    const node = graph.nodes.find((n) => n.nodeId === current);
    if (!node) throw new Error(`undeclared node: ${current}`);
    if ((visits.get(current) ?? 0) >= node.maxVisits) {
      state.status = 'budget-exceeded';
      log('budget-exceeded', { graphId, runId, nodeId: current });
      persist();
      break;
    }
    visits.set(current, (visits.get(current) ?? 0) + 1);
    state.path.push(current);
    const command = node.recipe?.startsWith('cmd:') ? recipes[node.recipe.slice(4)] : undefined;
    log('node-start', { graphId, runId, nodeId: current, visit: visits.get(current), dryRun: state.dryRun });
    persist();
    let ok = true;
    let exit: number | null = null;
    let error: string | undefined;
    if (command && !state.dryRun) {
      let code: number | null = null;
      const runBash: BashRun = async (body, opts) => {
        const result = await (options.deps?.runBash ?? realRunBash)(body, opts);
        code = result.exitCode;
        return result;
      };
      const ctx = { arguments: '', artifactsDir: dirname(statePath), outputs: {}, resolvedProvider: undefined, resolvedModel: undefined, toolPolicy: {} } as NodeExecContext;
      const result = await executeBashNode({ id: current, type: 'bash', bash: command.command, ...(command.timeout_ms ? { idle_timeout: command.timeout_ms } : {}) } as BashNode, ctx, { runBash } as WorkflowDeps);
      ok = result.ok;
      exit = code;
      error = result.error;
      state.executed++;
    }
    state.nodes.push({ nodeId: current, ok, exit, executed: !!command && !state.dryRun, ...(error ? { error } : {}) });
    log('node-end', { graphId, runId, nodeId: current, ok, exit, dryRun: state.dryRun });
    persist();
    if (graph.terminalNodes.includes(current)) {
      state.status = current === 'failed' || !ok ? 'failed' : 'done';
      persist();
      break;
    }
    current = nextNode(graph.edges, current, state.dryRun ? 'ok' : ok ? 'ok' : 'fail');
    if (current === undefined) {
      state.status = 'failed';
      persist();
    }
  }
  return state;
}

export function latestGraphRun(graphId: string, root = effectiveInstanceRoot()): GraphRunState | null {
  const dir = join(root, 'graph-runs', safeSegment(graphId));
  let files: string[];
  try { files = readdirSync(dir).filter((file) => file.endsWith('.json')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const latest = files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)[0];
  return latest ? JSON.parse(readFileSync(join(dir, latest), 'utf8')) as GraphRunState : null;
}
