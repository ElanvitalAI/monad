// NEXUS · `POST /v1/nexus/admin/mcp-reload` — MCP 클라이언트 «전용» 재장전.
//
// 왜 있나 (대표 2026-09-10: *"그런데 왜 재부팅해야만 리로드 되게끔 구조가 되어
// 있나요? 그게 문제인데요?"*):
//
//   MCP 서버 목록·인가 도구·OAuth 자격증명은 데몬 «기동 시 한 번» 읽힌다
//   (`src/nexus/index.ts` 의 `registerMcpClients({ servers })`). 그래서 config 에
//   서버를 «더해도», `monad mcp login` 으로 자격증명을 «새로 받아도», 이미 뜬
//   데몬은 그것을 영영 모른다 — 실측 2026-09-10: krea 를 config 에 더한 시각이
//   데몬 기동보다 22초 늦었고, 그 데몬의 krea 도구 수는 0 이었다.
//
//   ⛔ 그 상태에서 사람에게 남는 유일한 처방이 «데몬 재부팅»이었다. 재부팅은
//      MCP 와 «아무 상관 없는» 것들을 전부 같이 끊는다(도는 미션·PTY·스케줄러·
//      PWA 업스트림 등록). 즉 이 라우트는 편의가 아니라 ***폭발 반경을 MCP 로
//      좁히는 것***이 목적이다.
//
// 계약:
//   • 루프백 전용 — `/v1/nexus/admin/*` 의 다른 칸과 같은 자세(dev-proxy 와 동일).
//   • `reload` 미배선(=`undefined`)이면 503 `mcp-reload-not-wired`.
//     ⭐ 「기능이 없다」와 「데몬이 이 배선 없이 떴다」를 다른 값으로 낸다.
//   • 재장전은 «전부 아니면 전무»가 아니다 — 서버 하나가 실패해도 나머지는
//     등록된다(`registerMcpClients` 의 boot 정책 그대로). 실패는 `perServer` 에
//     이름과 함께 남으므로 호출자가 「무엇이 안 붙었나」를 읽을 수 있다.
//   • 응답은 «수»가 아니라 «서버별 표»다 — 총 도구 수만 내면 「krea 만 실패」를
//     호출자가 못 가른다.

export interface McpReloadServerResult {
  status: 'ready' | 'disabled' | 'failed';
  toolCount: number;
  // ⛔ 이름은 `McpServerBootResult.reason` 을 «그대로» 쓴다. 초판은 여기에
  //    `error` 라고 적었고 tsc 가 잡았다 — 한 축에 두 어휘를 지으면 통합이
  //    반씩 골라 빨강이 난다(2026-09-10 · 이 저장소의 재발 사고 계급).
  reason?: string;
}

export interface McpReloadOutcome {
  /** 이번 호출이 실제로 클라이언트를 다시 세웠나. `mcp.enabled:false` 면 false. */
  reloaded: boolean;
  /** 재장전 뒤 등록된 총 도구 수. */
  registered: number;
  /** 서버 id → 결과. `registerMcpClients` 의 `perServer` 를 그대로 옮긴다. */
  perServer: Record<string, McpReloadServerResult>;
  /** `reloaded:false` 일 때 왜 안 했나 (`mcp-disabled`). */
  skippedReason?: string;
}

export interface AdminMcpReloadDeps {
  /** 프로덕션 부팅이 넘긴다. 없으면 라우트는 503 으로 fail-closed. */
  reload?: () => Promise<McpReloadOutcome>;
}

export const ADMIN_MCP_RELOAD_PATH = '/v1/nexus/admin/mcp-reload';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** 한 요청을 처리한다. 경로가 안 맞으면 `undefined`(호출자가 라우팅 계속). */
export async function tryHandleAdminMcpReload(
  req: Request,
  url: URL,
  deps: AdminMcpReloadDeps,
): Promise<Response | undefined> {
  if (url.pathname !== ADMIN_MCP_RELOAD_PATH) return undefined;
  const method = req.method.toUpperCase();
  if (method !== 'POST') {
    return jsonResponse({ error: 'method-not-allowed', method }, 405);
  }
  if (!deps.reload) {
    return jsonResponse(
      {
        error: 'mcp-reload-not-wired',
        hint: 'This daemon booted without the MCP reload seam. Restart NEXUS to pick up the wiring.',
      },
      503,
    );
  }
  try {
    const outcome = await deps.reload();
    return jsonResponse(outcome);
  } catch (err: unknown) {
    return jsonResponse(
      { error: 'mcp-reload-failed', message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}
