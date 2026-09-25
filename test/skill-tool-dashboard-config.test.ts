import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildDashboardConfigGetTool,
  buildDashboardConfigSetTool,
  dispatchDashboardConfigGet,
  dispatchDashboardConfigSet,
  initDashboardConfigTools,
  _resetDashboardConfigToolsForTesting,
  CONFIG_KEYS,
  CONFIG_META,
} from '../src/skills/tools/dashboard-config.js';

afterEach(() => {
  _resetDashboardConfigToolsForTesting();
});

describe('CONFIG_KEYS', () => {
  test('includes the documented subset', () => {
    expect(CONFIG_KEYS).toContain('dashboard.chatOnlyMode');
    expect(CONFIG_KEYS).toContain('dashboard.promptBank.enabled');
    expect(CONFIG_KEYS).toContain('dashboard.promptBank.dashboardTurns');
    expect(CONFIG_KEYS).toContain('dashboard.promptBank.skillRuns');
    expect(CONFIG_KEYS).toContain('dashboard.promptBank.budgetTokens');
    expect(CONFIG_KEYS).toContain('dashboard.promptBank.limit');
    expect(CONFIG_KEYS).toContain('dashboard.promptBank.record');
    expect(CONFIG_KEYS).toContain('workingDir.showHidden');
    expect(CONFIG_KEYS).toContain('preview.source');
  });

  test('every key has metadata', () => {
    for (const k of CONFIG_KEYS) {
      expect(CONFIG_META[k]).toBeDefined();
      expect(CONFIG_META[k]!.description.length).toBeGreaterThan(0);
    }
  });
});

describe('DashboardConfigGet', () => {
  test('schema lists the allow-list', () => {
    const t = buildDashboardConfigGetTool();
    const p = t.parameters as { properties: { key: { enum?: string[] } }; required?: string[] };
    expect(p.properties.key.enum).toEqual([...CONFIG_KEYS]);
    expect(p.required).toContain('key');
  });

  test('returns value + type metadata', async () => {
    const r = await dispatchDashboardConfigGet(
      { key: 'dashboard.chatOnlyMode' },
      { getter: () => true },
    );
    expect(r.output).toContain('dashboard.chatOnlyMode');
    expect(r.output).toContain('true');
    expect(r.output).toContain('type: boolean');
  });

  test('rejects unknown key', async () => {
    await expect(dispatchDashboardConfigGet(
      { key: 'api.secret' },
      { getter: () => 'nope' },
    )).rejects.toThrow(/must be one of/);
  });

  test('throws when getter not wired', async () => {
    await expect(dispatchDashboardConfigGet({ key: 'dashboard.chatOnlyMode' }))
      .rejects.toThrow(/not wired/);
  });

  test('enum metadata surfaces choices', async () => {
    const r = await dispatchDashboardConfigGet(
      { key: 'preview.source' },
      { getter: () => 'smart' },
    );
    expect(r.output).toContain('choices: smart');
  });
});

describe('DashboardConfigSet', () => {
  test('schema requires both key + value', () => {
    const t = buildDashboardConfigSetTool();
    const p = t.parameters as { required?: string[] };
    expect(p.required).toEqual(['key', 'value']);
  });

  test('type mismatch rejected before approver', async () => {
    let approved = 0;
    await expect(dispatchDashboardConfigSet(
      { key: 'dashboard.chatOnlyMode', value: 'not-a-boolean' },
      {
        getter: () => false,
        setter: async () => {},
        approver: async () => { approved++; return true; },
      },
    )).rejects.toThrow(/expects boolean/);
    expect(approved).toBe(0);
  });

  test('integer range enforced', async () => {
    await expect(dispatchDashboardConfigSet(
      { key: 'input.maxLines', value: 99 },
      {
        getter: () => 1, setter: async () => {},
        approver: async () => true,
      },
    )).rejects.toThrow(/must be ≤ 16/);

    await expect(dispatchDashboardConfigSet(
      { key: 'input.maxLines', value: 0 },
      {
        getter: () => 1, setter: async () => {},
        approver: async () => true,
      },
    )).rejects.toThrow(/must be ≥ 1/);
  });

  test('prompt bank integer ranges are enforced', async () => {
    await expect(dispatchDashboardConfigSet(
      { key: 'dashboard.promptBank.budgetTokens', value: 99 },
      {
        getter: () => 1200, setter: async () => {},
        approver: async () => true,
      },
    )).rejects.toThrow(/must be ≥ 100/);

    await expect(dispatchDashboardConfigSet(
      { key: 'dashboard.promptBank.limit', value: 101 },
      {
        getter: () => 8, setter: async () => {},
        approver: async () => true,
      },
    )).rejects.toThrow(/must be ≤ 100/);
  });

  test('enum value rejected when outside choices', async () => {
    await expect(dispatchDashboardConfigSet(
      { key: 'workingDir.sortMode', value: 'random' },
      {
        getter: () => 'name', setter: async () => {},
        approver: async () => true,
      },
    )).rejects.toThrow(/must be one of/);
  });

  test('happy path: valid value + approved → setter called', async () => {
    let setPair: [string, unknown] = ['', null];
    const r = await dispatchDashboardConfigSet(
      { key: 'dashboard.chatOnlyMode', value: true },
      {
        getter: () => false,
        setter: async (k, v) => { setPair = [k, v]; },
        approver: async () => true,
      },
    );
    expect(r.output).toContain('false → true');
    expect(setPair).toEqual(['dashboard.chatOnlyMode', true]);
  });

  test('happy path: prompt bank enabled toggle is allowed', async () => {
    let setPair: [string, unknown] = ['', null];
    const r = await dispatchDashboardConfigSet(
      { key: 'dashboard.promptBank.enabled', value: true },
      {
        getter: () => false,
        setter: async (k, v) => { setPair = [k, v]; },
        approver: async () => true,
      },
    );
    expect(r.output).toContain('false → true');
    expect(setPair).toEqual(['dashboard.promptBank.enabled', true]);
  });

  test('happy path: prompt bank range keys are allowed', async () => {
    const setPairs: Array<[string, unknown]> = [];
    const deps = {
      getter: (k: string) => k.endsWith('limit') ? 8 : 1200,
      setter: async (k: string, v: unknown) => { setPairs.push([k, v]); },
      approver: async () => true,
    };

    await dispatchDashboardConfigSet(
      { key: 'dashboard.promptBank.budgetTokens', value: 2400 },
      deps,
    );
    await dispatchDashboardConfigSet(
      { key: 'dashboard.promptBank.limit', value: 12 },
      deps,
    );

    expect(setPairs).toEqual([
      ['dashboard.promptBank.budgetTokens', 2400],
      ['dashboard.promptBank.limit', 12],
    ]);
  });

  test('approver rejection surfaces rejected error', async () => {
    await expect(dispatchDashboardConfigSet(
      { key: 'dashboard.chatOnlyMode', value: true },
      {
        getter: () => false,
        setter: async () => {},
        approver: async () => false,
      },
    )).rejects.toThrow(/rejected by user/);
  });

  test('no approver wired → fail-closed', async () => {
    await expect(dispatchDashboardConfigSet(
      { key: 'dashboard.chatOnlyMode', value: true },
      {
        getter: () => false,
        setter: async () => {},
      },
    )).rejects.toThrow(/no approver/);
  });

  test('no-op when value matches existing', async () => {
    let setCount = 0;
    const r = await dispatchDashboardConfigSet(
      { key: 'dashboard.chatOnlyMode', value: false },
      {
        getter: () => false,
        setter: async () => { setCount++; },
        approver: async () => true,
      },
    );
    expect(r.output).toContain('no-op');
    expect(setCount).toBe(0);
  });

  test('initDashboardConfigTools wires the default', async () => {
    let captured: [string, unknown] = ['', null];
    initDashboardConfigTools(
      () => 'name',
      async (k, v) => { captured = [k, v]; },
      async () => true,
    );
    await dispatchDashboardConfigSet({
      key: 'workingDir.sortMode', value: 'mtime',
    });
    expect(captured).toEqual(['workingDir.sortMode', 'mtime']);
  });

  test('enum get returns choices in metadata', async () => {
    const r = await dispatchDashboardConfigGet(
      { key: 'workingDir.sortMode' },
      { getter: () => 'name' },
    );
    expect(r.output).toContain('choices: name, mtime, size');
  });
});
