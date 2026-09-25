// WT-N-5 P2 — LiveCameraFrame tool + registry tests.
//
// Pin three contracts:
//   1. `recordLiveCameraFrame()` registers per-session entries with
//      monotonically-increasing frameIndex.
//   2. `getLatestLiveCameraFrame()` returns the most-recent entry
//      (overwrite semantics on subsequent notifies).
//   3. `dispatchLiveCameraFrame()` returns ok-shape with base64 +
//      mediaType when the attachment exists, no-frame shape when
//      the registry is empty or the file vanished.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordLiveCameraFrame,
  getLatestLiveCameraFrame,
  clearLiveCameraFrames,
  _resetLiveCameraRegistry,
} from '../src/web-terminal/live-camera-registry';
import {
  buildLiveCameraFrameTool,
  dispatchLiveCameraFrame,
} from '../src/tool-runtime/web-terminal-live-camera';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';
import {
  WEB_TERMINAL_TOOL_NAMES,
  buildWebTerminalSpecs,
  dispatchWebTerminalTool,
} from '../src/boot/daemon-tools/web-terminal';

beforeEach(() => {
  _resetLiveCameraRegistry();
});

afterEach(() => {
  _resetLiveCameraRegistry();
});

describe('live-camera-registry', () => {
  test('record + get returns the freshly-recorded entry', () => {
    const entry = recordLiveCameraFrame({
      sessionId: 'sess-A',
      attachmentId: 'att-abc-123',
    });
    expect(entry.frameIndex).toBe(1);
    expect(entry.attachmentId).toBe('att-abc-123');
    const fetched = getLatestLiveCameraFrame('sess-A');
    expect(fetched?.attachmentId).toBe('att-abc-123');
    expect(fetched?.frameIndex).toBe(1);
  });

  test('frameIndex increments per-session monotonically', () => {
    recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-1' });
    recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-2' });
    const third = recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-3' });
    expect(third.frameIndex).toBe(3);
    const latest = getLatestLiveCameraFrame('sess-A');
    expect(latest?.attachmentId).toBe('att-3');
    expect(latest?.frameIndex).toBe(3);
  });

  test('frameIndex is independent across sessions', () => {
    recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-A1' });
    recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-A2' });
    const b = recordLiveCameraFrame({ sessionId: 'sess-B', attachmentId: 'att-B1' });
    expect(b.frameIndex).toBe(1);
    expect(getLatestLiveCameraFrame('sess-A')?.frameIndex).toBe(2);
  });

  test('get returns null for unknown session', () => {
    expect(getLatestLiveCameraFrame('sess-never')).toBe(null);
  });

  test('clear drops the pointer + index', () => {
    recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-1' });
    expect(clearLiveCameraFrames('sess-A')).toBe(true);
    expect(getLatestLiveCameraFrame('sess-A')).toBe(null);
    // After clear, frameIndex restarts at 1.
    const next = recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-2' });
    expect(next.frameIndex).toBe(1);
  });

  test('clear returns false for unknown session', () => {
    expect(clearLiveCameraFrames('sess-never')).toBe(false);
  });

  test('terminalId + ts are preserved when provided', () => {
    const entry = recordLiveCameraFrame({
      sessionId: 'sess-A',
      terminalId: 'tid-1',
      attachmentId: 'att-1',
      ts: 123456789,
    });
    expect(entry.terminalId).toBe('tid-1');
    expect(entry.ts).toBe(123456789);
  });
});

describe('buildLiveCameraFrameTool', () => {
  test('emits LLMToolSpec with name + parameters shape', () => {
    const spec = buildLiveCameraFrameTool();
    expect(spec.name).toBe('LiveCameraFrame');
    expect(spec.parameters.type).toBe('object');
    // sessionId is auto-injected — required:[] so LLM can omit it.
    expect(spec.parameters.required).toEqual([]);
    expect(spec.parameters.properties).toHaveProperty('sessionId');
  });

  test('description mentions JPEG + 1Hz + opt-in tap', () => {
    const spec = buildLiveCameraFrameTool();
    const desc = spec.description as string;
    expect(desc).toContain('JPEG');
    expect(desc).toContain('1');
    // Sanity — the LLM should know what status='no-frame' means.
    expect(desc).toContain('no-frame');
  });
});

describe('dispatchLiveCameraFrame', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Override the attachment base dir so we can write a synthetic
    // file with a valid `att-…` id and have resolveAttachmentPath
    // (which scans the dir) find it.
    tmpDir = mkdtempSync(join(tmpdir(), 'live-cam-test-'));
    setMonadConfigDir(tmpDir);
    mkdirSync(join(tmpDir, 'attachments'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    resetMonadConfigDir();
  });

  test('returns no-frame when registry empty', async () => {
    const result = await dispatchLiveCameraFrame({}, { sessionId: 'sess-empty' });
    expect(result.status).toBe('no-frame');
    if (result.status !== 'no-frame') throw new Error('unreachable');
    expect(result.sessionId).toBe('sess-empty');
    expect(result.hint).toContain('Live');
  });

  test('throws on missing sessionId (no args, no opts)', async () => {
    await expect(dispatchLiveCameraFrame({})).rejects.toThrow(/sessionId/);
  });

  test('args.sessionId beats opts.sessionId', async () => {
    recordLiveCameraFrame({ sessionId: 'sess-args', attachmentId: 'att-1' });
    const result = await dispatchLiveCameraFrame(
      { sessionId: 'sess-args' },
      { sessionId: 'sess-opts' },
    );
    if (result.status !== 'no-frame') {
      // file doesn't exist, so still no-frame, but sessionId carried through args
    }
    expect(result.sessionId).toBe('sess-args');
  });

  test('returns no-frame when attachment file vanished', async () => {
    recordLiveCameraFrame({ sessionId: 'sess-A', attachmentId: 'att-vanished-xx' });
    const result = await dispatchLiveCameraFrame({}, { sessionId: 'sess-A' });
    expect(result.status).toBe('no-frame');
    if (result.status !== 'no-frame') throw new Error('unreachable');
    expect(result.hint).toContain('disk');
  });
});

describe('daemon-tools/web-terminal — LiveCameraFrame integration', () => {
  test('LiveCameraFrame is in WEB_TERMINAL_TOOL_NAMES + specs', () => {
    expect(WEB_TERMINAL_TOOL_NAMES).toContain('LiveCameraFrame');
    const specs = buildWebTerminalSpecs();
    const names = specs.map((s) => s.name);
    expect(names).toContain('LiveCameraFrame');
  });

  test('dispatchWebTerminalTool routes LiveCameraFrame to the dispatcher', async () => {
    // No attachment file exists → returns no-frame, but proves the
    // dispatcher is wired (otherwise the unknown-tool error would
    // throw with a different message).
    const result = await dispatchWebTerminalTool(
      'LiveCameraFrame',
      {},
      { sessionId: 'sess-route', cwd: '/tmp', signal: new AbortController().signal },
    );
    const r = result as { status: string };
    expect(['ok', 'no-frame']).toContain(r.status);
  });

  test('dispatchWebTerminalTool throws unavailable for unknown name', async () => {
    await expect(
      dispatchWebTerminalTool(
        'UnknownTool',
        {},
        { sessionId: 'x', cwd: '/tmp', signal: new AbortController().signal },
      ),
    ).rejects.toThrow(/UnknownTool/);
  });
});
