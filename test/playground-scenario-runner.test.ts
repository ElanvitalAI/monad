// F-B1 — Scenario runner unit tests.
//
// Drives `runScenario` against the in-memory `FakeHarness` to lock
// down every step type + failure mode. F-B2's live integration
// will reuse the same runner, so these invariants protect every
// downstream scenario the playground UI ends up running.

import { describe, expect, test } from 'bun:test';

import {
  createFakeHarness,
  runScenario,
  type Scenario,
} from '../src/playground-scenario/index.js';

function mkScenario(steps: Scenario['steps'], setup?: Scenario['setup']): Scenario {
  return { id: 'test:scenario', title: 'Test scenario', steps, setup };
}

describe('runScenario · setup', () => {
  test('applies theme', async () => {
    const { harness, state } = createFakeHarness();
    await runScenario(
      mkScenario([], { theme: 'elanous-pastel-default' }),
      harness,
    );
    expect(state.theme).toBe('elanous-pastel-default');
  });

  test('applies initial mounts in order', async () => {
    const { harness, state } = createFakeHarness();
    await runScenario(
      mkScenario([], {
        mount: [
          { id: 'dialog-1', kind: 'dialog', props: { title: 'A', buttons: [] } },
          { id: 'btn-ok', kind: 'button', props: { label: 'OK' } },
        ],
      }),
      harness,
    );
    expect(state.modalStack).toEqual(['dialog-1', 'btn-ok']);
  });

  test('applies context-key presets', async () => {
    const { harness, state } = createFakeHarness();
    await runScenario(
      mkScenario([], { contextKeys: { focusMode: 'input' } as never }),
      harness,
    );
    expect(state.contextKeys.focusMode).toBe('input');
  });

  test('setup throw → scenario errors before any step runs', async () => {
    const { harness } = createFakeHarness();
    // Patch mount to throw.
    harness.mount = () => { throw new Error('boom'); };
    const result = await runScenario(
      mkScenario(
        [{ action: 'key', event: { name: 'enter' } as never }],
        { mount: [{ id: 'x', kind: 'button', props: { label: 'X' } }] },
      ),
      harness,
    );
    expect(result.status).toBe('error');
    expect(result.stepResults[0]!.message).toContain('setup failed');
    expect(result.stepResults[0]!.message).toContain('boom');
  });
});

describe('runScenario · click / key / theme / dismiss', () => {
  test('click by component-id records lastClickedComponentId', async () => {
    const { harness, state } = createFakeHarness();
    const result = await runScenario(
      mkScenario([
        { action: 'click', target: { kind: 'component', componentId: 'btn-ok' } },
        { action: 'expect', target: { kind: 'last-clicked', componentId: 'btn-ok' } },
      ]),
      harness,
    );
    expect(result.status).toBe('pass');
    expect(state.lastClickedComponentId).toBe('btn-ok');
  });

  test('right-click vs left-click recorded on the event log', async () => {
    const { harness, state } = createFakeHarness();
    await runScenario(
      mkScenario([
        { action: 'click', target: { kind: 'component', componentId: 'btn-1' } },
        { action: 'click', target: { kind: 'component', componentId: 'btn-2' }, button: 'right' },
      ]),
      harness,
    );
    const clickEvents = state.events.filter(e => e.type === 'click');
    expect(clickEvents).toHaveLength(2);
    expect(clickEvents[0]).toMatchObject({ button: 'left' });
    expect(clickEvents[1]).toMatchObject({ button: 'right' });
  });

  test('key event forwarded to harness', async () => {
    const { harness, state } = createFakeHarness();
    await runScenario(
      mkScenario([{ action: 'key', event: { name: 'enter' } as never }]),
      harness,
    );
    expect(state.events.some(e => e.type === 'key')).toBe(true);
  });

  test('theme switch mid-scenario', async () => {
    const { harness, state } = createFakeHarness({ theme: 'catppuccin-mocha' });
    await runScenario(
      mkScenario([{ action: 'theme', name: 'nord-light' }]),
      harness,
    );
    expect(state.theme).toBe('nord-light');
  });

  test('dismiss with id pops that specific modal', async () => {
    const { harness, state } = createFakeHarness({ modalStack: ['a', 'b', 'c'] });
    await runScenario(
      mkScenario([{ action: 'dismiss', modalId: 'b' }]),
      harness,
    );
    expect(state.modalStack).toEqual(['a', 'c']);
  });

  test('dismiss without id pops topmost', async () => {
    const { harness, state } = createFakeHarness({ modalStack: ['a', 'b'] });
    await runScenario(
      mkScenario([{ action: 'dismiss' }]),
      harness,
    );
    expect(state.modalStack).toEqual(['a']);
  });
});

describe('runScenario · expect assertions', () => {
  test('context-key pass', async () => {
    const { harness } = createFakeHarness();
    const result = await runScenario(
      mkScenario([
        { action: 'set-context-key', key: 'dialogOpen' as never, value: true },
        { action: 'expect', target: { kind: 'context-key', key: 'dialogOpen' as never, value: true } },
      ]),
      harness,
    );
    expect(result.status).toBe('pass');
  });

  test('context-key fail reports actual vs expected', async () => {
    const { harness } = createFakeHarness();
    harness.setContextKey('dialogOpen' as never, true as never);
    const result = await runScenario(
      mkScenario([
        { action: 'expect', target: { kind: 'context-key', key: 'dialogOpen' as never, value: false } },
      ]),
      harness,
    );
    expect(result.status).toBe('fail');
    expect(result.stepResults[0]!.actual).toBe(true);
    expect(result.stepResults[0]!.message).toContain('dialogOpen');
  });

  test('modal-mounted / modal-dismissed pair', async () => {
    const { harness } = createFakeHarness();
    const result = await runScenario(
      mkScenario([
        { action: 'expect', target: { kind: 'modal-dismissed', id: 'z' } },
      ], { mount: [] }),
      harness,
    );
    expect(result.status).toBe('pass');

    harness.mount({ id: 'z', kind: 'button', props: { label: 'Z' } });
    const mountedCheck = await runScenario(
      mkScenario([{ action: 'expect', target: { kind: 'modal-mounted', id: 'z' } }]),
      harness,
    );
    expect(mountedCheck.status).toBe('pass');
  });

  test('modal-stack-length', async () => {
    const { harness } = createFakeHarness({ modalStack: ['a', 'b', 'c'] });
    const result = await runScenario(
      mkScenario([{ action: 'expect', target: { kind: 'modal-stack-length', length: 3 } }]),
      harness,
    );
    expect(result.status).toBe('pass');
  });

  test('render-contains pass / fail', async () => {
    const { harness } = createFakeHarness();
    harness.mount({ id: 'foo', kind: 'text', props: { text: 'hello' } });
    const pass = await runScenario(
      mkScenario([{ action: 'expect', target: { kind: 'render-contains', substring: 'foo' } }]),
      harness,
    );
    expect(pass.status).toBe('pass');

    const { harness: clean } = createFakeHarness();
    const fail = await runScenario(
      mkScenario([{ action: 'expect', target: { kind: 'render-contains', substring: 'zzz' } }]),
      clean,
    );
    expect(fail.status).toBe('fail');
  });

  test('custom fail message overrides default', async () => {
    const { harness } = createFakeHarness();
    const result = await runScenario(
      mkScenario([{
        action: 'expect',
        target: { kind: 'modal-stack-length', length: 5 },
        message: 'stack should be deep after two dialogs',
      }]),
      harness,
    );
    expect(result.status).toBe('fail');
    expect(result.stepResults[0]!.message).toBe('stack should be deep after two dialogs');
  });
});

describe('runScenario · execution flow', () => {
  test('passing scenario → status pass, all steps pass', async () => {
    const { harness } = createFakeHarness();
    const result = await runScenario(
      mkScenario([
        { action: 'key', event: { name: 'a' } as never },
        { action: 'key', event: { name: 'b' } as never },
        { action: 'key', event: { name: 'c' } as never },
      ]),
      harness,
    );
    expect(result.status).toBe('pass');
    expect(result.stepResults.every(r => r.status === 'pass')).toBe(true);
  });

  test('first failing step halts execution; remaining → skipped', async () => {
    const { harness } = createFakeHarness();
    const result = await runScenario(
      mkScenario([
        { action: 'key', event: { name: 'a' } as never },
        { action: 'expect', target: { kind: 'modal-stack-length', length: 10 } }, // fail
        { action: 'key', event: { name: 'c' } as never }, // should skip
        { action: 'key', event: { name: 'd' } as never }, // should skip
      ]),
      harness,
    );
    expect(result.status).toBe('fail');
    expect(result.stepResults[0]!.status).toBe('pass');
    expect(result.stepResults[1]!.status).toBe('fail');
    expect(result.stepResults[2]!.status).toBe('skipped');
    expect(result.stepResults[3]!.status).toBe('skipped');
  });

  test('harness throwing → step status error, scenario errors', async () => {
    const { harness } = createFakeHarness();
    harness.key = () => { throw new Error('bad key'); };
    const result = await runScenario(
      mkScenario([{ action: 'key', event: { name: 'x' } as never }]),
      harness,
    );
    expect(result.status).toBe('error');
    expect(result.stepResults[0]!.status).toBe('error');
    expect(result.stepResults[0]!.message).toContain('bad key');
  });

  test('each stepResult carries durationMs >= 0', async () => {
    const { harness } = createFakeHarness();
    const result = await runScenario(
      mkScenario([
        { action: 'key', event: { name: 'a' } as never },
        { action: 'key', event: { name: 'b' } as never },
      ]),
      harness,
    );
    for (const step of result.stepResults) {
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('empty scenario → pass', async () => {
    const { harness } = createFakeHarness();
    const result = await runScenario(mkScenario([]), harness);
    expect(result.status).toBe('pass');
    expect(result.stepResults).toHaveLength(0);
  });

  test('wait step invokes harness.waitFor', async () => {
    const { harness } = createFakeHarness();
    let waitedMs = -1;
    harness.waitFor = async (ms: number) => { waitedMs = ms; };
    const result = await runScenario(
      mkScenario([{ action: 'wait', ms: 50 }]),
      harness,
    );
    expect(result.status).toBe('pass');
    expect(waitedMs).toBe(50);
  });
});

describe('runScenario · realistic flow — dialog confirm', () => {
  test('mount → click OK → dismiss → expect stack empty', async () => {
    const { harness, state } = createFakeHarness();
    const scenario = mkScenario(
      [
        { action: 'expect', target: { kind: 'modal-mounted', id: 'confirm' } },
        { action: 'click', target: { kind: 'component', componentId: 'ok-btn' } },
        { action: 'expect', target: { kind: 'last-clicked', componentId: 'ok-btn' } },
        { action: 'dismiss', modalId: 'confirm' },
        { action: 'expect', target: { kind: 'modal-dismissed', id: 'confirm' } },
        { action: 'expect', target: { kind: 'modal-stack-length', length: 0 } },
      ],
      {
        mount: [{
          id: 'confirm',
          kind: 'dialog',
          props: {
            title: 'Confirm?',
            buttons: [{ value: 'ok', label: 'OK' }, { value: 'cancel', label: 'Cancel' }],
          },
        }],
      },
    );
    const result = await runScenario(scenario, harness);
    expect(result.status).toBe('pass');
    expect(state.modalStack).toEqual([]);
    expect(state.events.map(e => e.type)).toEqual(['mount', 'click', 'dismiss']);
  });
});
