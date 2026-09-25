// ── User-Intent JSONL sink — daily rotation local writer ──
//
// PLAN §4.1 — `~/.monad/user-intents/{YYYY-MM-DD}.jsonl`, append-only.
// Always-on local sink; the OTel + Patcher fan-out sinks are
// downstream of this file (Y3 Patcher reads the JSONL stream).
//
// Design:
//   - Path resolved via `getMonadConfigDir()` so the sink honors
//     `MONAD_DAEMON_DIR` like the rest of the codebase.
//   - Synchronous append on every emit — events are small (~500 B
//     typical) and the JSONL line is the durability boundary. Async
//     write would create a window where a process crash drops the
//     last event.
//   - Daily rotation on UTC date — read side trivially globs the
//     directory by date pattern; KGS Patcher ingest does the same.
//   - Best-effort: a directory-create failure does not throw to the
//     caller. Logging the intent fabric must never break the user
//     flow.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getMonadConfigDir } from '../../monad-config-dir.js';
import type { UserIntentEvent } from '../types.js';

const SUBDIR = 'user-intents';

/** Test override — points the sink at a tmp dir instead of
 *  `~/.monad/user-intents/`. */
let overrideDir: string | null = null;

export function setUserIntentJsonlDirOverride(dir: string | null): void {
  overrideDir = dir;
}

function rootDir(): string {
  return overrideDir ?? join(getMonadConfigDir(), SUBDIR);
}

function utcDateStamp(ts: string): string {
  // `ts` is ISO-8601 UTC ('YYYY-MM-DDTHH:mm:ss.sssZ'); slice keeps
  // the date prefix without any timezone math.
  return ts.slice(0, 10);
}

export function userIntentJsonlPath(ts: string): string {
  return join(rootDir(), `${utcDateStamp(ts)}.jsonl`);
}

let dirEnsured = false;
function ensureDir(): void {
  if (dirEnsured && overrideDir === null) return;
  try {
    mkdirSync(rootDir(), { recursive: true, mode: 0o700 });
    dirEnsured = true;
  } catch {
    // best-effort
  }
}

export interface JsonlSinkResult {
  path: string;
  bytesWritten: number;
}

export function writeUserIntentJsonl(event: UserIntentEvent): JsonlSinkResult | null {
  try {
    ensureDir();
    const path = userIntentJsonlPath(event.ts);
    const line = `${JSON.stringify(event)}\n`;
    appendFileSync(path, line, { mode: 0o600 });
    return { path, bytesWritten: Buffer.byteLength(line, 'utf8') };
  } catch {
    return null;
  }
}

/** genuine 사용자 상호작용 레이어 — 사람이 직접 한 행위. ambient/device_state/system(비-사용자
 *  자동 신호)은 "사용자 깨어있음" 판정에서 제외(야간 무음 오발 방지). */
const ACTIVITY_LAYERS = new Set(['utterance', 'gesture', 'selection', 'navigation']);

/** ★ 최신 genuine 사용자 활동 시각(대표 2026-07-14) — 야간 무음 우회 판정용. 오늘+어제(UTC 경계)
 *  jsonl 을 뒤에서 스캔해 사용자 발원 레이어의 최신 ts(ISO)를 반환. 없으면 null. fail-soft.
 *  nowIso 주입(테스트)·layers 오버라이드 가능. */
export function latestUserIntentTs(nowIso: string, opts: { layers?: Set<string> } = {}): string | null {
  const layers = opts.layers ?? ACTIVITY_LAYERS;
  let prevIso: string;
  try { prevIso = new Date(Date.parse(nowIso) - 86_400_000).toISOString(); } catch { prevIso = nowIso; }
  for (const stamp of [utcDateStamp(nowIso), utcDateStamp(prevIso)]) {
    try {
      const p = join(rootDir(), `${stamp}.jsonl`);
      if (!existsSync(p)) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]?.trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as { ts?: string; intent?: { layer?: string } };
          if (evt?.ts && (!evt.intent?.layer || layers.has(evt.intent.layer))) return evt.ts;
        } catch { /* skip malformed line */ }
      }
    } catch { /* try next stamp */ }
  }
  return null;
}
