import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setElanousConfigDir, resetElanousConfigDir } from '../src/elanous-config-dir.js';
import { resetUserConfig } from '../src/user-config.js';
import { buildDevCliSpec, type DevCliExecutor } from '../src/self-dev/dev-cli.js';
import { planDevPipeline, toSelfImplementOptions } from '../src/self-dev/dev-pipeline.js';
import { runSelfImplement } from '../src/self-implement/orchestrator.js';
import { loadGraphTemplates, type GraphTemplateSpec } from '../src/self-implement/graph-yaml.js';
import { defaultGraphsDir } from '../src/self-implement/graph-templates.js';
import { seams } from '../src/self-implement/test-seams.js';

const SELF: DevCliExecutor = { kind: 'self' };

function declaredZeroEdges(template: GraphTemplateSpec): Array<{ from: string; to: string }> {
  return template.edges.flatMap((edge) => [
    ...(edge.observed === 0 && edge.to !== undefined ? [{ from: edge.from, to: edge.to }] : []),
    ...(edge.fallback ?? [])
      .filter((fallback) => fallback.observed === 0)
      .map((fallback) => ({ from: edge.from, to: fallback.node })),
  ]);
}

function declaredZeroEdgesOnDefaultPath(
  template: GraphTemplateSpec,
  nodeNames: readonly string[],
): Array<{ from: string; to: string }> {
  const adjacent = new Set(nodeNames.slice(1).map((to, index) => `${nodeNames[index]}:${to}`));
  return declaredZeroEdges(template).filter(({ from, to }) => adjacent.has(`${from}:${to}`));
}

async function defaultNodeNames(): Promise<string[]> {
  const configDir = mkdtempSync(join(tmpdir(), 'graph-declared-zero-edges-'));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const ledger: Array<{ event: string; data: Record<string, unknown> }> = [];
  try {
    delete process.env.XDG_CONFIG_HOME;
    setElanousConfigDir(configDir);
    resetUserConfig();
    const spec = buildDevCliSpec({ text: 'graph declared zero edge check' }, SELF, {});
    const options = toSelfImplementOptions(
      'graph declared zero edge check',
      planDevPipeline(spec),
      seams({ writeRunLedger: (entry) => ledger.push({ event: entry.event, data: entry.data }) }),
    );
    await runSelfImplement({ ...options, runId: 'run-graph-declared-zero-edges' });
    return ledger
      .filter(({ event }) => event === 'pipeline-node-entry')
      .map(({ data }) => String(data.node));
  } finally {
    resetUserConfig();
    resetElanousConfigDir();
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    rmSync(configDir, { recursive: true, force: true });
  }
}

function graphSpecs(): Readonly<Record<string, GraphTemplateSpec>> {
  const loaded = loadGraphTemplates(defaultGraphsDir());
  expect(loaded.errors).toEqual([]);
  return loaded.templates;
}

function implementSpec(): GraphTemplateSpec {
  const template = graphSpecs()['self-implement'];
  expect(template).toBeDefined();
  return template!;
}

describe('declared zero edges', () => {
  test('collects observed-zero edges and fallbacks from every repository graph YAML', () => {
    const specs = graphSpecs();
    expect(Object.keys(specs).length).toBeGreaterThan(0);
    expect(Object.values(specs).flatMap(declaredZeroEdges)).toContainEqual({ from: 'gate', to: 'main-sync' });
  });

  test('gate fallback preserves main-sync at zero and records observed open-pr traversal', () => {
    const gateFallback = implementSpec().edges.find((edge) => edge.from === 'gate')?.fallback;
    expect(gateFallback).toEqual([
      { node: 'main-sync', requires: ['mergeMain', 'commitWork'], observed: 0 },
      { node: 'open-pr', requires: [], observed: 20 },
    ]);
  });

  test('no observed-zero fallback is adjacent in the existing default execution path', async () => {
    const nodeNames = await defaultNodeNames();
    expect(nodeNames).toEqual(['implement', 'gate', 'open-pr']);
    expect(declaredZeroEdgesOnDefaultPath(implementSpec(), nodeNames)).toEqual([]);
  });

  test('counterfactual observed-zero gate to open-pr is rejected', () => {
    const template = implementSpec();
    const counterfactual: GraphTemplateSpec = {
      ...template,
      edges: template.edges.map((edge) => edge.from !== 'gate' ? edge : {
        ...edge,
        fallback: edge.fallback?.map((fallback) => fallback.node !== 'open-pr' ? fallback : { ...fallback, observed: 0 }),
      }),
    };
    expect(declaredZeroEdgesOnDefaultPath(counterfactual, ['implement', 'gate', 'open-pr'])).toEqual([
      { from: 'gate', to: 'open-pr' },
    ]);
  });

  test('observed-zero gate to main-sync outside the default path is not rejected', () => {
    expect(declaredZeroEdgesOnDefaultPath(implementSpec(), ['implement', 'gate', 'open-pr'])).not.toContainEqual({
      from: 'gate', to: 'main-sync',
    });
  });
});
