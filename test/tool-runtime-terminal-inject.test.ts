// ── TerminalModalInject ToolRuntime tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  terminalInjectRuntime,
  setTerminalInjectApprover,
  setTerminalInjectRegistryForTesting,
  setTerminalInjectChunkDelayForTesting,
  _getTerminalInjectApproverForTesting,
} from '../src/tool-runtime/terminal-inject-runtime';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index';
import { getToolRuntime, dispatchToolByName, _resetToolRuntimeRegistryForTest } from '../src/tool-runtime/registry';
import type { TerminalSessionRegistry } from '../src/terminal/session-registry';

// Minimal registry stub for the dispatcher. Its `get(id)` returns a
// fake session with a preview.write(bytes) sink we can observe.
function makeFakeRegistry() {
  const writes: string[] = [];
  const session = {
    id: 'sess_abc',
    title: 'fake',
    state: 'running' as const,
    preview: { write: (s: string) => { writes.push(s); } },
  };
  return {
    writes,
    registry: {
      get: (id: string) => (id === session.id ? session : undefined),
    } as unknown as TerminalSessionRegistry,
  };
}

describe('TerminalModalInject ToolRuntime', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    setTerminalInjectApprover(null);
    setTerminalInjectRegistryForTesting(null);
    setTerminalInjectChunkDelayForTesting(0);
  });

  afterEach(() => {
    _resetToolRuntimeRegistryForTest();
    setTerminalInjectApprover(null);
    setTerminalInjectRegistryForTesting(null);
    setTerminalInjectChunkDelayForTesting(null);
  });

  test('registry registers the runtime under terminal_modal_inject id', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('terminal_modal_inject')).toBe(terminalInjectRuntime);
  });

  test('setter wires approver reference', async () => {
    let called = 0;
    setTerminalInjectApprover(async () => { called++; return true; });
    expect(_getTerminalInjectApproverForTesting()).not.toBeNull();

    const { writes, registry } = makeFakeRegistry();
    setTerminalInjectRegistryForTesting(registry);
    registerAllDefaultToolRuntimes();

    const res = await dispatchToolByName(
      'TerminalModalInject',
      { id: 'sess_abc', input: 'hello' },
      { surface: 'dashboard' },
    );
    expect((res as { output: string }).output).toContain('bytes_sent=5');
    expect(writes.join('')).toBe('hello');
    expect(called).toBe(1);
  });

  test('rejected approver surfaces as tool error', async () => {
    setTerminalInjectApprover(async () => false);
    const { writes, registry } = makeFakeRegistry();
    setTerminalInjectRegistryForTesting(registry);
    registerAllDefaultToolRuntimes();
    await expect(
      dispatchToolByName(
        'TerminalModalInject',
        { id: 'sess_abc', input: 'hi' },
        { surface: 'dashboard' },
      )
    ).rejects.toThrow(/rejected by user/);
    expect(writes).toEqual([]);
  });

  test('missing approver → fail-closed error', async () => {
    setTerminalInjectApprover(null);
    const { registry } = makeFakeRegistry();
    setTerminalInjectRegistryForTesting(registry);
    registerAllDefaultToolRuntimes();
    await expect(
      dispatchToolByName(
        'TerminalModalInject',
        { id: 'sess_abc', input: 'hi' },
        { surface: 'dashboard' },
      )
    ).rejects.toThrow(/no approver is wired/);
  });

  test('alias resolution works (PascalCase → snake_case id)', () => {
    registerAllDefaultToolRuntimes();
    const a = getToolRuntime('TerminalModalInject');
    const b = getToolRuntime('terminal_modal_inject');
    expect(a).toBe(b);
    expect(a).toBe(terminalInjectRuntime);
  });
});
