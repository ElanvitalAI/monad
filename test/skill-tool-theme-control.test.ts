// FU J (IDX-6 Phase 7) — LLM theme control tool tests.
//
// Covers all four tools: GetActiveTheme, ListThemes, SwitchTheme,
// PreviewTheme. Plus the sample renderer and audit log integration.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  buildAllThemeSamples,
  buildGetActiveThemeTool,
  buildListThemesTool,
  buildPreviewThemeTool,
  buildSwitchThemeTool,
  buildThemeHostTools,
  buildThemeSample,
  type ThemeAuditEvent,
} from '../src/skills/tools/theme-control.js';
import { createThemeService } from '../src/theme/service.js';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  NORD_LIGHT,
  ROSE_PINE_DAWN,
  THEME_REGISTRY,
} from '../src/themes/index.js';

const ORIG_CHALK_LEVEL = chalk.level;

function findHandler(
  tools: ReturnType<typeof buildThemeHostTools>,
  name: string,
): (args: Record<string, unknown>) => Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool.handler;
}

// ── LLMToolSpec factories ────────────────────────────────────────

describe('FU J LLM theme tool specs', () => {
  test('GetActiveTheme spec shape', () => {
    const spec = buildGetActiveThemeTool();
    expect(spec.name).toBe('GetActiveTheme');
    expect(spec.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  test('ListThemes spec shape', () => {
    const spec = buildListThemesTool();
    expect(spec.name).toBe('ListThemes');
    expect(spec.parameters).toHaveProperty('properties');
  });

  test('SwitchTheme spec requires name', () => {
    const spec = buildSwitchThemeTool();
    expect(spec.name).toBe('SwitchTheme');
    const params = spec.parameters as {
      required: string[];
      properties: { name: { type: string } };
    };
    expect(params.required).toEqual(['name']);
    expect(params.properties.name.type).toBe('string');
  });

  test('PreviewTheme spec requires name', () => {
    const spec = buildPreviewThemeTool();
    expect(spec.name).toBe('PreviewTheme');
    const params = spec.parameters as { required: string[] };
    expect(params.required).toEqual(['name']);
  });
});

// ── Host tool handlers ───────────────────────────────────────────

describe('FU J GetActiveTheme handler', () => {
  test('returns snapshot of the current theme', async () => {
    const service = await createThemeService({ initial: CATPPUCCIN_LATTE });
    const tools = buildThemeHostTools({ service });
    const result = await findHandler(tools, 'GetActiveTheme')({});
    expect(result).toEqual({
      name: 'catppuccin-latte',
      isDark: false,
      isPastel: true,
    });
  });

  test('emits audit event', async () => {
    const service = await createThemeService();
    const events: ThemeAuditEvent[] = [];
    const tools = buildThemeHostTools({
      service,
      onAudit: (e) => events.push(e),
    });
    await findHandler(tools, 'GetActiveTheme')({});
    expect(events).toHaveLength(1);
    expect(events[0]!.tool).toBe('GetActiveTheme');
    expect(events[0]!.result).toBe('ok');
  });
});

describe('FU J ListThemes handler', () => {
  test('returns all registered presets', async () => {
    const service = await createThemeService();
    const tools = buildThemeHostTools({ service });
    const result = (await findHandler(tools, 'ListThemes')({})) as {
      themes: Array<{ name: string; isDark: boolean; isPastel: boolean }>;
    };
    expect(result.themes.length).toBe(THEME_REGISTRY.length);
    const names = result.themes.map((t) => t.name);
    expect(names).toContain('catppuccin-mocha');
    expect(names).toContain('rose-pine-dawn');
  });
});

describe('FU J SwitchTheme handler', () => {
  test('valid name switches the service + returns ok', async () => {
    const service = await createThemeService();
    const tools = buildThemeHostTools({ service });
    const result = (await findHandler(tools, 'SwitchTheme')({
      name: 'rose-pine-dawn',
    })) as { ok: boolean; previousTheme: string; newTheme: string };
    expect(result.ok).toBe(true);
    expect(result.previousTheme).toBe('catppuccin-mocha');
    expect(result.newTheme).toBe('rose-pine-dawn');
    expect(service.current.name).toBe('rose-pine-dawn');
  });

  test('missing name returns ok:false + helpful message', async () => {
    const service = await createThemeService();
    const tools = buildThemeHostTools({ service });
    const result = (await findHandler(tools, 'SwitchTheme')({})) as {
      ok: boolean;
      reason: string;
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('required');
    expect(service.current.name).toBe('catppuccin-mocha'); // unchanged
  });

  test('unknown preset returns ok:false + references ListThemes', async () => {
    const service = await createThemeService();
    const tools = buildThemeHostTools({ service });
    const result = (await findHandler(tools, 'SwitchTheme')({
      name: 'neverheardof',
    })) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ListThemes');
  });

  test('switch success emits audit with previous + new theme', async () => {
    const service = await createThemeService();
    const events: ThemeAuditEvent[] = [];
    const tools = buildThemeHostTools({
      service,
      onAudit: (e) => events.push(e),
    });
    await findHandler(tools, 'SwitchTheme')({ name: 'nord-light' });
    expect(events[0]!.tool).toBe('SwitchTheme');
    expect(events[0]!.result).toBe('ok');
    expect(events[0]!.previousTheme).toBe('catppuccin-mocha');
    expect(events[0]!.newTheme).toBe('nord-light');
  });

  test('unknown-preset rejection is audited separately', async () => {
    const service = await createThemeService();
    const events: ThemeAuditEvent[] = [];
    const tools = buildThemeHostTools({
      service,
      onAudit: (e) => events.push(e),
    });
    await findHandler(tools, 'SwitchTheme')({ name: 'bogus' });
    expect(events[0]!.result).toBe('rejected');
    expect(events[0]!.rejectionReason).toBe('unknown preset');
    expect(events[0]!.previousTheme).toBe('catppuccin-mocha');
  });

  test('missing-name rejection is audited', async () => {
    const service = await createThemeService();
    const events: ThemeAuditEvent[] = [];
    const tools = buildThemeHostTools({
      service,
      onAudit: (e) => events.push(e),
    });
    await findHandler(tools, 'SwitchTheme')({});
    expect(events[0]!.result).toBe('rejected');
    expect(events[0]!.rejectionReason).toBe('missing name');
  });
});

describe('FU J PreviewTheme handler', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('returns sample for valid preset without changing service', async () => {
    const service = await createThemeService({ initial: CATPPUCCIN_MOCHA });
    const tools = buildThemeHostTools({ service });
    const result = (await findHandler(tools, 'PreviewTheme')({
      name: 'rose-pine-dawn',
    })) as {
      ok: boolean;
      sample: {
        themeName: string;
        button: string;
        progressBarDone: string;
      };
    };
    expect(result.ok).toBe(true);
    expect(result.sample.themeName).toBe('rose-pine-dawn');
    expect(result.sample.button).toContain('Focused Button');
    expect(result.sample.progressBarDone).toContain('██');
    // Service itself should NOT have switched.
    expect(service.current.name).toBe('catppuccin-mocha');
  });

  test('missing name rejects with helpful message', async () => {
    const service = await createThemeService();
    const tools = buildThemeHostTools({ service });
    const result = (await findHandler(tools, 'PreviewTheme')({})) as {
      ok: boolean;
      reason: string;
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('required');
  });

  test('unknown preset rejects + references ListThemes', async () => {
    const service = await createThemeService();
    const tools = buildThemeHostTools({ service });
    const result = (await findHandler(tools, 'PreviewTheme')({
      name: 'does-not-exist',
    })) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ListThemes');
  });
});

describe('FU J buildThemeSample', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('produces a self-contained snippet set per theme', () => {
    const sample = buildThemeSample(NORD_LIGHT);
    expect(sample.themeName).toBe('nord-light');
    expect(sample.button).toContain('Focused Button');
    expect(sample.progressBarDone.length).toBeGreaterThan(10);
    expect(sample.statusBadgeError).toContain('Error');
    expect(sample.paneTitleActive).toContain('Pane title');
  });

  test('samples differ across themes', () => {
    const mochaSample = buildThemeSample(CATPPUCCIN_MOCHA);
    const latteSample = buildThemeSample(CATPPUCCIN_LATTE);
    expect(mochaSample.button).not.toBe(latteSample.button);
    expect(mochaSample.progressBarDone).not.toBe(latteSample.progressBarDone);
  });

  test('flags isDark + isPastel correctly', () => {
    expect(buildThemeSample(CATPPUCCIN_MOCHA).isDark).toBe(true);
    expect(buildThemeSample(CATPPUCCIN_MOCHA).isPastel).toBe(false);
    expect(buildThemeSample(CATPPUCCIN_LATTE).isDark).toBe(false);
    expect(buildThemeSample(CATPPUCCIN_LATTE).isPastel).toBe(true);
  });

  test('buildAllThemeSamples covers every registered preset', () => {
    const all = buildAllThemeSamples();
    expect(all.length).toBe(THEME_REGISTRY.length);
    const names = all.map((s) => s.themeName);
    for (const t of THEME_REGISTRY) expect(names).toContain(t.name);
  });
});

describe('FU J end-to-end LLM flow', () => {
  test('LLM workflow: list → preview → switch produces expected audit trail', async () => {
    const service = await createThemeService();
    const events: ThemeAuditEvent[] = [];
    const tools = buildThemeHostTools({
      service,
      onAudit: (e) => events.push(e),
    });

    // Step 1: list
    await findHandler(tools, 'ListThemes')({});
    // Step 2: preview
    await findHandler(tools, 'PreviewTheme')({ name: 'rose-pine-dawn' });
    // Step 3: switch
    await findHandler(tools, 'SwitchTheme')({ name: 'rose-pine-dawn' });

    expect(events.map((e) => e.tool)).toEqual([
      'ListThemes',
      'PreviewTheme',
      'SwitchTheme',
    ]);
    expect(events.every((e) => e.result === 'ok')).toBe(true);
    expect(service.current.name).toBe('rose-pine-dawn');
  });

  test('audit sink is optional (no-op when absent)', async () => {
    const service = await createThemeService();
    const tools = buildThemeHostTools({ service }); // no onAudit
    // Should not throw.
    await findHandler(tools, 'GetActiveTheme')({});
    await findHandler(tools, 'SwitchTheme')({ name: 'rose-pine-dawn' });
    expect(service.current.name).toBe('rose-pine-dawn');
  });
});
