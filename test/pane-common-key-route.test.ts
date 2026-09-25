import { describe, expect, test } from 'bun:test';

import { routePaneCommonKey } from '../src/dashboard/input/pane-common-key-route.js';
import type { Key } from '../src/tui.js';
import { debug } from '../src/debug/log.js';

function key(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

describe('routePaneCommonKey', () => {
  test('routes input entry keys through enterInput', async () => {
    const calls: string[] = [];

    await routePaneCommonKey(key('i'), {
      pane: 'browser',
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });
    // Ctrl+L 은 입력 진입 폐기(2026-07-12 · force-redraw 재정의) — passthrough.
    const ctrlL = await routePaneCommonKey(key('l', { ctrl: true }), {
      pane: 'browser',
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });
    expect(ctrlL).toEqual({ type: 'passthrough' });
    await routePaneCommonKey(key('/'), {
      pane: 'browser',
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });

    expect(calls).toEqual([
      'enter:default:pane-i-key',
      'enter:slash:pane-slash-open-input',
    ]);
  });

  test('lets agent roster search override slash input', async () => {
    const calls: string[] = [];

    const result = await routePaneCommonKey(key('/'), {
      pane: 'agent-roster',
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      openAgentRosterSearch: () => {
        calls.push('agent-search');
        return true;
      },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });

    expect(result).toEqual({ type: 'handled' });
    expect(calls).toEqual(['agent-search']);
  });

  test('records idle pane dispatcher consumption before entering input', async () => {
    const calls: string[] = [];

    const handled = await routePaneCommonKey(key('escape'), {
      pane: 'browser',
      tryConsumeEscape: () => {
        calls.push('consume-escape');
        return true;
      },
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });

    expect(handled).toEqual({ type: 'handled' });
    expect(calls).toEqual(['consume-escape']);
    // ⛔ 전역 버퍼를 **개수로 자르면** 링 버퍼 축출·병렬 기록에 흔들린다(무인 리뷰 should-fix).
    //    ⇒ **꼬리를 맞춘다** — 이 테스트가 방금 낸 것이 마지막에 있다는 것만 본다.
    const events = debug.events(10_000)
      .filter((event) => event.category === 'esc.abort')
      .slice(-1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: 'esc.abort',
      event: 'idle-pane-dispatch-consumed',
      data: {},
    });
  });

  test('routes pane focus toggles and quit paths', async () => {
    const calls: string[] = [];

    await routePaneCommonKey(key('tab', { shift: true }), {
      pane: 'browser',
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });
    await routePaneCommonKey(key('`'), {
      pane: 'browser',
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });
    const quit = await routePaneCommonKey(key('q'), {
      pane: 'browser',
      enterInput: ({ mode, reason }) => { calls.push(`enter:${mode ?? 'default'}:${reason}`); },
      cyclePaneFocus: (delta) => { calls.push(`cycle:${delta}`); },
      toggleLogFocus: () => { calls.push('log'); },
      hardExit: () => { calls.push('hard-exit'); },
      quit: () => { calls.push('quit'); },
    });

    expect(quit).toEqual({ type: 'quit' });
    expect(calls).toEqual(['cycle:-1', 'log', 'quit']);
  });
});
