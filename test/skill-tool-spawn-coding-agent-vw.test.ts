import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildSpawnCodingAgentInVWTool,
  dispatchSpawnCodingAgentInVW,
  initSpawnCodingAgentInVW,
  _resetSpawnCodingAgentInVWForTesting,
} from '../src/skills/tools/spawn-coding-agent-vw.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../src/preview/terminal.js';
import { CodingAgentBinaryMissing } from '../src/terminal/coding-agent.js';

function fakePreview(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  const writes: string[] = [];
  return {
    _writes: writes,
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: (b: string) => writes.push(b),
    resize: () => {},
    render: () => 'fake-shell',
    cursorPosition: () => alive ? ({ row: 0, col: 0 }) : null,
    get isAlive(): boolean { return alive; },
    cols: opts.cols,
    rows: opts.rows,
    pid: 1,
    isScrolledBack: false,
  } as unknown as PreviewTerminal;
}

afterEach(() => {
  _resetSpawnCodingAgentInVWForTesting();
});

function mkRegistry() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const registry = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    paneDeps: {
      terminalFactory: (opts) => fakePreview(opts),
    },
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  return registry;
}

describe('buildSpawnCodingAgentInVWTool', () => {
  test('schema has brand enum + optional cwd/args/title', () => {
    const t = buildSpawnCodingAgentInVWTool();
    expect(t.name).toBe('SpawnCodingAgentInVW');
    const p = t.parameters as {
      required?: string[];
      properties: { brand: { enum?: string[] } };
    };
    expect(p.required).toEqual(['brand']);
    expect(p.properties.brand.enum).toEqual(['claude-code', 'codex']);
  });
});

describe('dispatchSpawnCodingAgentInVW', () => {
  test('throws when not wired', async () => {
    await expect(dispatchSpawnCodingAgentInVW({ brand: 'claude-code' }))
      .rejects.toThrow(/not wired/);
  });

  test('rejects unknown brand', async () => {
    const reg = mkRegistry();
    await expect(dispatchSpawnCodingAgentInVW(
      { brand: 'nvim' },
      { registry: reg, whichBinary: () => '/usr/bin/claude', wrapCommand: (c) => c },
    )).rejects.toThrow(/must be 'claude-code' or 'codex'/);
  });

  test('happy path for claude-code', async () => {
    const reg = mkRegistry();
    const r = await dispatchSpawnCodingAgentInVW(
      { brand: 'claude-code' },
      { registry: reg, whichBinary: () => '/usr/bin/claude', wrapCommand: (c) => c },
    );
    expect(r.brand).toBe('claude-code');
    expect(r.windowId).toBeGreaterThan(0);
    expect(r.paneId).toBeTruthy();
    expect(r.output).toContain('window_id=');
    expect(r.output).toContain('@pane:');
    // Spawned window exists on the registry.
    expect(reg.get(r.windowId)).not.toBeNull();
  });

  test('happy path for codex', async () => {
    const reg = mkRegistry();
    const r = await dispatchSpawnCodingAgentInVW(
      { brand: 'codex', extra_args: ['--model', 'foo'] },
      { registry: reg, whichBinary: () => '/usr/bin/codex' },
    );
    expect(r.brand).toBe('codex');
    expect(r.output).toContain('codex');
  });

  test('missing binary throws CodingAgentBinaryMissing', async () => {
    const reg = mkRegistry();
    await expect(dispatchSpawnCodingAgentInVW(
      { brand: 'claude-code' },
      { registry: reg, whichBinary: () => null },
    )).rejects.toThrow(CodingAgentBinaryMissing);
  });

  test('custom title honored', async () => {
    const reg = mkRegistry();
    const r = await dispatchSpawnCodingAgentInVW(
      { brand: 'claude-code', title: 'custom title here' },
      { registry: reg, whichBinary: () => '/usr/bin/claude', wrapCommand: (c) => c },
    );
    expect(r.output).toContain('custom title here');
  });

  test('default title uses cwd basename', async () => {
    const reg = mkRegistry();
    const r = await dispatchSpawnCodingAgentInVW(
      { brand: 'codex', cwd: '/home/alice/myproj' },
      { registry: reg, whichBinary: () => '/usr/bin/codex' },
    );
    expect(r.output).toContain('[myproj]');
  });

  test('initSpawnCodingAgentInVW wires the default registry', async () => {
    const reg = mkRegistry();
    initSpawnCodingAgentInVW(reg);
    const r = await dispatchSpawnCodingAgentInVW(
      { brand: 'claude-code' },
      { whichBinary: () => '/usr/bin/claude', wrapCommand: (c) => c },
    );
    expect(reg.get(r.windowId)).not.toBeNull();
  });

  test('extra_args are appended to the cmd string', async () => {
    const reg = mkRegistry();
    const r = await dispatchSpawnCodingAgentInVW(
      { brand: 'claude-code', extra_args: ['--verbose'] },
      { registry: reg, whichBinary: () => '/usr/bin/claude', wrapCommand: (c) => c },
    );
    expect(r.output).toContain('claude --verbose');
  });

  test('brand=claude-code routes through wrapCommand (output still shows raw cmd)', async () => {
    const reg = mkRegistry();
    const wrapped: { value: string | null } = { value: null };
    const r = await dispatchSpawnCodingAgentInVW(
      { brand: 'claude-code' },
      {
        registry: reg,
        whichBinary: () => '/usr/bin/claude',
        wrapCommand: (c) => { wrapped.value = `SH:${c}`; return wrapped.value; },
      },
    );
    expect(wrapped.value).toBe('SH:claude');
    // Output message keeps raw cmd readable for the LLM.
    expect(r.output).toContain('cmd="claude"');
  });

  test('brand=codex skips wrapCommand', async () => {
    const reg = mkRegistry();
    let called = false;
    await dispatchSpawnCodingAgentInVW(
      { brand: 'codex' },
      {
        registry: reg,
        whichBinary: () => '/usr/bin/codex',
        wrapCommand: (c) => { called = true; return c; },
      },
    );
    expect(called).toBe(false);
  });
});
