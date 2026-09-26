// ⭐P5 — frame → episodic self-memory. Pure summarizer + debounce/dedup
// consumer + manifest poller (records salient screen changes into
// surface_events for `elanous self recall`).

import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  summarizeFrame,
  createFrameMemoryConsumer,
  pollFrameMemory,
  type FrameMemoryConsumer,
} from '../src/capture/frame-memory.js';
import { openSurfaceEventsDb } from '../src/domains/surface-events.js';
import { recordSelfEvent, recallSelfEvents, type SelfEventInput } from '../src/domains/self-awareness.js';
import type { PtyManifestRow } from '../src/pty-shell/pty-manifest.js';

describe('summarizeFrame', () => {
  it('extracts tool-call markers + salient line, prefixed by surfaceId', () => {
    const screen = [
      '┌─ elanous ───────────────┐',
      '│ ⏺ Read(src/foo.ts)     │',
      '│ ⏺ Edit(src/foo.ts)     │',
      '│ 빌드 계속 중…           │',
      '└────────────────────────┘',
    ].join('\n');
    const { summary, kind } = summarizeFrame(screen, 'tui:42');
    expect(kind).toBe('frame');
    expect(summary.startsWith('tui:42:')).toBe(true);
    expect(summary).toContain('Read(src/foo.ts)');
    expect(summary).toContain('Edit(src/foo.ts)');
    expect(summary).toContain('빌드 계속 중');
    // box-drawing chars scrubbed
    expect(summary).not.toContain('│');
    expect(summary).not.toContain('┌');
  });

  it('falls back to the last content line when there are no tool calls', () => {
    expect(summarizeFrame('hello\nworld', 'tui:1').summary).toBe('tui:1: world');
  });

  it('empty / border-only screen → (empty screen)', () => {
    expect(summarizeFrame('┌────┐\n│    │\n└────┘', 'tui:1').summary).toBe('tui:1: (empty screen)');
    expect(summarizeFrame('', 'tui:1').summary).toBe('tui:1: (empty screen)');
  });

  it('caps summary length', () => {
    expect(summarizeFrame('x'.repeat(500), 'tui:1').summary.length).toBeLessThanOrEqual(220);
  });

  it('prioritizes the salient line — long tool calls are trimmed, salient survives whole', () => {
    const longTool = `⏺ Edit(${'d/'.repeat(90)}deep/file.ts)`;   // very long tool-call
    const salient = 'CRITICAL-STATUS-LINE-KEEP-WHOLE';
    const { summary } = summarizeFrame(`${longTool}\n${salient}`, 'tui:1');
    expect(summary.length).toBeLessThanOrEqual(220);
    expect(summary).toContain(salient);            // salient never truncated
  });
});

describe('createFrameMemoryConsumer (debounce + dedup)', () => {
  function harness(minGapMs = 5000) {
    const recorded: SelfEventInput[] = [];
    let t = 1000;
    const consumer = createFrameMemoryConsumer({ record: (i) => recorded.push(i), minGapMs, now: () => t });
    return { recorded, consumer, set: (v: number) => { t = v; } };
  }
  const obs = (over: Partial<{ text: string; surfaceId: string; instance: string; frameAt: number }> = {}) => ({
    surfaceId: 'tui:1', instance: 'test:x', text: 'SCREEN', frameAt: 100, ...over,
  });

  it('records the first observation with refs pointers (not a blob)', () => {
    const { recorded, consumer } = harness();
    const ev = consumer.observe(obs({ text: 'first line' }));
    expect(ev).not.toBeNull();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.tool).toBe('tui-observe');
    expect(recorded[0]!.kind).toBe('frame');
    expect(recorded[0]!.importance).toBe(4);
    expect(recorded[0]!.refs).toEqual({ surfaceId: 'tui:1', instance: 'test:x', frameAt: 100 });
  });

  it('dedups an unchanged screen (same summary → no event)', () => {
    const { recorded, consumer, set } = harness();
    consumer.observe(obs({ text: 'same' }));
    set(100_000);                                   // far past the gap
    expect(consumer.observe(obs({ text: 'same' }))).toBeNull(); // unchanged → dedup
    expect(recorded).toHaveLength(1);
  });

  it('rate-limits rapid changes (< minGapMs) even when the summary changes', () => {
    const { recorded, consumer, set } = harness(5000);
    consumer.observe(obs({ text: 'A' }));
    set(2000);                                      // only 1s later
    expect(consumer.observe(obs({ text: 'B' }))).toBeNull(); // changed but too soon
    expect(recorded).toHaveLength(1);
  });

  it('records a changed screen once the gap has elapsed', () => {
    const { recorded, consumer, set } = harness(5000);
    consumer.observe(obs({ text: 'A' }));
    set(7000);                                      // > minGap
    expect(consumer.observe(obs({ text: 'B' }))).not.toBeNull();
    expect(recorded).toHaveLength(2);
  });

  it('a change suppressed by the rate-limit is NOT permanently lost (recorded once eligible)', () => {
    const { recorded, consumer, set } = harness(5000);
    consumer.observe(obs({ text: 'A' }));           // t=1000 → record A
    set(2000);
    expect(consumer.observe(obs({ text: 'B' }))).toBeNull();   // changed but too soon → suppressed
    set(7000);
    const ev = consumer.observe(obs({ text: 'B' }));           // still B, gap elapsed → now recorded
    expect(ev).not.toBeNull();
    expect(recorded).toHaveLength(2);
    expect(recorded[1]!.summary).toContain('B');    // the suppressed change surfaced, not dropped
  });

  it('tracks surfaces independently (per instance+surfaceId)', () => {
    const { recorded, consumer } = harness();
    consumer.observe(obs({ surfaceId: 'tui:1', text: 'A' }));
    consumer.observe(obs({ surfaceId: 'tui:2', text: 'A' }));   // different surface — records
    expect(recorded).toHaveLength(2);
  });
});

describe('record → recall integration (real surface_events + FTS)', () => {
  it('a summarized frame is written to surface_events and retrieved by elanous self recall', () => {
    const db = openSurfaceEventsDb(join(mkdtempSync(join(tmpdir(), 'p5-recall-')), 'se.db'));
    try {
      const consumer = createFrameMemoryConsumer({ record: (i) => recordSelfEvent(db, i), now: () => 1000 });
      consumer.observe({
        surfaceId: 'tui:9', instance: 'test:x', frameAt: 500,
        text: '⏺ Edit(quokkafile.ts)\nbuilding QUOKKATOKEN feature',
      });
      const hits = recallSelfEvents(db, 'QUOKKATOKEN', { limit: 5 });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.summary).toContain('QUOKKATOKEN');
      expect(hits[0]!.summary).toContain('Edit(quokkafile.ts)');
      expect(hits[0]!.surface).toBe('ext:tui-observe');
      // refs stores POINTERS (surfaceId/instance/frameAt), not a frame blob.
      const refs = JSON.parse(hits[0]!.refs ?? '{}') as { surfaceId?: string; frameAt?: number };
      expect(refs.surfaceId).toBe('tui:9');
      expect(refs.frameAt).toBe(500);
    } finally {
      db.close();
    }
  });
});

describe('pollFrameMemory', () => {
  function row(over: Partial<PtyManifestRow> = {}): PtyManifestRow {
    return {
      id: 'tui:1', kind: 'tui', cmd: 'elanous', ownerPid: 1, instance: 'test:x',
      startedAt: 0, alive: true, exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 0,
      frame: 'hi there', frameAt: 100, ...over,
    };
  }
  function consumerCapturing(): { recorded: SelfEventInput[]; consumer: FrameMemoryConsumer } {
    const recorded: SelfEventInput[] = [];
    return { recorded, consumer: createFrameMemoryConsumer({ record: (i) => recorded.push(i), now: () => 1000 }) };
  }

  it('records live tui/pty framed rows, skips others/dead/empty', () => {
    const { recorded, consumer } = consumerCapturing();
    const n = pollFrameMemory(consumer, {
      listManifest: () => [
        row({ id: 'a', kind: 'tui', frame: 'A' }),          // ✓
        row({ id: 'b', kind: 'pty', frame: 'B' }),          // ✓ forwarded child
        row({ id: 'c', kind: 'preview', frame: 'C' }),      // not allowlisted — skip
        row({ id: 'd', alive: false, frame: 'D' }),         // dead — skip
        row({ id: 'e', frame: '', frameAt: 0 }),            // no frame — skip
      ],
    });
    expect(n).toBe(2);
    expect(recorded.map((r) => (r.refs as { surfaceId: string }).surfaceId).sort()).toEqual(['a', 'b']);
  });
});
