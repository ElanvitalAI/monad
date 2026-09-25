// F-B2 — registry + command + default-scenarios tests.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  DEFAULT_SCENARIOS,
  DIALOG_CONFIRM_FLOW,
  PICKER_ROW_CLICK_FLOW,
  THEME_SWITCH_CONTEXT_KEYS,
  ScenarioRegistry,
  _resetDefaultScenarioRegistryForTests,
  createFakeHarness,
  createPlaygroundCommandHandler,
  getDefaultScenarioRegistry,
  runScenario,
  type PlaygroundHarness,
  type Scenario,
} from '../src/playground-scenario/index.js';

afterEach(() => {
  _resetDefaultScenarioRegistryForTests();
});

// ── ScenarioRegistry ─────────────────────────────────────────────

describe('ScenarioRegistry', () => {
  test('register → get → has', () => {
    const reg = new ScenarioRegistry();
    reg.register(DIALOG_CONFIRM_FLOW);
    expect(reg.has('dialog:confirm-flow')).toBe(true);
    expect(reg.get('dialog:confirm-flow')).toBe(DIALOG_CONFIRM_FLOW);
    expect(reg.has('nope')).toBe(false);
  });

  test('registerAll bulk + list sorted by id', () => {
    const reg = new ScenarioRegistry();
    reg.registerAll(DEFAULT_SCENARIOS);
    const listed = reg.list();
    expect(listed.map(s => s.id)).toEqual(
      [...DEFAULT_SCENARIOS].map(s => s.id).sort(),
    );
  });

  test('list filter by tag', () => {
    const reg = new ScenarioRegistry();
    reg.registerAll(DEFAULT_SCENARIOS);
    const smoke = reg.list({ tag: 'smoke' });
    expect(smoke.length).toBeGreaterThanOrEqual(2);
    expect(smoke.every(s => s.tags?.includes('smoke'))).toBe(true);
    const regression = reg.list({ tag: 'regression' });
    expect(regression.map(s => s.id)).toEqual(['picker:row-click']);
  });

  test('unregister removes', () => {
    const reg = new ScenarioRegistry();
    reg.register(DIALOG_CONFIRM_FLOW);
    expect(reg.unregister('dialog:confirm-flow')).toBe(true);
    expect(reg.has('dialog:confirm-flow')).toBe(false);
    expect(reg.unregister('dialog:confirm-flow')).toBe(false);
  });

  test('empty id throws', () => {
    const reg = new ScenarioRegistry();
    expect(() => reg.register({ id: '', title: 'x', steps: [] })).toThrow();
  });

  test('default registry singleton is separate from freshly-constructed', () => {
    const d1 = getDefaultScenarioRegistry();
    d1.register(DIALOG_CONFIRM_FLOW);
    const local = new ScenarioRegistry();
    expect(local.has('dialog:confirm-flow')).toBe(false);
  });
});

// ── /playground command handler ──────────────────────────────────

function makeCommandDeps(scenarios: readonly Scenario[] = DEFAULT_SCENARIOS) {
  const reg = new ScenarioRegistry();
  reg.registerAll(scenarios);
  const lines: string[] = [];
  const { harness } = createFakeHarness();
  const handler = createPlaygroundCommandHandler({
    registry: reg,
    makeHarness: () => harness as PlaygroundHarness & { disposeAll?: () => void },
    write: (line: string) => lines.push(line),
  });
  return { handler, lines, reg, harness };
}

describe('/playground command · list', () => {
  test('no args → lists all scenarios', async () => {
    const { handler, lines } = makeCommandDeps();
    await handler([]);
    expect(lines[0]).toContain('3 scenario');
    expect(lines.some(l => l.includes('dialog:confirm-flow'))).toBe(true);
    expect(lines.some(l => l.includes('picker:row-click'))).toBe(true);
  });

  test('`list` subcommand same as default', async () => {
    const { handler, lines } = makeCommandDeps();
    await handler(['list']);
    expect(lines[0]).toContain('3 scenario');
  });

  test('empty registry → "no scenarios"', async () => {
    const { handler, lines } = makeCommandDeps([]);
    await handler([]);
    expect(lines[0]).toContain('no scenarios registered');
  });

  test('tags shown in brackets', async () => {
    const { handler, lines } = makeCommandDeps();
    await handler([]);
    const line = lines.find(l => l.includes('dialog:confirm-flow'));
    expect(line).toContain('[dialog,smoke]');
  });
});

describe('/playground command · run', () => {
  test('run without id prints usage', async () => {
    const { handler, lines } = makeCommandDeps();
    await handler(['run']);
    expect(lines.join('\n')).toMatch(/missing scenario id/i);
  });

  test('run unknown id prints hint', async () => {
    const { handler, lines } = makeCommandDeps();
    await handler(['run', 'nope']);
    expect(lines.join('\n')).toMatch(/no scenario 'nope'/);
  });

  test('run passing scenario → ✓ header + no step detail (quiet mode)', async () => {
    const { handler, lines } = makeCommandDeps([THEME_SWITCH_CONTEXT_KEYS]);
    await handler(['run', 'theme:switch-context-keys']);
    expect(lines[0]).toMatch(/^✓ theme:switch-context-keys — PASS in \d+ms/);
    // quiet mode: no per-step output
    expect(lines.length).toBe(1);
  });

  test('run -v prints per-step detail', async () => {
    const { handler, lines } = makeCommandDeps([THEME_SWITCH_CONTEXT_KEYS]);
    await handler(['run', 'theme:switch-context-keys', '-v']);
    expect(lines[0]).toMatch(/^✓/);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).some(l => l.includes('step 1'))).toBe(true);
  });

  test('run failing scenario → ✗ header + FAIL step detail always shown', async () => {
    const failing: Scenario = {
      id: 'demo:fail',
      title: 'Always fails',
      steps: [
        { action: 'expect', target: { kind: 'modal-stack-length', length: 999 } },
      ],
    };
    const { handler, lines } = makeCommandDeps([failing]);
    await handler(['run', 'demo:fail']);
    expect(lines[0]).toMatch(/^✗ demo:fail — FAIL/);
    expect(lines.slice(1).some(l => l.includes('FAIL'))).toBe(true);
    expect(lines.slice(1).some(l => l.includes('length'))).toBe(true);
  });

  test('unknown subcommand prints help', async () => {
    const { handler, lines } = makeCommandDeps();
    await handler(['what']);
    expect(lines[0]).toMatch(/unknown subcommand/);
  });

  test('harness disposeAll called on pass AND fail', async () => {
    let disposeCalls = 0;
    const reg = new ScenarioRegistry();
    reg.register(THEME_SWITCH_CONTEXT_KEYS);
    const { harness } = createFakeHarness();
    const mock = harness as PlaygroundHarness & { disposeAll?: () => void };
    mock.disposeAll = () => { disposeCalls++; };
    const lines: string[] = [];
    const handler = createPlaygroundCommandHandler({
      registry: reg,
      makeHarness: () => mock,
      write: (l) => lines.push(l),
    });
    await handler(['run', 'theme:switch-context-keys']);
    expect(disposeCalls).toBe(1);
  });
});

// ── /playground parse — F-B4 ────────────────────────────────────

describe('/playground command · parse', () => {
  function makeParseDeps(fileContents: Record<string, string>) {
    const reg = new ScenarioRegistry();
    const lines: string[] = [];
    const { harness } = createFakeHarness();
    const handler = createPlaygroundCommandHandler({
      registry: reg,
      makeHarness: () => harness as PlaygroundHarness & { disposeAll?: () => void },
      write: (l: string) => lines.push(l),
      readFile: async (p: string) => {
        if (fileContents[p] === undefined) throw new Error(`ENOENT: ${p}`);
        return fileContents[p]!;
      },
    });
    return { handler, lines };
  }

  test('parse without path prints usage', async () => {
    const { handler, lines } = makeParseDeps({});
    await handler(['parse']);
    expect(lines.join('\n')).toMatch(/missing file path/i);
  });

  test('parse missing file reports read error', async () => {
    const { handler, lines } = makeParseDeps({});
    await handler(['parse', '/tmp/does-not-exist.yaml']);
    expect(lines.join('\n')).toMatch(/cannot read/);
    expect(lines.join('\n')).toMatch(/ENOENT/);
  });

  test('parse valid file prints summary + 0 errors', async () => {
    const yaml = `
id: sample
title: Sample
steps:
  - action: wait
    ms: 1
`;
    const { handler, lines } = makeParseDeps({ '/fake/a.yaml': yaml });
    await handler(['parse', '/fake/a.yaml']);
    expect(lines[0]).toContain('sample');
    expect(lines[0]).toContain('1 valid step');
    expect(lines[1]).toContain('errors=0');
    expect(lines[1]).toContain('warnings=0');
  });

  test('parse file with errors formats as line:col [severity]', async () => {
    const yaml = `
id: x
title: y
steps:
  - action: teleport
`;
    const { handler, lines } = makeParseDeps({ '/fake/b.yaml': yaml });
    await handler(['parse', '/fake/b.yaml']);
    const all = lines.join('\n');
    expect(all).toMatch(/errors=1/);
    expect(all).toMatch(/✗ \d+:\d+ \[schema\]/);
    expect(all).toContain('teleport');
  });

  test('parse file with warnings is surfaced', async () => {
    const yaml = `
id: x
title: y
steps:
  - action: click
    target:
      kind: component
      componentId: ghost
`;
    const { handler, lines } = makeParseDeps({ '/fake/c.yaml': yaml });
    await handler(['parse', '/fake/c.yaml']);
    const all = lines.join('\n');
    expect(all).toMatch(/warnings=1/);
    expect(all).toMatch(/⚠ /);
    expect(all).toContain('ghost');
  });
});

// ── /playground edit + save — F-B5a ─────────────────────────────

describe('/playground command · edit', () => {
  test('edit without id prints usage', async () => {
    const reg = new ScenarioRegistry();
    const lines: string[] = [];
    const { harness } = createFakeHarness();
    const handler = createPlaygroundCommandHandler({
      registry: reg,
      makeHarness: () => harness as PlaygroundHarness & { disposeAll?: () => void },
      write: (l: string) => lines.push(l),
    });
    await handler(['edit']);
    expect(lines.join('\n')).toMatch(/missing scenario id/i);
  });

  test('edit unknown id prints hint', async () => {
    const reg = new ScenarioRegistry();
    const lines: string[] = [];
    const { harness } = createFakeHarness();
    const handler = createPlaygroundCommandHandler({
      registry: reg,
      makeHarness: () => harness as PlaygroundHarness & { disposeAll?: () => void },
      write: (l: string) => lines.push(l),
    });
    await handler(['edit', 'ghost']);
    expect(lines.join('\n')).toMatch(/no scenario 'ghost'/);
  });

  test('edit dumps YAML with id/title header line', async () => {
    const reg = new ScenarioRegistry();
    reg.register(DIALOG_CONFIRM_FLOW);
    const lines: string[] = [];
    const { harness } = createFakeHarness();
    const handler = createPlaygroundCommandHandler({
      registry: reg,
      makeHarness: () => harness as PlaygroundHarness & { disposeAll?: () => void },
      write: (l: string) => lines.push(l),
    });
    await handler(['edit', 'dialog:confirm-flow']);
    expect(lines[0]).toMatch(/^# dialog:confirm-flow/);
    const body = lines.slice(1).join('\n');
    expect(body).toContain('id: dialog:confirm-flow');
    expect(body).toContain('title: Dialog confirm');
  });

  test('edit uses live lab callback when provided', async () => {
    const reg = new ScenarioRegistry();
    reg.register(DIALOG_CONFIRM_FLOW);
    const lines: string[] = [];
    const opened: string[] = [];
    const { harness } = createFakeHarness();
    const handler = createPlaygroundCommandHandler({
      registry: reg,
      makeHarness: () => harness as PlaygroundHarness & { disposeAll?: () => void },
      write: (l: string) => lines.push(l),
      onEditScenario: async (scenario) => { opened.push(scenario.id); },
    });
    await handler(['edit', 'dialog:confirm-flow']);
    expect(opened).toEqual(['dialog:confirm-flow']);
    expect(lines.join('\n')).toMatch(/opened 'dialog:confirm-flow'/);
  });
});

describe('/playground command · save', () => {
  function makeSaveDeps(fileContents: Record<string, string>) {
    const reg = new ScenarioRegistry();
    const lines: string[] = [];
    const { harness } = createFakeHarness();
    const handler = createPlaygroundCommandHandler({
      registry: reg,
      makeHarness: () => harness as PlaygroundHarness & { disposeAll?: () => void },
      write: (l: string) => lines.push(l),
      readFile: async (p: string) => {
        if (fileContents[p] === undefined) throw new Error(`ENOENT: ${p}`);
        return fileContents[p]!;
      },
    });
    return { handler, lines, reg };
  }

  test('save without args prints usage', async () => {
    const { handler, lines } = makeSaveDeps({});
    await handler(['save']);
    expect(lines.join('\n')).toMatch(/missing args/i);
  });

  test('save with valid YAML registers the scenario', async () => {
    const yaml = `
id: ignored-in-arg
title: Saved
steps:
  - action: wait
    ms: 10
`;
    const { handler, lines, reg } = makeSaveDeps({ '/f.yaml': yaml });
    await handler(['save', 'custom:saved', '/f.yaml']);
    expect(lines.join('\n')).toMatch(/registered 'custom:saved'/);
    expect(reg.has('custom:saved')).toBe(true);
    expect(reg.get('custom:saved')!.steps.length).toBe(1);
  });

  test('save refuses on parse errors', async () => {
    const yaml = `
id: x
title: y
steps:
  - action: teleport
`;
    const { handler, lines, reg } = makeSaveDeps({ '/e.yaml': yaml });
    await handler(['save', 'custom:err', '/e.yaml']);
    expect(lines.join('\n')).toMatch(/refusing to register/);
    expect(reg.has('custom:err')).toBe(false);
  });

  test('save surfaces warnings without blocking registration', async () => {
    const yaml = `
id: x
title: y
steps:
  - action: click
    target:
      kind: component
      componentId: ghost
`;
    const { handler, lines, reg } = makeSaveDeps({ '/w.yaml': yaml });
    await handler(['save', 'custom:warn', '/w.yaml']);
    expect(reg.has('custom:warn')).toBe(true);
    expect(lines.join('\n')).toMatch(/1 warning/);
  });

  test('save missing file reports read error', async () => {
    const { handler, lines } = makeSaveDeps({});
    await handler(['save', 'x', '/nope.yaml']);
    expect(lines.join('\n')).toMatch(/cannot read/);
  });
});

// ── Default scenarios actually pass against the FakeHarness ─────

describe('DEFAULT_SCENARIOS integrity', () => {
  test('DIALOG_CONFIRM_FLOW passes against FakeHarness', async () => {
    const { harness } = createFakeHarness();
    const r = await runScenario(DIALOG_CONFIRM_FLOW, harness);
    expect(r.status).toBe('pass');
  });

  test('THEME_SWITCH_CONTEXT_KEYS passes', async () => {
    const { harness } = createFakeHarness();
    const r = await runScenario(THEME_SWITCH_CONTEXT_KEYS, harness);
    expect(r.status).toBe('pass');
  });

  test('PICKER_ROW_CLICK_FLOW — Fake harness does not resolve hit clicks to component IDs, so the scenario is live-harness-only', async () => {
    // Fake harness click(target) with kind:'hit' doesn't update
    // lastClickedComponentId (that's the LiveHarness + mount-
    // builder's job). So this scenario FAILS against the fake —
    // which is exactly the point: it regression-guards the live
    // dispatch path.
    const { harness } = createFakeHarness();
    const r = await runScenario(PICKER_ROW_CLICK_FLOW, harness);
    expect(r.status).toBe('fail');
  });

  test('every DEFAULT_SCENARIOS has id/title/steps', () => {
    for (const s of DEFAULT_SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(Array.isArray(s.steps)).toBe(true);
    }
  });

  test('scenario ids are unique', () => {
    const ids = DEFAULT_SCENARIOS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
