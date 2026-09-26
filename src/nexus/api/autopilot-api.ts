// ── Autopilot PWA read/preview API (2026-07-09 · Phase B1) ────────────────
//
// PWA Autopilot 섹션(triage·repo-watch·자율행동 로그)이 소비하는 read/preview 엔드포인트.
// dashboard.ts 패턴(CORS·jsonResponse·read-only SQLite) 상속. 라이브 fetch 없음.
//
//   POST /v1/autopilot/triage-preview  — 골 → 실행모델 분류(휴리스틱·결정론·무LLM)
//   GET  /v1/autopilot/repo-watch      — repo watching 상태(hermes/openclaw/codex)
//   GET  /v1/autopilot/autonomy        — 자율행동 로그(surface_events domain=elanous)
//   GET  /v1/autopilot/arming          — 자율 경계 게이트 상태(booleans·READ-ONLY)
//
// 전부 read/preview — 실제 자율집행(merge/재부팅)은 없음(P2/P3 게이트·disarmed).

import { existsSync } from 'node:fs';
import { triageGoal } from '../../autopilot/triage.js';
import { openRepoWatchDb, WATCHED_REPOS, repoWatchDbPath } from '../../autopilot/repo-watch.js';
import { loadAutopilotArming } from '../../autopilot/arming.js';
import { openSurfaceEventsDb, queryEvents, surfaceEventsDbPath } from '../../domains/surface-events.js';
import { AUTONOMY_DOMAIN, AUTONOMY_KIND } from '../../domains/autonomy-log.js';
import { openAutopilotMissionsDb, createMissionWithSlug, normalizeMissionSource, type MissionSource } from '../../autopilot/mission-registry.js';
import { dispatchAutopilotMissions } from '../../autopilot/mission-tool.js';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '600',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/** /v1/autopilot/:section → 지원 섹션 이름(GET). 미지원 null. */
export function parseAutopilotPath(pathname: string): string | null {
  const m = /^\/v1\/autopilot\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const seg = decodeURIComponent(m[1]!);
  return ['repo-watch', 'autonomy', 'arming', 'missions', 'trace'].includes(seg) ? seg : null;
}

/** POST /v1/autopilot/triage-preview — 골 → 실행모델 분류(휴리스틱 baseline·무LLM·즉답).
 *  commit:true 면 미션 레지스트리에 미션 생성(계보의 뿌리·AL2 B) → missionId 반환. */
export async function handleTriagePreview(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  let body: { goal?: unknown; category?: unknown; commit?: unknown; source?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json({ error: 'invalid JSON body' }, 400); }
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!goal) return json({ error: 'goal 필수' }, 400);
  const triage = await triageGoal({ goal, ...(typeof body.category === 'string' ? { category: body.category } : {}) });
  // 커밋 시 미션 생성 — 골이 오토파일럿에 실제 진입하는 순간(계보 뿌리 발급).
  let missionId: string | undefined;
  if (body.commit === true) {
    try {
      // 레거시 'intake' 포함 → normalizeMissionSource 가 'human-intent' 로 흡수. 미지정=human-intent.
      const src: MissionSource = body.source ? normalizeMissionSource(String(body.source)) : 'human-intent';
      const mdb = openAutopilotMissionsDb();
      try {
        // slug 보강 창구 경유 — 영문 kebab id(한글 휴리스틱 id 유출 구멍 봉합·2026-07-14).
        const m = await createMissionWithSlug(mdb, {
          goal, source: src,
          triage: { executionModel: triage.executionModel, domain: triage.domain, tier: triage.tier, engine: triage.engine,
            rationale: triage.rationale, confidence: triage.confidence },
        });
        missionId = m.id;
      } finally { mdb.close(); }
    } catch { /* fail-soft — 프리뷰는 성공 반환 */ }
  }
  return json({ ok: true, triage, ...(missionId ? { missionId } : {}) });
}

/** POST /v1/autopilot/mission-action — 미션 구체화(materialize)·승인(arm). HITL 쓰기. */
export async function handleMissionAction(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  let body: { id?: unknown; action?: unknown; command?: unknown; cron?: unknown; prompt?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json({ error: 'invalid JSON body' }, 400); }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!id) return json({ error: 'id 필수' }, 400);
  if (!['materialize', 'arm', 'cancel', 'approve'].includes(action)) return json({ error: 'action=materialize|arm|cancel|approve' }, 400);
  const args: Record<string, unknown> = { action, id };
  for (const k of ['command', 'cron', 'prompt'] as const) if (typeof body[k] === 'string') args[k] = body[k];
  return json(await dispatchAutopilotMissions(args) as object);
}

/** GET /v1/autopilot/missions?status=&source= — 오토파일럿 미션 목록+헬스 롤업(AL4). */
export async function handleMissionsGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const args: Record<string, unknown> = { action: 'list' };
  const status = url.searchParams.get('status'); if (status) args.status = status;
  const source = url.searchParams.get('source'); if (source) args.source = source;
  return json({ ok: true, ...(await dispatchAutopilotMissions(args) as object) });
}

/** GET /v1/autopilot/trace?id=apm_... — 미션 계보 트리(fan-in·각 파생물 live 상태·AL4). */
export async function handleTraceGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ ok: false, error: 'id(apm_...) 쿼리 필수' }, 400);
  return json({ ok: true, ...(await dispatchAutopilotMissions({ action: 'trace', id }) as object) });
}

/** GET /v1/autopilot/repo-watch — 감시 repo 상태(마지막 SHA·최근 새커밋 수). */
export function handleRepoWatchGet(): Response {
  if (!existsSync(repoWatchDbPath())) {
    return json({ ok: true, repos: WATCHED_REPOS.map(r => ({ ...r, lastSha: null, lastSeen: null, lastNew: 0 })), armed: true });
  }
  const db = openRepoWatchDb();
  try {
    const rows = db.prepare(`SELECT repo, last_sha, last_seen, last_new FROM repo_state`).all() as
      Array<{ repo: string; last_sha: string | null; last_seen: string | null; last_new: number }>;
    const byRepo = new Map(rows.map(r => [r.repo, r]));
    const repos = WATCHED_REPOS.map(r => {
      const st = byRepo.get(r.repo);
      return { key: r.key, repo: r.repo, note: r.note, lastSha: st?.last_sha ?? null, lastSeen: st?.last_seen ?? null, lastNew: st?.last_new ?? 0 };
    });
    return json({ ok: true, repos });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally { db.close(); }
}

/** GET /v1/autopilot/autonomy?limit=&loop= — 자율행동 로그(domain=elanous·kind=autonomy). */
export function handleAutonomyGet(req: Request): Response {
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '50') || 50));
  const loop = url.searchParams.get('loop');
  if (!existsSync(surfaceEventsDbPath())) return json({ ok: true, actions: [] });
  const db = openSurfaceEventsDb();
  try {
    const rows = queryEvents(db, { domain: AUTONOMY_DOMAIN, kind: AUTONOMY_KIND, limit });
    const actions = rows
      .filter(r => !loop || (r.tags ?? '').split(',').includes(`loop:${loop}`))
      .map(r => ({
        ts: r.ts,
        loop: (r.surface ?? '').replace(/^loop:/, ''),
        summary: r.summary ?? r.text.slice(0, 120),
        text: r.text,
        importance: r.importance ?? 5,
        tags: r.tags,
      }));
    return json({ ok: true, actions });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally { db.close(); }
}

/** GET /v1/autopilot/arming — 자율 경계 게이트 상태(booleans·민감정보 없음). */
export function handleArmingGet(): Response {
  const a = loadAutopilotArming();
  return json({
    ok: true,
    arming: {
      absorb: a.absorb.armed, absorbBackend: a.absorb.backend,
      merge: a.merge.armed, reboot: a.reboot.armed,
      materialize: a.materialize.armed,
    },
    note: '재부팅은 arming 무관하게 항상 대표 HITL. 기본 전부 disarmed(fail-closed).',
  });
}

/** GET 디스패치 — parseAutopilotPath 로 매칭된 섹션 라우팅. */
export async function handleAutopilotGet(req: Request, seg: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  switch (seg) {
    case 'repo-watch': return handleRepoWatchGet();
    case 'autonomy': return handleAutonomyGet(req);
    case 'arming': return handleArmingGet();
    case 'missions': return handleMissionsGet(req);
    case 'trace': return handleTraceGet(req);
    default: return json({ error: 'unknown section' }, 404);
  }
}
