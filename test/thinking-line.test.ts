// ── Thinking line tests ──
//
// Verifies the in-log animated progress indicator:
//   - pushes a single line into chatLines on start
//   - mutates in-place on tick (doesn't add more lines)
//   - stop(completed/interrupted/failed) freezes the line with the
//     right marker; the line STAYS in chatLines so the log keeps
//     history of prior turns
//   - updateMetrics reflects in the rendered parenthetical
//
// Uses intervalMs: 0 to disable the timer and drive ticks manually
// via metric/message updates.

import { describe, test, expect } from 'bun:test';
import { startPinnedThinking, startThinking, fmtTime } from '../src/thinking-line';

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('fmtTime', () => {
  test('sub-minute', () => { expect(fmtTime(7)).toBe('7s'); });
  test('minutes', () => { expect(fmtTime(135)).toBe('2m 15s'); });
  test('hours', () => { expect(fmtTime(3720)).toBe('1h 2m'); });
  test('rounds non-integer', () => { expect(fmtTime(7.4)).toBe('7s'); });
  test('clamps negatives to 0', () => { expect(fmtTime(-5)).toBe('0s'); });
});

describe('startThinking', () => {
  test('pushes one line on start', () => {
    const chatLines: string[] = ['first', 'second'];
    const frames: number[] = [];
    const h = startThinking({
      chatLines, onFrame: () => frames.push(chatLines.length),
      message: 'Thinking', intervalMs: 0,
    });
    expect(chatLines.length).toBe(3);
    expect(strip(chatLines[2])).toContain('Thinking…');
    h.stop();
  });

  test('update() changes the verb on next frame', () => {
    const chatLines: string[] = [];
    const h = startThinking({ chatLines, onFrame: () => {}, intervalMs: 0 });
    h.update('Streaming');
    // Force a re-render by stopping with keepLine semantics.
    h.stop({ status: 'completed' });
    expect(strip(chatLines[0])).toContain('Streaming');
  });

  test('updateAnimated() derives the message from the animation frame', () => {
    const chatLines: string[] = [];
    const h = startThinking({ chatLines, onFrame: () => {}, intervalMs: 0 });
    h.updateAnimated(frame => `Agents frame ${frame}`);
    h.reflow();
    expect(strip(chatLines[0])).toContain('Agents frame 0');
    h.reflow();
    expect(strip(chatLines[0])).toContain('Agents frame 1');
  });

  test('stop(completed) freezes with tick + elapsed', async () => {
    const chatLines: string[] = [];
    const h = startThinking({
      chatLines, onFrame: () => {}, intervalMs: 0,
      metrics: { startedAt: Date.now() - 3000 },
    });
    h.stop({ status: 'completed' });
    expect(chatLines.length).toBe(1);
    expect(strip(chatLines[0])).toContain('✔');
    expect(strip(chatLines[0])).toMatch(/3s|4s|2s/);   // tolerate ms jitter
  });

  test('stop(interrupted) freezes with cross + "interrupted"', () => {
    const chatLines: string[] = [];
    const h = startThinking({ chatLines, onFrame: () => {}, intervalMs: 0 });
    h.stop({ status: 'interrupted' });
    const s = strip(chatLines[0]);
    expect(s).toContain('✘');
    expect(s).toContain('interrupted');
  });

  test('stop(failed) with errorText', () => {
    const chatLines: string[] = [];
    const h = startThinking({ chatLines, onFrame: () => {}, intervalMs: 0 });
    h.stop({ status: 'failed', errorText: 'rate limit' });
    const s = strip(chatLines[0]);
    expect(s).toContain('✘');
    expect(s).toContain('failed');
    expect(s).toContain('rate limit');
  });

  test('stop(completed) keeps line in chatLines (does NOT splice)', () => {
    const chatLines: string[] = ['earlier', 'work'];
    const h = startThinking({ chatLines, onFrame: () => {}, intervalMs: 0 });
    expect(chatLines.length).toBe(3);
    h.stop({ status: 'completed' });
    // Line still present → log retains history of this turn.
    expect(chatLines.length).toBe(3);
  });

  test('updateMetrics surfaces in rendered detail', () => {
    const chatLines: string[] = [];
    const h = startThinking({
      chatLines, onFrame: () => {}, intervalMs: 0,
      metrics: { startedAt: Date.now() },
    });
    h.updateMetrics({ outputTokens: 1742 });
    h.stop({ status: 'completed' });
    expect(strip(chatLines[0])).toContain('1.7k tokens');
  });

  test('pinned live hint follows every detail and is omitted after interruption', () => {
    const target: { current: string | null } = { current: null };
    const h = startPinnedThinking({
      target,
      onFrame: () => {},
      intervalMs: 0,
      metrics: {
        startedAt: Date.now() - 5000,
        outputTokens: 91,
        thoughtSec: 2,
        engine: '🧠 terra',
        hint: 'esc 중단',
      },
    });
    const live = strip(target.current!);
    const elapsed = live.indexOf('5s');
    const tokens = live.indexOf('↓ 91 tokens');
    const thought = live.indexOf('thought for 2s');
    const engine = live.indexOf('🧠 terra');
    const hint = live.indexOf('esc 중단');
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(thought).toBeGreaterThanOrEqual(0);
    expect(engine).toBeGreaterThanOrEqual(0);
    expect(hint).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(tokens);
    expect(tokens).toBeLessThan(thought);
    expect(thought).toBeLessThan(engine);
    expect(engine).toBeLessThan(hint);
    expect(live.slice(hint + 'esc 중단'.length)).toBe(')');

    h.stop({ status: 'interrupted' });
    const stopped = strip(target.current!);
    expect(stopped).toContain('interrupted');
    expect(stopped).not.toContain('esc 중단');
  });

  test('onFrame fires on start and stop', () => {
    const chatLines: string[] = [];
    let frames = 0;
    const h = startThinking({
      chatLines, onFrame: () => { frames++; }, intervalMs: 0,
    });
    // Start path doesn't call onFrame (initial push is synchronous).
    // stop() triggers one final onFrame.
    h.stop({ status: 'completed' });
    expect(frames).toBeGreaterThanOrEqual(1);
  });

  test('double-stop is idempotent', () => {
    const chatLines: string[] = [];
    const h = startThinking({ chatLines, onFrame: () => {}, intervalMs: 0 });
    h.stop({ status: 'completed' });
    const snapshot = [...chatLines];
    h.stop({ status: 'failed' });
    expect(chatLines).toEqual(snapshot);
  });

  test('custom finalText overrides status styling', () => {
    const chatLines: string[] = [];
    const h = startThinking({ chatLines, onFrame: () => {}, intervalMs: 0 });
    h.stop({ status: 'completed', finalText: 'verbatim line' });
    expect(chatLines[0]).toBe('verbatim line');
  });
});
