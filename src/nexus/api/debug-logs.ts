// ── NEXUS · debug log batch endpoint (PR D-2 · 2026-05-15) ──
//
// iOS DebugLogForwarder 의 50 ms coalesce flush 대상. iOS-side `DebugLogger.
// event(category, level, metadata)` 호출의 LogRecord 가 NEXUS 으로 forward
// → server-side daily JSONL append.
//
// 2026-05-16 discoverability update — 사용자가 즉시 찾을 수 있도록:
//   1. platform 별 split: `~/.elanous/debug-tap/<platform>-<YYYY-MM-DD>.jsonl`
//      (iOS · PWA · daemon · etc. — source.platform 기준 자동 라우팅)
//   2. local timezone 기준 파일명 (UTC 였던 이전 — KST 새벽 헷갈림 해소)
//   3. `latest-<platform>.jsonl` symlink — 매 write 마다 ensure ·
//      `tail -f ~/.elanous/debug-tap/latest-ios.jsonl` 으로 라이브 추적
//
// 기존 파일 (`<date>.jsonl` 형식) 은 그대로 보존 — 새 record 만 신규 path.
//
// Endpoint:
//   POST /v1/debug-logs/batch
//   Body: { records: LogRecord[] }
//   Resp: { ok, accepted, rejected, files }
//
// Auth: opts.checkAuth 통한 bearer gate (loopback 만 default · 외부 noun
// share 시 보강).
//
// PLAN: 내부 문서 `PLAN-ios-debug-logging-kgs-substrate-2026-05-14` §3.4 ·
//       MANUAL: 내부 문서 `MANUAL-debug-principles-2026-04-30`

import { appendFileSync, existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'fs';
import { elanousStateRoot } from '../../autopilot/state-paths.js';
import { join } from 'path';

import type { LogRecord } from '../../mss/logging/record.js';
import { redactLogRecord } from '../../mss/logging/redaction.js';
import { getDefaultLogStore } from '../../mss/logging/log-store.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function badRequest(reason: string): Response {
  return jsonResponse({ error: 'bad_request', reason }, 400);
}

function isLogRecordLike(v: unknown): v is LogRecord {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  // 최소 필수: ts · category · event (record.ts:67-69 fromJsonl 정합).
  return typeof o.ts === 'string'
    && typeof o.category === 'string'
    && typeof o.event === 'string';
}

export interface DebugLogsRouteOpts {
  /** Optional auth gate. */
  checkAuth?: (req: Request) => boolean;
}

/** 로컬 timezone 기준 YYYY-MM-DD. 사용자 mental model 과 일치 (KST 새벽
 *  UTC 어제 file 헷갈림 해소). daemon 이 사용자 Mac 의 system TZ 사용. */
function dateInLocalTz(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** record.source.platform 에서 platform id 추출 · sanitize. nil 또는
 *  invalid chars 시 'unknown'. */
function platformOf(record: LogRecord): string {
  const raw = (record as { source?: { platform?: unknown } }).source?.platform;
  if (typeof raw !== 'string' || raw.length === 0) return 'unknown';
  // Filename-safe: lowercase alphanum + hyphen/underscore only.
  const sanitized = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return sanitized.length > 0 ? sanitized : 'unknown';
}

/** `~/.elanous/debug-tap/<platform>-<YYYY-MM-DD>.jsonl`. dir 보장. */
function pathFor(platform: string): string {
  const dir = join(elanousStateRoot(), 'debug-tap');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `${platform}-${dateInLocalTz()}.jsonl`);
}

/** `latest-<platform>.jsonl` symlink 매 write 후 ensure. atomic relink
 *  (unlink + symlink) · 실패는 swallow (symlink 는 nice-to-have · write
 *  은 이미 성공). 같은 day 첫 write 시 생성 · date 회전 시 자동 다시 link. */
function ensureLatestSymlink(targetPath: string, platform: string): void {
  const dir = join(elanousStateRoot(), 'debug-tap');
  const latest = join(dir, `latest-${platform}.jsonl`);
  try {
    if (existsSync(latest) || isBrokenSymlink(latest)) {
      unlinkSync(latest);
    }
    // Relative symlink — `~/.elanous/debug-tap/` 가 옮겨도 broken 안 됨.
    const targetBase = targetPath.startsWith(dir + '/') ? targetPath.slice(dir.length + 1) : targetPath;
    symlinkSync(targetBase, latest);
  } catch {
    /* nice-to-have · write 은 이미 성공 */
  }
}

function isBrokenSymlink(p: string): boolean {
  try {
    const stat = lstatSync(p);
    if (!stat.isSymbolicLink()) return false;
    // existsSync 가 broken symlink 면 false → 별도 check 로 unlink 가능
    return !existsSync(p);
  } catch {
    return false;
  }
}

export interface DebugLogIngestResult {
  accepted: number;
  rejected: number;
  files: string[];
}

/** ⛔⭐⭐⭐ **적재의 «단일 길»** — HTTP 도 ACP 도 여기로 온다(19차 `[F]`).
 *
 *  📏 왜 뽑았나: 2026-08-22 실측으로 ***HTTP 가 통째로 굶는 상태***가 있다는 것이 확인됐다
 *  (SSE 가 커넥션 한도를 먹으면 `POST /v1/debug-logs/batch` 가 영영 큐에 선다).
 *  🔑 그때 살아 있는 채널은 **WebSocket** 이었다 — 채팅은 계속 돌았다.
 *  ⇒ 그래서 ACP 로도 같은 것을 받을 수 있어야 하고, ⛔ **적재 로직이 갈리면 안 된다**
 *    (한쪽만 redaction 을 타거나 한쪽만 logs.db 에 안 들어가는 일이 생긴다). */
export function ingestDebugLogRecords(records: unknown[]): DebugLogIngestResult {
  // platform 별 group — 한 batch 에 여러 platform 섞일 수 있어 file split.
  // 일반적으로 한 batch = 한 surface (iOS 만 / PWA 만) 이지만 정확성 우선.
  const linesByPlatform = new Map<string, string[]>();
  let accepted = 0;
  let rejected = 0;
  for (const candidate of records) {
    if (!isLogRecordLike(candidate)) {
      rejected += 1;
      continue;
    }
    const platform = platformOf(candidate);
    const bucket = linesByPlatform.get(platform) ?? [];
    bucket.push(JSON.stringify(candidate));
    linesByPlatform.set(platform, bucket);
    accepted += 1;
  }

  const files: string[] = [];
  for (const [platform, lines] of linesByPlatform) {
    if (lines.length === 0) continue;
    const path = pathFor(platform);
    appendFileSync(path, lines.join('\n') + '\n');
    ensureLatestSymlink(path, platform);
    files.push(path);
  }

  // 통합 로그 패브릭 LF0 (2026-07-13) — 클라이언트 로그를 크로스서피스 조회
  // 스토어(logs.db)에도 합류. surface = source.platform. 클라이언트 payload 는
  // 신뢰하지 않으므로 서버측 리댁션 통과 후 적재. fail-soft — JSONL 원본이
  // 이미 착지했으므로 스토어 실패가 응답을 바꾸지 않는다.
  try {
    const store = getDefaultLogStore();
    if (store) {
      const rows: Array<{ rec: LogRecord; surface: string }> = [];
      for (const candidate of records) {
        if (!isLogRecordLike(candidate)) continue;
        rows.push({ rec: redactLogRecord(candidate), surface: platformOf(candidate) });
      }
      store.insertBatch(rows);
    }
  } catch { /* fail-soft */ }

  return { accepted, rejected, files };
}

export async function handleDebugLogsBatch(
  req: Request,
  opts: DebugLogsRouteOpts = {},
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return badRequest('invalid JSON body'); }
  const obj = body as { records?: unknown } | null;
  if (!obj || !Array.isArray(obj.records)) {
    return badRequest('body.records: LogRecord[] required');
  }
  const { accepted, rejected, files } = ingestDebugLogRecords(obj.records);
  return jsonResponse({ ok: true, accepted, rejected, files }, 200);
}
