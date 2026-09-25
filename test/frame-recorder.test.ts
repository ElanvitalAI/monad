// ⭐P4 §4-2 — frame → asciicast recorder + bus adapter. Turns a stream of
// SelfReportFrames (full-screen snapshots) into an asciicast v2 recording,
// reusing the existing Recorder verbatim.

import { describe, it, expect } from 'bun:test';

import { createFrameRecorder, recordSurfaceFromBus } from '../src/capture/frame-recorder.js';
import { publishSelfReportFrame, type SelfReportFrame } from '../src/capture/self-report-frame.js';
import { ChannelBus } from '../src/terminal-matrix/channel-bus.js';

function frame(over: Partial<SelfReportFrame> = {}): SelfReportFrame {
  return {
    surfaceId: 'tui:1', instance: 'test:x', kind: 'tui', mode: 'self-report',
    text: 'SCREEN', cols: 20, rows: 4, at: 1000,
    ...over,
  };
}

/** Parse an asciicast v2 string → { header, events:[time,code,data][] }. */
function parseCast(cast: string): { header: { version: number; width: number; height: number }; events: Array<[number, string, string]> } {
  const lines = cast.split('\n').filter(Boolean);
  const header = JSON.parse(lines[0]!) as { version: number; width: number; height: number };
  const events = lines.slice(1).map((l) => JSON.parse(l) as [number, string, string]);
  return { header, events };
}

describe('createFrameRecorder', () => {
  it('records fed frames as ordered asciicast events (header dims · repaint · timestamps)', () => {
    let t = 1000;
    const rec = createFrameRecorder({ title: 'tui:1', now: () => (t += 1000) });
    rec.feed(frame({ text: 'SCREEN-A', cols: 20, rows: 4 }));
    rec.feed(frame({ text: 'SCREEN-B' }));
    expect(rec.frameCount).toBe(2);
    const { header, events } = parseCast(rec.stop());
    expect(header.version).toBe(2);
    expect(header.width).toBe(20);   // dims from first frame
    expect(header.height).toBe(4);
    // Exactly 2 output events, in order, each an ['o'] frame.
    expect(events).toHaveLength(2);
    expect(events.every((e) => e[1] === 'o')).toBe(true);
    expect(events[0]![2]).toContain('SCREEN-A');
    expect(events[1]![2]).toContain('SCREEN-B');
    // Order: A strictly before B; timestamps monotonic non-decreasing.
    expect(events[0]![2].indexOf('SCREEN-A')).toBeGreaterThanOrEqual(0);
    expect(events[1]![0]).toBeGreaterThanOrEqual(events[0]![0]);
    // Each frame repaints: reset SGR + clear + home prelude.
    for (const e of events) {
      expect(e[2].startsWith('\x1b[0m\x1b[2J\x1b[H')).toBe(true);
    }
  });

  it('repaint resets SGR so a prior frame\'s open color cannot bleed', () => {
    const rec = createFrameRecorder({ now: (() => { let t = 0; return () => (t += 100); })() });
    rec.feed(frame({ text: '\x1b[31mRED-NO-RESET' }));  // leaves red pen open
    rec.feed(frame({ text: 'PLAIN' }));
    const { events } = parseCast(rec.stop());
    // 2nd frame begins with ESC[0m (reset) before its content — no red bleed.
    expect(events[1]![2].startsWith('\x1b[0m')).toBe(true);
  });

  it('never fed → stop() returns empty string (no header)', () => {
    expect(createFrameRecorder().stop()).toBe('');
  });

  it('feed after stop is a no-op (status → stopped)', () => {
    const rec = createFrameRecorder();
    rec.feed(frame({ text: 'ONE' }));
    const first = rec.stop();
    rec.feed(frame({ text: 'TWO' }));      // dropped
    expect(rec.status).toBe('stopped');
    expect(rec.frameCount).toBe(1);
    expect(rec.stop()).toBe(first);        // idempotent
  });

  it('status transitions idle → recording → stopped', () => {
    const rec = createFrameRecorder();
    expect(rec.status).toBe('idle');
    rec.feed(frame());
    expect(rec.status).toBe('recording');
    rec.stop();
    expect(rec.status).toBe('stopped');
  });
});

describe('recordSurfaceFromBus (PLAN §4-2 bus adapter · combined lifecycle)', () => {
  it('captures a surface\'s published frames; stop() unsubscribes (no later capture)', () => {
    const bus = new ChannelBus();
    const session = recordSurfaceFromBus(bus, 'tui:1', { now: (() => { let t = 0; return () => (t += 500); })() });
    publishSelfReportFrame(bus, frame({ surfaceId: 'tui:1', text: 'BUS-A' }));
    publishSelfReportFrame(bus, frame({ surfaceId: 'tui:1', text: 'BUS-B' }));
    const cast = session.stop();   // stops recorder AND unsubscribes (one lifecycle)
    publishSelfReportFrame(bus, frame({ surfaceId: 'tui:1', text: 'BUS-C' })); // after stop — ignored
    expect(session.frameCount).toBe(2);
    expect(cast).toContain('BUS-A');
    expect(cast).toContain('BUS-B');
    expect(cast).not.toContain('BUS-C');
    expect(session.status).toBe('stopped');
    expect(session.stop()).toBe(cast); // idempotent
  });

  it('only records the subscribed surface (other surfaces ignored)', () => {
    const bus = new ChannelBus();
    const session = recordSurfaceFromBus(bus, 'tui:1');
    publishSelfReportFrame(bus, frame({ surfaceId: 'tui:2', text: 'OTHER' }));
    expect(session.frameCount).toBe(0);
  });
});
