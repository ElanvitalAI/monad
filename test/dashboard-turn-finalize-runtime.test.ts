import { describe, expect, test } from 'bun:test';

import { finalizeDashboardTurn } from '../src/dashboard/turn-finalize-runtime.js';

describe('finalizeDashboardTurn', () => {
  test('commits the footer marker and drains quick-control when armed', () => {
    const lines: string[] = [];
    const events: string[] = [];
    const thinking = {
      stop: (opts: { status: string; errorText?: string }) => {
        events.push(`stop:${opts.status}:${opts.errorText ?? ''}`);
      },
    } as any;
    const footer = { current: 'done marker' };

    finalizeDashboardTurn({
      thinking,
      finalStatus: 'completed',
      chatFooterLine: footer,
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { events.push('scroll'); },
      consumeQuickControl: () => true,
      muted: (text) => `muted:${text}`,
      draw: () => { events.push('draw'); },
    });

    expect(lines).toEqual([
      '',
      'done marker',
      'muted:  (quick-control consumed — back to chat)',
    ]);
    expect(footer.current).toBeNull();
    expect(events).toEqual([
      'stop:completed:',
      'scroll',
      'scroll',
      'draw',
    ]);
  });

  test('handles missing footer and failed status', () => {
    const lines: string[] = [];
    const events: string[] = [];
    finalizeDashboardTurn({
      thinking: {
        stop: (opts: { status: string; errorText?: string }) => {
          events.push(`stop:${opts.status}:${opts.errorText}`);
        },
      } as any,
      finalStatus: 'failed',
      finalError: 'boom',
      chatFooterLine: { current: null },
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { events.push('scroll'); },
      consumeQuickControl: () => false,
      muted: (text) => text,
      draw: () => { events.push('draw'); },
    });

    expect(lines).toEqual([]);
    expect(events).toEqual(['stop:failed:boom', 'scroll', 'draw']);
  });
});
