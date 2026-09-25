// ── Capture Phase 0 — asciicast recorder tests ──

import { describe, expect, test } from 'bun:test';

import {
  RecorderStateError,
  createRecorder,
  decodeAsciicast,
} from '../../src/capture/index.js';

function makeClock(initial: number): { now: () => number; advance: (ms: number) => void } {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

describe('recorder state machine', () => {
  test('idle → start → recording → stop → stopped', () => {
    const c = makeClock(1000);
    const r = createRecorder({ dims: { cols: 80, rows: 24 }, now: c.now });
    expect(r.status).toBe('idle');
    r.start();
    expect(r.status).toBe('recording');
    r.stop();
    expect(r.status).toBe('stopped');
  });

  test('pause → resume preserves recording state', () => {
    const c = makeClock(0);
    const r = createRecorder({ dims: { cols: 80, rows: 24 }, now: c.now });
    r.start();
    c.advance(100);
    r.pause();
    expect(r.status).toBe('paused');
    c.advance(200);
    r.resume();
    expect(r.status).toBe('recording');
    c.advance(100);
    r.stop();
    expect(r.elapsedSec).toBeCloseTo(0.2, 3);
  });

  test('start when already recording throws RecorderStateError', () => {
    const r = createRecorder({ dims: { cols: 1, rows: 1 } });
    r.start();
    expect(() => r.start()).toThrow(RecorderStateError);
  });

  test('pause when idle throws RecorderStateError', () => {
    const r = createRecorder({ dims: { cols: 1, rows: 1 } });
    expect(() => r.pause()).toThrow(RecorderStateError);
  });

  test('resume when recording throws RecorderStateError', () => {
    const r = createRecorder({ dims: { cols: 1, rows: 1 } });
    r.start();
    expect(() => r.resume()).toThrow(RecorderStateError);
  });

  test('stop is idempotent from any state', () => {
    const r = createRecorder({ dims: { cols: 1, rows: 1 } });
    r.stop();
    expect(r.status).toBe('stopped');
    expect(() => r.stop()).not.toThrow();
  });
});

describe('recorder write semantics', () => {
  test('write while recording records a frame with correct offset', () => {
    const c = makeClock(1000);
    const r = createRecorder({ dims: { cols: 80, rows: 24 }, now: c.now });
    r.start();
    c.advance(500);
    r.write('hello');
    expect(r.frameCount).toBe(1);
    r.stop();
    const { frames } = decodeAsciicast(r.serialize());
    expect(frames[0]!.time).toBeCloseTo(0.5, 3);
    expect(frames[0]!.data).toBe('hello');
  });

  test('write while paused is dropped', () => {
    const c = makeClock(0);
    const r = createRecorder({ dims: { cols: 1, rows: 1 }, now: c.now });
    r.start();
    r.pause();
    r.write('dropped');
    expect(r.frameCount).toBe(0);
  });

  test('write while stopped is dropped', () => {
    const r = createRecorder({ dims: { cols: 1, rows: 1 } });
    r.start();
    r.stop();
    r.write('late');
    expect(r.frameCount).toBe(0);
  });

  test('input stream writes keep their stream tag', () => {
    const r = createRecorder({ dims: { cols: 1, rows: 1 } });
    r.start();
    r.write('typed', 'i');
    r.stop();
    const { frames } = decodeAsciicast(r.serialize());
    expect(frames[0]!.stream).toBe('i');
  });
});

describe('recorder pause removes time from elapsed', () => {
  test('paused span does not contribute to frame offsets', () => {
    const c = makeClock(0);
    const r = createRecorder({ dims: { cols: 80, rows: 24 }, now: c.now });
    r.start();
    c.advance(100);
    r.write('before-pause');
    r.pause();
    c.advance(5000);  // 5s of paused time
    r.resume();
    c.advance(100);
    r.write('after-resume');
    r.stop();
    const { frames } = decodeAsciicast(r.serialize());
    expect(frames).toHaveLength(2);
    expect(frames[0]!.time).toBeCloseTo(0.1, 3);
    expect(frames[1]!.time).toBeCloseTo(0.2, 3);  // paused 5s excluded
  });
});

describe('recorder serialize', () => {
  test('empty recording produces header-only cast', () => {
    const r = createRecorder({
      dims: { cols: 80, rows: 24 },
      startedAtSec: 1700,
    });
    const { header, frames } = decodeAsciicast(r.serialize());
    expect(header.width).toBe(80);
    expect(header.timestamp).toBe(1700);
    expect(frames).toEqual([]);
  });

  test('serialize while recording returns a valid prefix', () => {
    const c = makeClock(0);
    const r = createRecorder({ dims: { cols: 1, rows: 1 }, now: c.now });
    r.start();
    c.advance(50);
    r.write('partial');
    // Don't stop.
    const { frames } = decodeAsciicast(r.serialize());
    expect(frames).toHaveLength(1);
  });

  test('title + env embedded in serialized header', () => {
    const r = createRecorder({
      dims: { cols: 1, rows: 1 },
      title: 'labeled',
      env: { SHELL: '/bin/zsh' },
    });
    const { header } = decodeAsciicast(r.serialize());
    expect(header.title).toBe('labeled');
    expect(header.env).toEqual({ SHELL: '/bin/zsh' });
  });
});
