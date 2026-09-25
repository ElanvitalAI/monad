// RFC #2161 FU A7 — Discovery snapshot S3 push.
//
// After `runDiscovery` writes the snapshot to the local cache file,
// this helper optionally mirrors it to S3 under two keys:
//
//   monad/<monad_id>/discovery-cache/latest.json       — overwrites
//   monad/<monad_id>/discovery-history/<iso-ts>.json    — append-only
//
// `latest.json` lets external scripts (CI · Vercel build · other
// monad-agent hosts on the same account) pull the freshest model
// list without re-running discovery. The history bucket gives a per-
// machine audit trail of when each model first/last appeared.
//
// Push is gated on `isS3Available()` — same pattern as
// `day-bucket-store.ts`. When the user opts out (MONAD_S3_DISABLED=1
// or no `aws` CLI / creds) the push is silently skipped so daemon
// boot doesn't pay the cost.
//
// Cross-ref:
//   src/storage/s3.ts (SoT for keys + transport)
//   src/notes/day-bucket-store.ts (reference push pattern)
//   src/registry/discovery/runner.ts (caller · opt-in)

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isS3Available,
  s3MonadKey,
  uploadFile,
} from '../../storage/s3.js';
import type { DiscoverySnapshot } from './runner.js';

/** Transport seam — production wires through `s3.ts` helpers, tests
 *  inject a stub so they don't need a real `aws` CLI. */
export interface DiscoveryS3Transport {
  available: () => boolean;
  upload: (localPath: string, key: string) => void;
}

const defaultTransport: DiscoveryS3Transport = {
  available: isS3Available,
  upload: uploadFile,
};

export interface PushSnapshotOpts {
  /** Test seam · transport override. */
  transport?: DiscoveryS3Transport;
  /** Test seam · ISO timestamp generator for the history filename. */
  now?: () => Date;
  /** When true, only the discovery-history/ key is uploaded (skip
   *  the latest.json overwrite). Useful for backfills or scheduled
   *  cron runs that don't want to clobber the latest. */
  historyOnly?: boolean;
}

export interface PushSnapshotResult {
  /** True when at least one S3 upload succeeded. False when
   *  `transport.available()` returned false (S3 disabled / no creds). */
  pushed: boolean;
  /** Reason for skip · undefined on success. */
  reason?: 'disabled' | 'transport-error';
  /** S3 keys uploaded — empty when pushed=false. */
  keys: string[];
  /** Error message when reason='transport-error'. */
  error?: string;
}

/** Build the canonical ISO-timestamp filename for the history bucket.
 *  Drop the trailing milliseconds + 'Z' (`...:00.000Z` → `...:00`) and
 *  swap colons for hyphens so the value works as an S3 key on
 *  Windows-style clients too. */
export function historyKeyFilename(now: Date): string {
  const iso = now.toISOString();
  // Strip milliseconds + 'Z'  →  '2026-05-11T13:42:09'
  const trimmed = iso.split('.')[0] ?? iso.replace(/Z$/, '');
  // Replace ':' so S3 + Windows + URL paths stay clean
  return `${trimmed.replace(/:/g, '-')}.json`;
}

/** Mirror the snapshot to S3 (`discovery-cache/latest.json` +
 *  `discovery-history/<iso-ts>.json`). Returns silently when S3 is
 *  unavailable — callers should treat the result as best-effort. */
export function pushDiscoverySnapshotToS3(
  snapshot: DiscoverySnapshot,
  opts: PushSnapshotOpts = {},
): PushSnapshotResult {
  const transport = opts.transport ?? defaultTransport;
  if (!transport.available()) {
    return { pushed: false, reason: 'disabled', keys: [] };
  }

  const now = opts.now ?? (() => new Date());
  const tmpDir = mkdtempSync(join(tmpdir(), 'monad-discovery-s3-'));
  const tmpPath = join(tmpDir, 'snapshot.json');
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  writeFileSync(tmpPath, json, { encoding: 'utf8' });

  const keys: string[] = [];
  try {
    const historyKey = s3MonadKey('discoveryHistory', historyKeyFilename(now()));
    transport.upload(tmpPath, historyKey);
    keys.push(historyKey);

    if (!opts.historyOnly) {
      const latestKey = s3MonadKey('discoveryCache', 'latest.json');
      transport.upload(tmpPath, latestKey);
      keys.push(latestKey);
    }
    return { pushed: true, keys };
  } catch (e) {
    return {
      pushed: false,
      reason: 'transport-error',
      keys,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); }
    catch { /* best-effort */ }
  }
}
