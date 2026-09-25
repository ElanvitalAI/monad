import { describe, expect, test } from 'bun:test';

import { createPushLog } from '../src/push-log.js';
import type { CompactLevel } from '../src/views/pane-policy.js';

function mk(level: CompactLevel) {
  const chatLines: string[] = [];
  let current = level;
  const pushLog = createPushLog({
    chatLines,
    getCompactLevel: () => current,
  });
  return {
    chatLines,
    pushLog,
    setLevel(next: CompactLevel) { current = next; },
  };
}

describe('createPushLog', () => {
  test('full viewport lets every severity through', () => {
    const { pushLog, chatLines } = mk('full');
    pushLog('debug', 'd');
    pushLog('info', 'i');
    pushLog('warning', 'w');
    pushLog('error', 'e');
    expect(chatLines.length).toBe(4);
  });

  test('tablet level lets every severity through', () => {
    const { pushLog, chatLines } = mk('tablet');
    pushLog('debug', 'd');
    pushLog('info', 'i');
    pushLog('warning', 'w');
    pushLog('error', 'e');
    expect(chatLines.length).toBe(4);
  });

  test('tabletTwo drops info + debug, keeps warning + error', () => {
    const { pushLog, chatLines } = mk('tabletTwo');
    pushLog('debug', 'd');
    pushLog('info', 'i');
    pushLog('warning', 'w');
    pushLog('error', 'e');
    expect(chatLines.length).toBe(2);
    expect(chatLines.join('\n')).toContain('w');
    expect(chatLines.join('\n')).toContain('e');
  });

  test('tabletMini drops info + debug + warning, keeps error only', () => {
    const { pushLog, chatLines } = mk('tabletMini');
    pushLog('debug', 'd');
    pushLog('info', 'i');
    pushLog('warning', 'w');
    pushLog('error', 'e');
    expect(chatLines.length).toBe(1);
    expect(chatLines[0]).toContain('e');
  });

  test('force flag bypasses the drop filter', () => {
    const { pushLog, chatLines } = mk('tabletMini');
    pushLog('info', 'forced-info', { force: true });
    pushLog('debug', 'forced-debug', { force: true });
    expect(chatLines.length).toBe(2);
  });

  test('severity maps through the color helpers (line still contains body)', () => {
    const { pushLog, chatLines } = mk('full');
    pushLog('error', 'ERR');
    pushLog('info', 'INF');
    // We don't pin exact ANSI codes because chalk auto-disables
    // color when stdout isn't a TTY. Just verify the payload
    // survives the colorize pass so callers can grep the log.
    expect(chatLines[0]!.includes('ERR')).toBe(true);
    expect(chatLines[1]!.includes('INF')).toBe(true);
  });

  test('runtime level change adapts without re-wire', () => {
    const ctx = mk('full');
    ctx.pushLog('info', 'early');
    ctx.setLevel('tabletMini');
    ctx.pushLog('info', 'late');
    expect(ctx.chatLines.length).toBe(1);
    expect(ctx.chatLines[0]).toContain('early');
  });

  test('closure keeps pushing to the same chatLines array', () => {
    const { pushLog, chatLines } = mk('full');
    pushLog('info', 'one');
    pushLog('info', 'two');
    // Caller may clear via .length = 0 (e.g. /clear slash).
    chatLines.length = 0;
    pushLog('info', 'after-clear');
    expect(chatLines.length).toBe(1);
    expect(chatLines[0]).toContain('after-clear');
  });
});
