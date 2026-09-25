import { describe, expect, mock, test } from 'bun:test';

import { createDashboardClipboardActions } from '../src/dashboard/clipboard-actions.js';

describe('dashboard clipboard actions', () => {
  test('copyLogBlock copies a block, sets HUD, and logs file fallback paths', async () => {
    const setCopied = mock((_text: string) => {});
    const clearCopied = mock(() => {});
    const draw = mock(() => {});
    const pushDebugLine = mock((_line: string) => {});
    const actions = createDashboardClipboardActions({
      getChatLines: () => ['a', 'b', 'c'],
      findBlock: () => ({ start: 1, end: 3 }),
      pushDebugLine,
      pushChatLine: mock((_line: string) => {}),
      clearChatScroll: mock(() => {}),
      hud: { setCopied, clearCopied },
      draw,
      scheduleTimeout: (cb) => { cb(); },
      writeClipboardDetailed: mock(async (_text: string) => ({
        ok: true,
        via: 'file',
        path: '/tmp/x.txt',
      })),
      writeClipboard: mock(async (_text: string) => true),
    });

    await actions.copyLogBlock(1, 'block');

    expect(setCopied).toHaveBeenCalled();
    expect(pushDebugLine).toHaveBeenCalledWith(expect.stringContaining('/tmp/x.txt'));
    expect(clearCopied).toHaveBeenCalled();
    expect(draw).toHaveBeenCalled();
  });

  test('copyLogBlock warns when no block is found', async () => {
    const pushChatLine = mock((_line: string) => {});
    const clearChatScroll = mock(() => {});
    const actions = createDashboardClipboardActions({
      getChatLines: () => ['a'],
      findBlock: () => null,
      pushDebugLine: mock((_line: string) => {}),
      pushChatLine,
      clearChatScroll,
      hud: { setCopied: mock((_text: string) => {}), clearCopied: mock(() => {}) },
      draw: mock(() => {}),
      writeClipboardDetailed: mock(async (_text: string) => ({ ok: true, via: 'local' })),
      writeClipboard: mock(async (_text: string) => true),
    });

    await actions.copyLogBlock(0, 'block');

    expect(pushChatLine).toHaveBeenCalled();
    expect(clearChatScroll).toHaveBeenCalled();
  });

  test('copyRootPathToLog reports success and failure paths', async () => {
    const pushDebugLine = mock((_line: string) => {});
    const setCopied = mock((_text: string) => {});
    const clearCopied = mock(() => {});
    const draw = mock(() => {});
    const actions = createDashboardClipboardActions({
      getChatLines: () => [],
      findBlock: () => null,
      pushDebugLine,
      pushChatLine: mock((_line: string) => {}),
      clearChatScroll: mock(() => {}),
      hud: { setCopied, clearCopied },
      draw,
      scheduleTimeout: (cb) => { cb(); },
      writeClipboardDetailed: mock(async (_text: string) => ({ ok: true, via: 'local' })),
      writeClipboard: mock(async (text: string) => text === '/ok'),
    });

    await actions.copyRootPathToLog('/ok', 'file');
    await actions.copyRootPathToLog('/bad', 'file');
    await actions.copyRootPathToLog(null, 'file');

    expect(setCopied).toHaveBeenCalled();
    expect(pushDebugLine).toHaveBeenCalledWith(expect.stringContaining('copied'));
    expect(pushDebugLine).toHaveBeenCalledWith(expect.stringContaining('clipboard write failed'));
    expect(pushDebugLine).toHaveBeenCalledWith(expect.stringContaining('no file to copy'));
  });
});
