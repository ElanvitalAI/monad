// WT-C-1 — per-(sessionId, terminalId) asciicast recorder registry.
//
// Bridges PreviewTerminal raw output taps to the capture engine's
// `Recorder` so the PWA can drive start/stop via ACP ext methods and
// fetch the resulting `.cast` file via daemon HTTP.
//
// Why a registry (mirroring `preview-tap-registry`):
//   1. Recorder lifecycle is independent of the ACP connection — a
//      browser tab close / reload shouldn't drop a recording in
//      progress (next reconnect can stop + download).
//   2. Multiple terminals per session each get their own recorder,
//      keyed by `(sessionId, terminalId)`. Re-starting on the same key
//      is rejected (caller stops first), preventing accidental dual
//      recorders fighting over the same tap source.
//   3. Asciicast file naming `webterm-<terminalId>-<ts>.cast` lives
//      here so both the start handler (decides the id) and the HTTP
//      download endpoint (resolves it) agree on the same convention.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { lookupPreviewTerminal } from './preview-tap-registry.js';
import { createRecorder } from '../capture/recorder.js';
import type { RecorderHandle } from '../capture/types.js';
import {
  defaultTimelineBaseDir,
  timelinePathFor,
} from '../tool-runtime/recording-runtimes-paths.js';
import { debug } from '../debug/log.js';

interface RecordingEntry {
  recorderId: string;
  sessionId: string;
  terminalId: string;
  recorder: RecorderHandle;
  unsubscribe: () => void;
  startedAt: number;
}

const recordings = new Map<string, RecordingEntry>();

function key(sessionId: string, terminalId: string): string {
  return `${sessionId}::${terminalId}`;
}

/** Generate a stable, filesystem-safe recorder id. Including the
 *  terminalId aids triage; the timestamp avoids collisions when the
 *  same terminal is recorded in succession. */
function newRecorderId(terminalId: string, now: number): string {
  // Allow only [a-zA-Z0-9_-] in terminalId segment so the resulting
  // path can't escape the timelines dir (defence-in-depth — the HTTP
  // download endpoint validates separately).
  const safeTid = terminalId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  return `webterm-${safeTid}-${now}`;
}

export interface StartRecordingResult {
  recorderId: string;
  sessionId: string;
  terminalId: string;
  startedAt: number;
}

export interface StopRecordingResult {
  recorderId: string;
  sessionId: string;
  terminalId: string;
  path: string;
  frameCount: number;
  elapsedSec: number;
}

export interface RecordingStatusEntry {
  recorderId: string;
  terminalId: string;
  status: 'recording' | 'paused' | 'stopped' | 'idle';
  startedAt: number;
  frameCount: number;
  elapsedSec: number;
}

/** Begin recording the terminal identified by `(sessionId, terminalId)`.
 *  Throws when the terminal is unknown (caller's job to translate to
 *  a JSON error response) or when a recording is already active for
 *  the same key. The latter is a hard reject rather than idempotent
 *  attach so a duplicate Record-button click doesn't silently start a
 *  second recorder fighting over the tap. */
export function startWebTerminalRecording(
  sessionId: string,
  terminalId: string,
  opts: {
    /** Defaults to `Date.now`. Tests override for determinism. */
    now?: () => number;
    /** Override base dir for stop-time writes (tests). */
    baseDir?: string;
  } = {},
): StartRecordingResult {
  const k = key(sessionId, terminalId);
  if (recordings.has(k)) {
    throw new Error(`recording already active for ${terminalId}`);
  }
  const pt = lookupPreviewTerminal(sessionId, terminalId);
  if (!pt) throw new Error(`unknown terminal: ${terminalId}`);

  const now = opts.now ?? Date.now;
  const startedAt = now();
  const recorderId = newRecorderId(terminalId, startedAt);
  const recorder = createRecorder({
    dims: { cols: pt.cols, rows: pt.rows },
    title: `webterm-${terminalId}`,
    now,
  });
  recorder.start();

  // Tap raw output → recorder.write. `addRawOutputTap` is the same
  // hook preview-tap-registry uses for ACP fan-out; multiple taps
  // are independent so the recording subscription doesn't interfere
  // with the live PWA stream.
  const off = pt.addRawOutputTap((chunk) => recorder.write(chunk, 'o'));

  recordings.set(k, {
    recorderId,
    sessionId,
    terminalId,
    recorder,
    unsubscribe: off,
    startedAt,
  });
  if (debug.enabled) {
    debug.log('webterm.recording', 'start', { sessionId, terminalId, recorderId });
  }
  // Stash the override base for stop-time writes. Per-call rather
  // than per-module so concurrent tests can hold their own dirs.
  if (opts.baseDir) baseDirOverrides.set(recorderId, opts.baseDir);
  return { recorderId, sessionId, terminalId, startedAt };
}

const baseDirOverrides = new Map<string, string>();

/** Stop the active recording for `(sessionId, terminalId)`, serialize
 *  it to asciicast v2, write to `<baseDir>/<recorderId>.cast`, and
 *  return the on-disk path + summary stats. Throws when no recording
 *  is active for that key. */
export function stopWebTerminalRecording(
  sessionId: string,
  terminalId: string,
  opts: {
    /** Override the disk write helper. Tests pass an in-memory shim
     *  so the assertion target is the serialized text rather than
     *  filesystem state. */
    writeCast?: (filePath: string, body: string) => void;
  } = {},
): StopRecordingResult {
  const k = key(sessionId, terminalId);
  const entry = recordings.get(k);
  if (!entry) throw new Error(`no active recording for ${terminalId}`);

  // Drop the tap before stop() so a chunk arriving mid-stop doesn't
  // race the state transition into 'stopped' (write() would silently
  // drop it but better to never enqueue at all).
  entry.unsubscribe();
  entry.recorder.stop();
  const body = entry.recorder.serialize();

  const baseDir = baseDirOverrides.get(entry.recorderId) ?? defaultTimelineBaseDir();
  baseDirOverrides.delete(entry.recorderId);
  const filePath = timelinePathFor(baseDir, entry.recorderId);

  const writer = opts.writeCast ?? defaultWriteCast;
  writer(filePath, body);

  recordings.delete(k);
  const result: StopRecordingResult = {
    recorderId: entry.recorderId,
    sessionId: entry.sessionId,
    terminalId: entry.terminalId,
    path: filePath,
    frameCount: entry.recorder.frameCount,
    elapsedSec: entry.recorder.elapsedSec,
  };
  if (debug.enabled) {
    debug.log('webterm.recording', 'stop', {
      sessionId,
      terminalId,
      recorderId: entry.recorderId,
      frameCount: result.frameCount,
      elapsedSec: result.elapsedSec,
      path: filePath,
    });
  }
  return result;
}

function defaultWriteCast(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, 'utf8');
}

/** Enumerate active recordings for a session. Used by `terminal/record/list`
 *  so the PWA can show a "currently recording" badge per tab when
 *  reconnecting after a reload. */
export function listWebTerminalRecordings(sessionId: string): RecordingStatusEntry[] {
  const result: RecordingStatusEntry[] = [];
  for (const e of recordings.values()) {
    if (e.sessionId !== sessionId) continue;
    result.push({
      recorderId: e.recorderId,
      terminalId: e.terminalId,
      status: e.recorder.status,
      startedAt: e.startedAt,
      frameCount: e.recorder.frameCount,
      elapsedSec: e.recorder.elapsedSec,
    });
  }
  return result;
}

/** Abort a recording without persisting the cast file. Used as a
 *  cleanup hook when the underlying terminal is destroyed mid-record
 *  (the bytes already captured become orphaned otherwise). */
export function abortWebTerminalRecording(sessionId: string, terminalId: string): boolean {
  const k = key(sessionId, terminalId);
  const entry = recordings.get(k);
  if (!entry) return false;
  entry.unsubscribe();
  entry.recorder.stop();
  recordings.delete(k);
  baseDirOverrides.delete(entry.recorderId);
  if (debug.enabled) {
    debug.log('webterm.recording', 'abort', { sessionId, terminalId, recorderId: entry.recorderId });
  }
  return true;
}

/** Test-only — wipe the registry between cases. */
export function __resetWebTerminalRecordings(): void {
  for (const e of recordings.values()) {
    try { e.unsubscribe(); } catch { /* ignore */ }
    try { e.recorder.stop(); } catch { /* ignore */ }
  }
  recordings.clear();
  baseDirOverrides.clear();
}
