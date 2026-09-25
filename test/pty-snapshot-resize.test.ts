// PtyShellSnapshot + PtyShellResize — the screen-model capabilities that
// let a headless agent drive full-screen TUIs. Snapshot renders the live
// xterm-headless grid (cursor addressing resolved) instead of raw ANSI;
// Resize sends SIGWINCH + resizes the emulator. Exercises the REAL Bun-
// native PTY backend (bun test runs under bun, where the emulator + PTY
// both work).

import { describe, test, expect, afterAll, afterEach, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  dispatchPtyShellStart,
  dispatchPtyShellSend,
  dispatchPtyShellSnapshot,
  dispatchPtyShellResize,
  dispatchPtyShellScreenshot,
  dispatchPtyShellKill,
} from '../src/skills/tools/pty';
import { getPty, resetForTesting } from '../src/pty-shell/registry';

const activeBashPids = new Set<string>();
const harnessSpace = process.env.MONAD_HARNESS_SPACE;
const harnessSpaceId = process.env.MONAD_HARNESS_SPACE_ID;

beforeAll(() => {
  delete process.env.MONAD_HARNESS_SPACE;
  delete process.env.MONAD_HARNESS_SPACE_ID;
});

afterAll(() => {
  if (harnessSpace === undefined) delete process.env.MONAD_HARNESS_SPACE;
  else process.env.MONAD_HARNESS_SPACE = harnessSpace;
  if (harnessSpaceId === undefined) delete process.env.MONAD_HARNESS_SPACE_ID;
  else process.env.MONAD_HARNESS_SPACE_ID = harnessSpaceId;
});

afterEach(async () => {
  try {
    for (const process_id of activeBashPids) {
      await dispatchPtyShellKill({ process_id });
      expect(getPty(process_id)).toBeUndefined();
    }
  } finally {
    activeBashPids.clear();
    resetForTesting();
  }
});

async function startBash(cols = 80, rows = 24): Promise<string> {
  const s = await dispatchPtyShellStart(
    { cmd: 'bash', args: ['--norc', '--noprofile', '-i'], cols, rows, yield_time_ms: 400 },
    { requireApproval: false },
  );
  const pid = String(s.output).match(/process_id=(\S+)/)?.[1];
  if (!pid) throw new Error('no process_id');
  activeBashPids.add(pid);
  return pid;
}

describe('PtyShellSnapshot — live screen grid', () => {
  test('renders cursor-addressed text at its grid position (not raw ANSI)', async () => {
    const pid = await startBash();
    // Place text at an absolute position via CSI cursor addressing. A raw
    // byte delta would show the escape sequence; the emulator resolves it
    // to a positioned cell so the snapshot reads like the visible screen.
    await dispatchPtyShellSend(
      { process_id: pid, input: 'clear; printf "\\033[5;20HPLACED_AT_5_20"\n', yield_time_ms: 400 },
    );
    const snap = await dispatchPtyShellSnapshot({ process_id: pid });
    expect(snap.output).toContain('PLACED_AT_5_20');
    // No literal escape sequence in the rendered grid.
    expect(snap.output).not.toContain('[5;20H');
    // Header advertises dims + cursor.
    expect(snap.output).toMatch(/screen 80x24/);
    await dispatchPtyShellKill({ process_id: pid });
    activeBashPids.delete(pid);
  });

  test('unknown process_id throws', async () => {
    await expect(dispatchPtyShellSnapshot({ process_id: 'pty_nope' })).rejects.toThrow(/unknown process_id/);
  });
});

describe('PtyShellResize — SIGWINCH + emulator resize', () => {
  test('child process observes the new size and snapshot header updates', async () => {
    const pid = await startBash(80, 24);
    const rz = dispatchPtyShellResize({ process_id: pid, cols: 100, rows: 30 });
    expect(rz.output).toContain('100x30');
    // The child sees the new size (SIGWINCH → tput reads the pty size).
    await dispatchPtyShellSend({ process_id: pid, input: 'clear\n', yield_time_ms: 150 });
    const r = await dispatchPtyShellSend(
      { process_id: pid, input: 'echo SZ=$(tput cols)x$(tput lines)\n', yield_time_ms: 400 },
    );
    expect(r.output).toContain('SZ=100x30');
    // Emulator resized too — snapshot header reflects it.
    const snap = await dispatchPtyShellSnapshot({ process_id: pid });
    expect(snap.output).toMatch(/screen 100x30/);
    await dispatchPtyShellKill({ process_id: pid });
    activeBashPids.delete(pid);
  });

  test('rejects non-numeric dims', async () => {
    const pid = await startBash();
    expect(() => dispatchPtyShellResize({ process_id: pid, cols: 'x' as unknown as number, rows: 30 })).toThrow();
  });
});

describe('PtyShellScreenshot — grid → PNG image', () => {
  test('renders the current screen to a valid PNG and returns an image pointer', async () => {
    const pid = await startBash();
    await dispatchPtyShellSend(
      { process_id: pid, input: 'clear; printf "\\033[3;10HSHOT"; printf "\\033[6;5H\\033[31mRED\\033[0m"\n', yield_time_ms: 400 },
    );
    const shot = await dispatchPtyShellScreenshot({ process_id: pid });
    // Delivering surfaces attach _imageFile; the text output is the LLM-visible line.
    expect(shot.output).toContain('attached as image');
    expect(shot._imageFile).toBeDefined();
    expect(shot._imageCaption).toContain('PtyShell');
    const png = readFileSync(shot._imageFile!);
    // PNG magic bytes.
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png.length).toBeGreaterThan(1000);
    await dispatchPtyShellKill({ process_id: pid });
    activeBashPids.delete(pid);
  });

  test('unknown process_id throws', async () => {
    await expect(dispatchPtyShellScreenshot({ process_id: 'pty_nope' })).rejects.toThrow(/unknown process_id/);
  });
});
