// ── StderrSink (MSS M2.2 Phase A2) ──
//
// Opt-in sink that mirrors every record to `process.stderr` as one
// NDJSON line. Registered on the `debug` singleton at module load when
// `MSS_STDERR_SINK=1`; a level filter (`MSS_STDERR_LEVEL=warn` etc.)
// skips records below the configured severity.
//
// Use cases:
//   • CI runs that capture stderr in the job log
//   • container sidecars / log forwarders that already tail stderr
//   • local `monad ... 2> trace.log` redirection without touching
//     the file-sink ring
//
// Default off — an always-on stderr stream would flood interactive
// sessions with ANSI-noisy JSONL and compete with the TUI for the
// same fd. Opt-in keeps the cost at zero when unused.

import { LOG_LEVEL_ORDER, type LogLevel, type LogRecord } from '../record.js';
import type { LogSink } from '../sink.js';

export interface StderrSinkOptions {
  /** Minimum severity to emit. Records below this rank are dropped.
   *  Records without a `level` are treated as `'debug'`. Undefined
   *  disables the filter so every record emits. */
  minLevel?: LogLevel;
  /** Writer function; defaults to `process.stderr.write`. Tests
   *  override to capture emitted lines. */
  write?: (line: string) => void;
}

/** Implicit level assigned to records that omit `level`. Matches the
 *  legacy `debug.log()` call-site assumption (every trace is at
 *  `debug` severity unless the caller upgraded it explicitly). */
const DEFAULT_LEVEL: LogLevel = 'debug';

export class StderrSink implements LogSink {
  readonly name = 'stderr';
  private _minRank: number | null;
  private _write: (line: string) => void;

  constructor(opts: StderrSinkOptions = {}) {
    this._minRank = opts.minLevel !== undefined
      ? LOG_LEVEL_ORDER[opts.minLevel]
      : null;
    this._write = opts.write ?? ((line) => { process.stderr.write(line); });
  }

  emit(rec: LogRecord): void {
    if (this._minRank !== null) {
      const lvl: LogLevel = rec.level ?? DEFAULT_LEVEL;
      const rank = LOG_LEVEL_ORDER[lvl] ?? LOG_LEVEL_ORDER[DEFAULT_LEVEL];
      if (rank < this._minRank) return;
    }
    try { this._write(JSON.stringify(rec) + '\n'); } catch { /* swallow */ }
  }
}

/** Construct a StderrSink from the current MSS flag snapshot, or
 *  return null when the flag is off. Imported and called once from
 *  `src/debug/log.ts` after the singleton is constructed; kept as a
 *  free function so `stderr-sink.ts` has no runtime dependency on
 *  the debug module (avoids an import cycle). */
export function createStderrSinkFromFlags(
  flags: { stderrSink: boolean; stderrSinkLevel: LogLevel | undefined },
): StderrSink | null {
  if (!flags.stderrSink) return null;
  return new StderrSink({ minLevel: flags.stderrSinkLevel });
}
