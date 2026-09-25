import { describe, expect, test } from 'bun:test';
import {
  resolveDebugPaneMultiChrome,
  resolveDebugWindowStatus,
  resolveDebugWorkbenchStatus,
} from '../src/dashboard/modals/debug-pane-chrome.js';

describe('debug pane chrome helper', () => {
  test('uses canonical debug title prefix and minimize-close controls', () => {
    const chrome = resolveDebugPaneMultiChrome({} as never, 'debug · test');
    expect(chrome).toMatchObject({
      variant: 'rounded',
      titleAlign: 'left',
      titlePrefix: '⚙',
      bottomStatus: 'debug · test',
    });
    expect(chrome.titleControls?.map((control) => control.id)).toEqual([
      'minimize',
      'close',
    ]);
  });

  test('exposes canonical debug status strings', () => {
    expect(resolveDebugWorkbenchStatus()).toBe(
      'debug · 2x2 · events/detail/activity/prompts',
    );
    expect(resolveDebugWindowStatus(true)).toBe(
      'debug companion · live mirror · hover to inspect',
    );
    expect(resolveDebugWindowStatus(false)).toBe(
      'debug companion · file trail only · /debug on to stream',
    );
  });
});
