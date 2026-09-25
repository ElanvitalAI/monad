// ⭐P2 (capture substrate) — manifest→ACP terminalFrame poller +
// `monad/term/terminalFrame` envelope round-trip unit tests.
//
// Covers:
//   - terminalFrame envelope format/parse round-trip (incl. multi-row
//     frame with embedded newlines · picker/modal)
//   - parse rejects malformed / missing fields
//   - capability parse (terminalFrame flag)
//   - pollAndBroadcastTuiFrames: kind filter, alive filter, empty-frame
//     skip, frameAt dedupe (no re-broadcast of unchanged frame), no-peers
//     early-out, vanished-surface map cleanup

import { describe, expect, test } from 'bun:test';

import {
  formatMonadTermEnvelope,
  parseMonadTermEnvelope,
  parseMonadTermCapabilities,
  type MonadTermFramePayload,
} from '../src/acp/monad-extensions.js';
import { pollAndBroadcastTuiFrames, type TermFrameBroadcaster } from '../src/capture/tui-frame-broadcaster.js';
import type { PtyManifestRow } from '../src/pty-shell/pty-manifest.js';

function frameRow(over: Partial<PtyManifestRow> = {}): PtyManifestRow {
  return {
    id: 'tui:1', kind: 'tui', cmd: 'monad', ownerPid: 1, instance: 'test:x',
    startedAt: 1000, alive: true, exitCode: null,
    snapshot: '', snapshotAt: 0, updatedAt: 2000,
    frame: '┌─ monad ─┐\n│ hi │\n└─────────┘', frameAt: 2000,
    ...over,
  };
}

describe('terminalFrame envelope', () => {
  test('format → parse round-trip preserves multi-row frame', () => {
    const payload: MonadTermFramePayload = {
      terminalId: 'tui:9', frame: 'row1\nrow2\n  picker  \nrow4', instance: 'test:a', at: 1717,
    };
    const text = formatMonadTermEnvelope({ method: 'terminalFrame', payload });
    const parsed = parseMonadTermEnvelope(text);
    expect(parsed?.method).toBe('terminalFrame');
    expect(parsed?.payload).toEqual(payload);
  });

  test('head/tail carry the terminalId for routing', () => {
    const text = formatMonadTermEnvelope({
      method: 'terminalFrame',
      payload: { terminalId: 'tui:42', frame: 'x', instance: 'i', at: 1 },
    });
    expect(text.startsWith('[monad/term/terminalFrame] tui:42\n')).toBe(true);
    expect(text.endsWith('<<monad-term-end tui:42>>')).toBe(true);
  });

  test('rejects missing/mistyped fields', () => {
    const bad = '[monad/term/terminalFrame] tui:1\n{"terminalId":"tui:1","frame":"x"}\n<<monad-term-end tui:1>>';
    expect(parseMonadTermEnvelope(bad)).toBeNull(); // missing instance + at
    const bad2 = '[monad/term/terminalFrame] tui:1\n{"terminalId":"tui:1","frame":5,"instance":"i","at":1}\n<<monad-term-end tui:1>>';
    expect(parseMonadTermEnvelope(bad2)).toBeNull(); // frame not a string
  });

  test('capability parse reads terminalFrame flag', () => {
    expect(parseMonadTermCapabilities({ monad: { term: { terminalFrame: true } } }).terminalFrame).toBe(true);
    expect(parseMonadTermCapabilities({ monad: { term: { terminalOutput: true } } }).terminalFrame).toBe(false);
    expect(parseMonadTermCapabilities(null).terminalFrame).toBe(false);
  });
});

describe('pollAndBroadcastTuiFrames', () => {
  function collector(): { calls: MonadTermFramePayload[]; bcast: TermFrameBroadcaster } {
    const calls: MonadTermFramePayload[] = [];
    const bcast: TermFrameBroadcaster = async (p) => { calls.push(p); return { delivered: 1, fannedTo: 1 }; };
    return { calls, bcast };
  }

  test('broadcasts a fresh tui frame', async () => {
    const { calls, bcast } = collector();
    const last = new Map<string, number>();
    const sent = await pollAndBroadcastTuiFrames(last, {
      listManifest: () => [frameRow()],
      getBroadcaster: () => bcast,
    });
    expect(sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.terminalId).toBe('tui:1');
    expect(calls[0]!.frame).toContain('monad');
    expect(calls[0]!.at).toBe(2000);
    expect(last.get('tui:1')).toBe(2000);
  });

  test('dedupes by frameAt — unchanged frame is not re-broadcast', async () => {
    const { calls, bcast } = collector();
    const last = new Map<string, number>();
    const rows = [frameRow()];
    await pollAndBroadcastTuiFrames(last, { listManifest: () => rows, getBroadcaster: () => bcast });
    const sent2 = await pollAndBroadcastTuiFrames(last, { listManifest: () => rows, getBroadcaster: () => bcast });
    expect(sent2).toBe(0);
    expect(calls).toHaveLength(1); // only the first pass fanned out
  });

  test('re-broadcasts when frameAt advances', async () => {
    const { calls, bcast } = collector();
    const last = new Map<string, number>();
    await pollAndBroadcastTuiFrames(last, { listManifest: () => [frameRow({ frameAt: 2000 })], getBroadcaster: () => bcast });
    await pollAndBroadcastTuiFrames(last, { listManifest: () => [frameRow({ frameAt: 3500, frame: 'new' })], getBroadcaster: () => bcast });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.frame).toBe('new');
  });

  test('broadcasts allowlisted framed kinds (P3: tui + forwarded pty), skips others/dead/empty', async () => {
    const { calls, bcast } = collector();
    const last = new Map<string, number>();
    const sent = await pollAndBroadcastTuiFrames(last, {
      getBroadcaster: () => bcast,
      listManifest: () => [
        // forwarded self-implement child = startPty default kind 'pty' + a
        // driver-written frame (matches production shape).
        frameRow({ id: 'a', kind: 'pty' }),             // ✓ forwarded child
        frameRow({ id: 'b', alive: false }),            // dead — skip
        frameRow({ id: 'c', frame: '', frameAt: 0 }),   // no frame — skip (raw shell)
        frameRow({ id: 'd', kind: 'tui' }),             // ✓ dashboard TUI
        frameRow({ id: 'e', kind: 'preview' }),         // framed but NOT allowlisted — skip
      ],
    });
    expect(sent).toBe(2);
    expect(calls.map((c) => c.terminalId).sort()).toEqual(['a', 'd']);
  });

  test('no broadcaster (no daemon/peers) → cheap early-out, no manifest read', async () => {
    let read = false;
    const sent = await pollAndBroadcastTuiFrames(new Map(), {
      getBroadcaster: () => null,
      listManifest: () => { read = true; return [frameRow()]; },
    });
    expect(sent).toBe(0);
    expect(read).toBe(false);
  });

  test('forgets vanished surfaces so the dedupe map cannot grow unbounded', async () => {
    const { bcast } = collector();
    const last = new Map<string, number>([['tui:gone', 999]]);
    await pollAndBroadcastTuiFrames(last, { listManifest: () => [frameRow({ id: 'tui:here' })], getBroadcaster: () => bcast });
    expect(last.has('tui:gone')).toBe(false);
    expect(last.has('tui:here')).toBe(true);
  });
});
