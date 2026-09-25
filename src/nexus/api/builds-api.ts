// ── SE 격리 빌드 관측 API (대표 2026-07-13·PLAN B4) ──────────────────────────
//
//   GET /v1/builds               → 빌드 목록(?all=1 종결 포함)
//   GET /v1/builds/<buildId>      → 스냅샷(record + logTail + worktree diffStat)
//   GET /v1/builds/<buildId>/stream → SSE 스트림(backlog + per-build 로그 append 라이브)
//
// 원격/PWA 에서 SE 빌드 안을 실시간으로 본다(adb logcat 스타일). autopilot-api(json·CORS)
// + events(SSE) 패턴 상속. READ-ONLY. PLAN: 내부 문서 `PLAN-se-build-observability-stream-2026-07-13`

import { readFileSync, existsSync, statSync } from 'node:fs';
import { buildSnapshot, dispatchSeBuild } from '../../domains/se-build-tool.js';
import { getBuild, openSeBuildsDb, buildLogPath } from '../../autopilot/se-build-registry.js';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS } });
}

/** /v1/builds[/<id>[/stream]] 매칭 → { kind, buildId }. 아니면 null(다른 핸들러 소관). */
export function parseBuildsPath(pathname: string): { kind: 'list' | 'snapshot' | 'stream'; buildId?: string } | null {
  if (pathname === '/v1/builds') return { kind: 'list' };
  const m = /^\/v1\/builds\/([\w.-]+)(\/stream)?$/.exec(pathname);
  if (!m) return null;
  return { kind: m[2] ? 'stream' : 'snapshot', buildId: m[1]! };
}

const SSE_HEARTBEAT_MS = 15_000;
const SSE_POLL_MS = 1_000;

/** GET /v1/builds* 핸들러. list/snapshot=json, stream=SSE. 매칭 안 되면 undefined. */
export async function handleBuildsGet(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url);
  const route = parseBuildsPath(url.pathname);
  if (!route) return undefined;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  if (route.kind === 'list') {
    const r = await dispatchSeBuild({ action: 'list', all: url.searchParams.get('all') === '1' });
    return json(r);
  }
  if (route.kind === 'snapshot') {
    const tail = Number(url.searchParams.get('tail') ?? '40');
    const snap = buildSnapshot(route.buildId!, { tail: Number.isFinite(tail) ? tail : 40 });
    return snap ? json(snap) : json({ error: `빌드 없음: ${route.buildId}` }, 404);
  }
  // stream (SSE) — backlog + per-build 로그 append 라이브 push.
  return buildStreamResponse(route.buildId!);
}

function buildStreamResponse(buildId: string): Response {
  // 로그 경로·최종 상태는 레지스트리에서(fail-soft 폴백=규칙 경로).
  let logPath = buildLogPath(buildId);
  try { const db = openSeBuildsDb(); const b = getBuild(db, buildId); db.close(); if (b?.logPath) logPath = b.logPath; } catch { /* */ }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (chunk: string): void => { try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ } };
      let offset = 0;
      // backlog — 연결 시 기존 로그 전체(라인 단위 event: line).
      try {
        if (existsSync(logPath)) {
          const buf = readFileSync(logPath);
          for (const line of buf.toString('utf-8').split('\n')) if (line) send(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
          offset = buf.length;
        }
      } catch { /* */ }
      let lastStatus = '';
      const poll = setInterval(() => {
        try {
          if (existsSync(logPath)) {
            const size = statSync(logPath).size;
            if (size < offset) offset = 0; // 회전 감지
            if (size > offset) {
              const buf = readFileSync(logPath);
              for (const line of buf.subarray(offset).toString('utf-8').split('\n')) if (line) send(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
              offset = buf.length;
            }
          }
          // 상태 전이 push(종결 시 event: status + 스트림 종료).
          const db = openSeBuildsDb(); const b = getBuild(db, buildId); db.close();
          if (b && b.status !== lastStatus) { lastStatus = b.status; send(`event: status\ndata: ${JSON.stringify({ status: b.status, prUrl: b.prUrl })}\n\n`); }
          if (b && b.status !== 'running') { send(`event: end\ndata: ${JSON.stringify({ status: b.status })}\n\n`); clearInterval(poll); clearInterval(hb); try { controller.close(); } catch { /* */ } }
        } catch { /* fail-soft */ }
      }, SSE_POLL_MS);
      const hb = setInterval(() => send(`: ping\n\n`), SSE_HEARTBEAT_MS);
      (controller as unknown as { _cleanup?: () => void })._cleanup = () => { clearInterval(poll); clearInterval(hb); };
    },
    cancel() { /* 클라 disconnect — interval 은 controller closed 로 send no-op·GC. */ },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', ...CORS_HEADERS },
  });
}
