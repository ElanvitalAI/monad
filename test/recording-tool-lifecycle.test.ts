// Phase C · PTY recording tool lifecycle — Start/Stop round-trip via
// the new RecordPtyOutput / StopPtyRecording tools. The dispatch
// helpers compose without IO so we use real wiring (no mock.module).

import { beforeEach, describe, expect, test } from 'bun:test';
import { createRecordingStore } from '../src/capture/recording-store.js';
import {
  dispatchRecordPtyOutput,
  dispatchStopPtyRecording,
} from '../src/tool-runtime/pty-recording-runtimes.js';

describe('RecordPtyOutput / StopPtyRecording dispatch lifecycle', () => {
  let store: ReturnType<typeof createRecordingStore>;

  beforeEach(() => {
    store = createRecordingStore();
  });

  test('start → write → stop returns asciicast for default encoder', () => {
    const start = dispatchRecordPtyOutput(
      { source: { windowId: 'w1', paneId: 'p1', surfaceLabel: 'vw:1/build' } },
      store,
    );
    expect(start.recordingId).toMatch(/^rec-/);
    expect(start.encoder).toBe('asciicast');
    expect(start.source.windowId).toBe('w1');

    const entry = store.get(start.recordingId)!;
    entry.handle.write('hello\n', 'o');
    entry.handle.write('world\n', 'o');

    const stop = dispatchStopPtyRecording({ recordingId: start.recordingId }, store);
    expect(stop.status).toBe('stopped');
    expect(stop.encoder).toBe('asciicast');
    expect(stop.frameCount).toBe(2);
    expect(stop.asciicast).toBeDefined();
    expect(stop.asciicast!).toContain('hello');
    expect(stop.asciicast!).toContain('world');
  });

  test('stop with unknown recordingId — returns not-found gracefully', () => {
    const stop = dispatchStopPtyRecording({ recordingId: 'rec-bogus' }, store);
    expect(stop.status).toBe('not-found');
    expect(stop.frameCount).toBe(0);
    expect(stop.asciicast).toBeUndefined();
  });

  test('stop twice — second call is idempotent (already-stopped)', () => {
    const start = dispatchRecordPtyOutput({ encoder: 'asciicast' }, store);
    const first = dispatchStopPtyRecording({ recordingId: start.recordingId }, store);
    expect(first.status).toBe('stopped');

    const second = dispatchStopPtyRecording({ recordingId: start.recordingId }, store);
    expect(second.status).toBe('already-stopped');
    expect(second.asciicast).toBeDefined();
  });

  test('encoder=gif — asciicast omitted, host instructed to encode', () => {
    const start = dispatchRecordPtyOutput({ encoder: 'gif' }, store);
    expect(start.encoder).toBe('gif');

    const stop = dispatchStopPtyRecording({ recordingId: start.recordingId }, store);
    expect(stop.encoder).toBe('gif');
    expect(stop.asciicast).toBeUndefined();
    expect(stop.note).toContain('Host must run encoder');
  });

  test('multiple parallel recordings — each gets a distinct id', () => {
    const a = dispatchRecordPtyOutput({ source: { paneId: 'a' } }, store);
    const b = dispatchRecordPtyOutput({ source: { paneId: 'b' } }, store);
    expect(a.recordingId).not.toBe(b.recordingId);
    expect(store.list().length).toBe(2);
  });

  test('store.forget evicts stopped recordings idempotently', () => {
    const start = dispatchRecordPtyOutput({}, store);
    dispatchStopPtyRecording({ recordingId: start.recordingId }, store);
    expect(store.size()).toBe(1);

    expect(store.forget(start.recordingId)).toBe(true);
    expect(store.size()).toBe(0);
    expect(store.forget(start.recordingId)).toBe(false);
  });
});
