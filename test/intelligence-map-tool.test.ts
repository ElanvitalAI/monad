// ── PFC-S5 P5: IntelligenceMap LLM tool + loop-prompt integration ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchIntelligenceMap,
  formatIntelligenceMap,
  buildIntelligenceMapTool,
} from '../src/intelligence-map/tools/intelligence-map';
import {
  logUsage,
  persistCostConfig,
} from '../src/intelligence-map/cost-meter';
import {
  buildLoopPromptSnapshot,
  renderLoopPromptInjection,
} from '../src/auto-research/loop-prompt';
import { BudgetMeter } from '../src/auto-research/budget-meter';
import { ExperimentLedger } from '../src/auto-research/experiment-ledger';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';
import { resolveGoalPaths, ensureGoalDir } from '../src/auto-research/goal-paths';
import {
  dispatchEnterAutoMode,
  resetAutoModeForTest,
} from '../src/auto-research/auto-mode';
import { dispatchResearchPlan } from '../src/auto-research/tools/research-plan';
import { discoverModels, enabledModels } from '../src/intelligence-map/model-catalog';

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), 'im-tool-'));
}

describe('PFC-S5 P5 — IntelligenceMap tool', () => {
  beforeEach(() => { resetAutoModeForTest(); });

  test('dispatch returns structured snapshot with catalog_summary', async () => {
    const home = scratchHome();
    const r = await dispatchIntelligenceMap({
      home,
      env: { ANTHROPIC_API_KEY: 'x' },
    });
    expect(r.catalog_summary.total).toBeGreaterThan(0);
    expect(r.catalog_summary.enabled).toBeGreaterThan(0);
    expect(r.enabled_models.length).toBeGreaterThan(0);
    expect(r.system.cpuCount).toBeGreaterThanOrEqual(1);
    expect(r.cost.totalUsd).toBe(0);
    expect(r.cost_cap).toEqual({});
    expect(r.weekly_cap_status).toBe('ok');
    expect(r.format).toContain('🧠');
  });

  test('enabled_models filter by env — env-keyed models require their env key', async () => {
    const home = scratchHome();
    const env = {};
    const catalog = await discoverModels({ home, env });
    const enabled = enabledModels(catalog, env);
    const r = await dispatchIntelligenceMap({ home, env });
    const enabledIds = new Set(enabled.map(m => m.id));
    const envKeyedModels = catalog.models.filter(m => !m.local && m.envKey);
    expect(envKeyedModels.length).toBeGreaterThan(0);
    for (const model of envKeyedModels) {
      expect(enabledIds.has(model.id)).toBe(false);
    }
    const envKeylessEnabledModels = catalog.models.filter(m => !m.local && !m.envKey);
    for (const model of envKeylessEnabledModels) {
      expect(enabledIds.has(model.id)).toBe(true);
    }
    expect(r.enabled_models.map(m => m.id).sort()).toEqual(enabled.map(m => m.id).sort());
    expect(r.catalog_summary.paid).toBe(envKeylessEnabledModels.length);
  });

  test('weekly cap status reflects usage', async () => {
    const home = scratchHome();
    persistCostConfig({ weeklyCapUsd: 1 }, { home });
    await logUsage(
      { modelId: 'gpt-4o', inputTokens: 0, outputTokens: 0, usd: 0.95 },
      { home, skipAutoAttribution: true },
    );
    const r = await dispatchIntelligenceMap({ home, env: {} });
    expect(r.weekly_cap_status).toBe('warning');
    expect(r.format).toMatch(/cap \$1\.00/);
  });

  test('active_goal pulled from auto-mode session', async () => {
    const home = scratchHome();
    const vaultHome = mkdtempSync(join(tmpdir(), 'im-vault-'));
    const vault = discoverObsidianVault({
      env: { MONAD_OBSIDIAN_VAULT: join(vaultHome, 'vault') },
      cwd: vaultHome,
    });
    await dispatchResearchPlan(
      { action: 'init', goal_slug: 'im-goal', mission: 'M' },
      { vault },
    );
    await dispatchEnterAutoMode({ goal_slug: 'im-goal' }, { vault });
    const r = await dispatchIntelligenceMap({ home, env: { ANTHROPIC_API_KEY: 'x' } });
    expect(r.active_goal).toBe('im-goal');
  });

  test('formatIntelligenceMap returns format string', async () => {
    const home = scratchHome();
    const r = await dispatchIntelligenceMap({ home, env: {} });
    const text = formatIntelligenceMap(r);
    expect(text).toBe(r.format);
    expect(text.split('\n').length).toBeGreaterThanOrEqual(2);
  });

  test('format includes goal cost when active', async () => {
    const home = scratchHome();
    const vaultHome = mkdtempSync(join(tmpdir(), 'im-cost-vault-'));
    const vault = discoverObsidianVault({
      env: { MONAD_OBSIDIAN_VAULT: join(vaultHome, 'vault') },
      cwd: vaultHome,
    });
    await dispatchResearchPlan(
      { action: 'init', goal_slug: 'g', mission: 'M' },
      { vault },
    );
    await dispatchEnterAutoMode({ goal_slug: 'g' }, { vault });
    await logUsage(
      { modelId: 'gpt-4o-mini', inputTokens: 100, outputTokens: 100, usd: 0.15, goalSlug: 'g' },
      { home, skipAutoAttribution: true },
    );
    const r = await dispatchIntelligenceMap({ home, env: {} });
    expect(r.active_goal_cost_usd).toBeCloseTo(0.15);
    expect(r.format).toContain('Active goal: g');
  });

  test('LLM tool spec is well-formed', () => {
    const spec = buildIntelligenceMapTool();
    expect(spec.name).toBe('IntelligenceMap');
    const params = spec.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    expect(params.properties).toEqual({});
  });
});

describe('PFC-S5 P5 — loop-prompt integration', () => {
  beforeEach(() => { resetAutoModeForTest(); });

  test('renderLoopPromptInjection omits Intelligence Map section when not provided', async () => {
    const vaultHome = mkdtempSync(join(tmpdir(), 'lp-vault-1-'));
    const vault = discoverObsidianVault({
      env: { MONAD_OBSIDIAN_VAULT: join(vaultHome, 'vault') },
      cwd: vaultHome,
    });
    const paths = resolveGoalPaths(vault, 'lp1');
    ensureGoalDir(paths);
    const snap = await buildLoopPromptSnapshot({
      vault,
      goalSlug: 'lp1',
      goalRoot: paths.goalRoot,
      budget: new BudgetMeter({}),
      ledger: new ExperimentLedger(paths.goalRoot),
      termination: { kind: 'or', rules: [] },
    });
    const rendered = renderLoopPromptInjection(snap);
    expect(rendered).not.toContain('## Intelligence Map');
  });

  test('renderLoopPromptInjection appends Intelligence Map when ctx provides text', async () => {
    const vaultHome = mkdtempSync(join(tmpdir(), 'lp-vault-2-'));
    const vault = discoverObsidianVault({
      env: { MONAD_OBSIDIAN_VAULT: join(vaultHome, 'vault') },
      cwd: vaultHome,
    });
    const paths = resolveGoalPaths(vault, 'lp2');
    ensureGoalDir(paths);
    const snap = await buildLoopPromptSnapshot({
      vault,
      goalSlug: 'lp2',
      goalRoot: paths.goalRoot,
      budget: new BudgetMeter({}),
      ledger: new ExperimentLedger(paths.goalRoot),
      termination: { kind: 'or', rules: [] },
      intelligenceMap: '🧠 9/9 ready · 2 local · 7 paid\nCPU 12% · RAM 30/64 GB free',
    });
    expect(snap.intelligenceMap).toContain('9/9');
    const rendered = renderLoopPromptInjection(snap);
    expect(rendered).toContain('## Intelligence Map');
    expect(rendered).toContain('9/9 ready');
  });
});
