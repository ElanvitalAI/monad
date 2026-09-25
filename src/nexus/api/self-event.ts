// ── Self-awareness inject — POST /v1/self-event (P2, 2026-07-08) ──────────
//
// 외부 도구(Claude Code·Codex 세션·스킬·git hook)가 monad 데몬에 "무엇을 구현/
// 변경했나(+문서)"를 주입하는 진입점. CLI `monad self log` 의 HTTP 대응 —
// 데몬 미기동 로컬은 CLI, 크로스디바이스/스킬/훅은 이 엔드포인트. Bearer(acp-token)
// 인증(loopback 동일오리진은 무인증·checkAuth 규칙). injectSelfMemory 재사용.
//
// Body: { summary: string, tool?, kind?, text?, docPath?, importance?, refs? }
//   summary 필수. docPath 있으면 문서 벡터 인제스트(fail-soft). domain='monad' 고정.

import { checkAuth, type MetaApiOpts } from './meta-api.js';
import { injectSelfMemory, type SelfEventInput } from '../../domains/self-awareness.js';

interface SelfEventBody {
  summary?: string;
  tool?: string;
  kind?: string;
  text?: string;
  docPath?: string;
  importance?: number;
  refs?: Record<string, unknown>;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** POST /v1/self-event — 외부 구현/변경 이벤트를 monad 자기인지 기억에 주입. */
export async function handleSelfEvent(req: Request, metaApi: MetaApiOpts): Promise<Response> {
  if (!checkAuth(req, metaApi)) return json({ error: 'unauthorized' }, 401);

  let body: SelfEventBody;
  try { body = (await req.json()) as SelfEventBody; }
  catch { return json({ error: 'invalid-json' }, 400); }

  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!summary) return json({ error: 'missing-summary' }, 400);

  const input: SelfEventInput = {
    tool: typeof body.tool === 'string' && body.tool ? body.tool : 'external',
    summary,
    ...(typeof body.kind === 'string' && body.kind ? { kind: body.kind } : {}),
    ...(typeof body.text === 'string' && body.text ? { text: body.text } : {}),
    ...(typeof body.docPath === 'string' && body.docPath ? { docPath: body.docPath } : {}),
    ...(typeof body.importance === 'number' ? { importance: body.importance } : {}),
    ...(body.refs && typeof body.refs === 'object' ? { refs: body.refs } : {}),
  };
  try {
    const r = await injectSelfMemory(input);
    return json({ ok: true, eventId: r.eventId, docChunks: r.docChunks, docSkipped: r.docSkipped }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
