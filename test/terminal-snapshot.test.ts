import { describe, expect, test } from 'bun:test';

import {
  capturePreviewTerminalFrame,
  captureExecutionFrame,
} from '../src/display/terminal-snapshot.js';
import type { PreviewTerminal } from '../src/preview/terminal.js';
import type { ExecutionSurfaceHandle } from '../src/display/execution-surface.js';

// Minimal stubs — we only need render() to work.

function fakePreviewTerminal(lines: string[]): PreviewTerminal {
  return {
    render: (_focused?: boolean) => lines.join('\n'),
    // Rest of API unused by snapshot code.
  } as unknown as PreviewTerminal;
}

function fakeExecutionHandle(lines: string[]): ExecutionSurfaceHandle {
  return {
    id: 'exec:fake',
    terminal: {
      render: (_focused?: boolean) => lines.join('\n'),
      start: () => {},
      stop: () => {},
      resize: () => {},
      write: () => {},
      isAlive: true,
    },
  } as unknown as ExecutionSurfaceHandle;
}

describe('capturePreviewTerminalFrame', () => {
  test('preserves rendered lines', () => {
    const pt = fakePreviewTerminal(['row1', 'row2', 'row3']);
    const frame = capturePreviewTerminalFrame(pt, { title: 'snap' });
    expect(frame.lines).toEqual(['row1', 'row2', 'row3']);
    expect(frame.title).toBe('snap');
    expect(frame.preformatted).toBe(true);
    expect(frame.source).toBe('snapshot');
  });

  test('single line is still a 1-element array', () => {
    const frame = capturePreviewTerminalFrame(fakePreviewTerminal(['solo']));
    expect(frame.lines).toEqual(['solo']);
  });

  test('does not touch PTY state — render called with false focused', () => {
    const calls: boolean[] = [];
    const pt = {
      render: (focused?: boolean) => { calls.push(focused ?? true); return 'x'; },
    } as unknown as PreviewTerminal;
    capturePreviewTerminalFrame(pt);
    expect(calls).toEqual([false]);
  });
});

describe('captureExecutionFrame', () => {
  test('uses handle.terminal.render output', () => {
    const handle = fakeExecutionHandle(['out1', 'out2']);
    const frame = captureExecutionFrame(handle, { title: 'exec-snap', preferredCols: 80 });
    expect(frame.lines).toEqual(['out1', 'out2']);
    expect(frame.title).toBe('exec-snap');
    expect(frame.preferredCols).toBe(80);
    expect(frame.source).toBe('snapshot');
  });

  test('ANSI is preserved byte-for-byte (no re-wrap)', () => {
    const handle = fakeExecutionHandle(['\x1b[31mred\x1b[0m', '\x1b[1mbold\x1b[0m']);
    const frame = captureExecutionFrame(handle);
    expect(frame.lines[0]).toBe('\x1b[31mred\x1b[0m');
    expect(frame.lines[1]).toBe('\x1b[1mbold\x1b[0m');
  });
});
