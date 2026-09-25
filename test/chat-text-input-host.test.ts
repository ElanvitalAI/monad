import { describe, expect, test } from 'bun:test';

import { resolveTextInputHost, type TextInputHost } from '../src/chat/index.js';

describe('resolveTextInputHost', () => {
  test('falls back to legacy flat callbacks when host is absent', async () => {
    const repaint = () => {};
    const onLinesChange = () => {};
    const calls: string[] = [];
    const onLogResize = (delta: number, reset?: boolean) => { calls.push(`resize:${delta}:${reset ? 'reset' : 'keep'}`); };
    const onGotoLog = () => { calls.push('goto'); };
    const onCopyLastBlock = () => { calls.push('copy-last'); };
    const onSpawnTerminalModal = () => { calls.push('spawn-terminal'); };
    const onCopyLogPane = () => { calls.push('copy-log'); };

    const resolved = resolveTextInputHost({
      controlOut: { repaint },
      onLinesChange,
      onLogResize,
      onGotoLog,
      onCopyLastBlock,
      onSpawnTerminalModal,
      onCopyLogPane,
    });

    expect(resolved.control?.repaint).toBe(repaint);
    expect(resolved.onLinesChange).toBe(onLinesChange);
    await resolved.dispatchGlobalAction?.({ kind: 'resize-log', delta: 2 });
    await resolved.dispatchGlobalAction?.({ kind: 'goto-log' });
    await resolved.dispatchGlobalAction?.({ kind: 'copy-last-block' });
    await resolved.dispatchGlobalAction?.({ kind: 'spawn-terminal-modal' });
    await resolved.dispatchGlobalAction?.({ kind: 'copy-log-pane' });
    expect(calls).toEqual([
      'resize:2:keep',
      'goto',
      'copy-last',
      'spawn-terminal',
      'copy-log',
    ]);
  });

  test('host dispatchGlobalAction overrides legacy flat callbacks when both are present', async () => {
    const legacyRepaint = () => {};
    const hostRepaint = () => {};
    const calls: string[] = [];
    const host: TextInputHost = {
      control: { repaint: hostRepaint },
      dispatchGlobalAction: (action) => { calls.push(action.kind); },
    };

    const resolved = resolveTextInputHost({
      controlOut: { repaint: legacyRepaint },
      onGotoLog: () => { calls.push('legacy-goto'); },
      onCopyLogPane: () => { calls.push('legacy-copy'); },
      host,
    });

    expect(resolved.control?.repaint).toBe(hostRepaint);
    await resolved.dispatchGlobalAction?.({ kind: 'goto-log' });
    await resolved.dispatchGlobalAction?.({ kind: 'copy-log-pane' });
    expect(calls).toEqual(['goto-log', 'copy-log-pane']);
  });

  test('host can be partial and falls back per field', async () => {
    const legacyRepaint = () => {};
    const calls: string[] = [];
    const legacyResize = () => { calls.push('legacy-resize'); };
    const hostGoto = () => { calls.push('host-goto'); };

    const resolved = resolveTextInputHost({
      controlOut: { repaint: legacyRepaint },
      onLogResize: legacyResize,
      host: { onGotoLog: hostGoto },
    });

    expect(resolved.control?.repaint).toBe(legacyRepaint);
    await resolved.dispatchGlobalAction?.({ kind: 'resize-log', delta: 1 });
    await resolved.dispatchGlobalAction?.({ kind: 'goto-log' });
    expect(calls).toEqual(['legacy-resize', 'host-goto']);
  });
});
