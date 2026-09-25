import { describe, expect, test } from 'bun:test';
import { tryHandleAdminMcpReload, ADMIN_MCP_RELOAD_PATH, type McpReloadOutcome } from './admin-mcp-reload.js';

const post = (path = ADMIN_MCP_RELOAD_PATH) =>
  new Request(`http://127.0.0.1:31415${path}`, { method: 'POST', body: '{}' });

describe('admin mcp-reload route', () => {
  test('다른 경로는 undefined 를 내어 라우팅을 계속시킨다', async () => {
    const req = post('/v1/nexus/admin/pwa-dev-proxy');
    const res = await tryHandleAdminMcpReload(req, new URL(req.url), { reload: async () => ({ reloaded: true, registered: 0, perServer: {} }) });
    expect(res).toBeUndefined();
  });

  test('POST 가 아니면 405', async () => {
    const req = new Request(`http://127.0.0.1:31415${ADMIN_MCP_RELOAD_PATH}`, { method: 'GET' });
    const res = await tryHandleAdminMcpReload(req, new URL(req.url), {});
    expect(res?.status).toBe(405);
  });

  // ⭐ 이 시험이 이 파일의 요점이다 — 「기능이 없다」와 「이 데몬이 배선 없이 떴다」를
  //    다른 값으로 내는지. 초판처럼 200 에 빈 표를 내면 호출자가 성공으로 읽는다.
  test('reload 미배선이면 200 이 아니라 503 + 이름 있는 사유', async () => {
    const req = post();
    const res = await tryHandleAdminMcpReload(req, new URL(req.url), {});
    expect(res?.status).toBe(503);
    expect(await res!.json()).toMatchObject({ error: 'mcp-reload-not-wired' });
  });

  test('성공하면 서버별 표를 그대로 낸다', async () => {
    const outcome: McpReloadOutcome = {
      reloaded: true,
      registered: 34,
      perServer: {
        krea: { status: 'ready', toolCount: 34 },
        higgsfield: { status: 'failed', toolCount: 0, reason: 'handshake timeout' },
      },
    };
    const req = post();
    const res = await tryHandleAdminMcpReload(req, new URL(req.url), { reload: async () => outcome });
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual(outcome as unknown as Record<string, unknown>);
  });

  test('reload 가 던지면 500 으로 접고 메시지를 남긴다', async () => {
    const req = post();
    const res = await tryHandleAdminMcpReload(req, new URL(req.url), {
      reload: async () => { throw new Error('registry locked'); },
    });
    expect(res?.status).toBe(500);
    expect(await res!.json()).toMatchObject({ error: 'mcp-reload-failed', message: 'registry locked' });
  });
});
