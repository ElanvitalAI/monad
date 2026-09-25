import { describe, expect, test } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';

import {
  buildDashboardAssistantMediaPreviewPayload,
  runDashboardAssistantMediaPreviewOpen,
} from '../src/dashboard/assistant-media-preview-runtime.js';

describe('buildDashboardAssistantMediaPreviewPayload', () => {
  test('extracts picture preview from last assistant raw output', () => {
    expect(buildDashboardAssistantMediaPreviewPayload({
      lastAssistantRaw: '![architecture](https://example.com/arch.png)',
      lastAssistantRange: { start: 0, end: 1 },
      lastAssistantMode: 'rendered',
    })).toEqual({
      preview: {
        kind: 'picture',
        label: 'architecture',
        url: 'https://example.com/arch.png',
      },
      sourceText: '![architecture](https://example.com/arch.png)',
    });
  });

  test('extracts video preview from last assistant raw output', () => {
    expect(buildDashboardAssistantMediaPreviewPayload({
      lastAssistantRaw: 'https://example.com/demo.mp4',
      lastAssistantRange: { start: 0, end: 1 },
      lastAssistantMode: 'rendered',
    })).toEqual({
      preview: {
        kind: 'video',
        label: 'https://example.com/demo.mp4',
        url: 'https://example.com/demo.mp4',
      },
      sourceText: 'https://example.com/demo.mp4',
    });
  });

  test('returns null when last assistant output has no media payload', () => {
    expect(buildDashboardAssistantMediaPreviewPayload({
      lastAssistantRaw: 'plain answer',
      lastAssistantRange: { start: 0, end: 1 },
      lastAssistantMode: 'rendered',
    })).toBeNull();
  });
});

describe('runDashboardAssistantMediaPreviewOpen', () => {
  test('opens picture preview targets and reports success', async () => {
    const chatLines: string[] = [];
    const opened: string[] = [];
    await runDashboardAssistantMediaPreviewOpen({
      chatLines,
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      state: {
        lastAssistantRaw: '![architecture](https://example.com/arch.png)',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      },
      openTarget: async (url) => { opened.push(url); },
    });
    expect(opened).toEqual(['https://example.com/arch.png']);
    expect(chatLines).toEqual([
      'muted:(opened picture preview: architecture)',
      'scroll',
      'draw',
    ]);
  });

  test('prefers preview surface over external open target when available', async () => {
    const chatLines: string[] = [];
    const surfaced: string[] = [];
    const opened: string[] = [];
    await runDashboardAssistantMediaPreviewOpen({
      chatLines,
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      state: {
        lastAssistantRaw: '![architecture](https://example.com/arch.png)',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      },
      openPreviewSurface: async (preview) => {
        surfaced.push(preview.url);
        return true;
      },
      openTarget: async (url) => { opened.push(url); },
    });
    expect(surfaced).toEqual(['https://example.com/arch.png']);
    expect(opened).toEqual([]);
    expect(chatLines).toEqual([
      'muted:(previewed picture: architecture)',
      'scroll',
      'draw',
    ]);
  });

  test('warns when no preview target exists', async () => {
    const chatLines: string[] = [];
    await runDashboardAssistantMediaPreviewOpen({
      chatLines,
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      state: {
        lastAssistantRaw: 'plain answer',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      },
      openTarget: async () => {},
    });
    expect(chatLines).toEqual([
      'warn:(no media preview in last assistant output)',
      'scroll',
      'draw',
    ]);
  });

  test('skips opening when a matching output-sink-stop signal exists', async () => {
    const chatLines: string[] = [];
    const opened: string[] = [];
    const bus = createControlSignalBus(() => new Date().toISOString());
    bus.emit({
      kind: 'output-sink-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
      payload: { sinkKind: 'picture' },
    });
    await runDashboardAssistantMediaPreviewOpen({
      chatLines,
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      state: {
        lastAssistantRaw: '![architecture](https://example.com/arch.png)',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      },
      openTarget: async (url) => { opened.push(url); },
      controlSignalBus: bus,
      controlSignalScope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
    });
    expect(opened).toEqual([]);
    expect(chatLines).toEqual([
      'warn:(picture preview stopped by control signal)',
      'scroll',
      'draw',
    ]);
  });
});
