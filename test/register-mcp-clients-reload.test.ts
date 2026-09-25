import { describe, expect, test } from 'bun:test';
import { registerMcpClients } from '../src/nexus/boot/register-mcp-clients.js';
import type { registerToolRuntime, unregisterToolRuntime } from '../src/tool-runtime/registry.js';


// ── 재장전이 성립하는가 (2026-09-10 · ④ 관문이 실물에서 잡은 결함) ──
//
// 📏 실측: 새 데몬에 `monad mcp reload` 를 쳤더니 서버 5개가 «전부»
//    `ToolRuntime id collision: <server>.<tool>` 로 실패했다. 재장전은 서버에
//    닿았고 툴 목록도 받았는데, 옛 등록이 레지스트리에 남아 새 등록을 막았다.
//    `shutdown()` 은 «클라이언트»만 내리고 «등록»은 안 걷었다 — 이름과 어긋난 계약.
describe('재장전 — shutdown 이 등록을 되돌린다', () => {
  const okClient = (tools: { name: string; description?: string }[]) => ({
    start: async () => {},
    listTools: async () => tools,
    callTool: async () => ({ content: [] }),
    dispose: async () => {},
  });

  test('shutdown 뒤 같은 서버를 다시 등록해도 id 충돌이 없다', async () => {
    const live = new Map<string, unknown>();
    const register = ((rt: { id: string }) => {
      if (live.has(rt.id)) throw new Error(`ToolRuntime id collision: ${rt.id}`);
      live.set(rt.id, rt);
    }) as unknown as typeof registerToolRuntime;
    const unregister = ((id: string) => { live.delete(id); return undefined; }) as unknown as typeof unregisterToolRuntime;
    const servers = [{ id: 'krea', transport: 'http' as const, url: 'https://api.krea.ai/mcp', enabled: true }];
    const opts = {
      servers,
      registerRuntime: register,
      unregisterRuntime: unregister,
      createClient: () => okClient([{ name: 'list_files' }, { name: 'get_job' }]),
      logger: { info: () => {}, warn: () => {} },
    };
    const first = await registerMcpClients(opts);
    expect(first.registered).toBe(2);
    expect(live.size).toBe(2);
    await first.shutdown();
    // ⭐ 이 줄이 요점 — 걷지 않으면 여기가 2 로 남고 아래 재등록이 던진다.
    expect(live.size).toBe(0);
    const second = await registerMcpClients(opts);
    expect(second.perServer.krea?.status).toBe('ready');
    expect(second.registered).toBe(2);
  });

  test('서버가 등록 도중 실패하면 그 서버 몫의 부분 등록도 같이 걷힌다', async () => {
    const live = new Map<string, unknown>();
    let calls = 0;
    const register = ((rt: { id: string }) => {
      calls += 1;
      if (calls === 2) throw new Error('boom on the second tool');
      live.set(rt.id, rt);
    }) as unknown as typeof registerToolRuntime;
    const unregister = ((id: string) => { live.delete(id); return undefined; }) as unknown as typeof unregisterToolRuntime;
    const handle = await registerMcpClients({
      servers: [{ id: 'krea', transport: 'http' as const, url: 'https://api.krea.ai/mcp', enabled: true }],
      registerRuntime: register,
      unregisterRuntime: unregister,
      createClient: () => okClient([{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
      logger: { info: () => {}, warn: () => {} },
    });
    expect(handle.perServer.krea?.status).toBe('failed');
    // 첫 툴은 등록에 성공했었다 — 그것이 남으면 다음 재장전이 그 하나로 죽는다.
    expect(live.size).toBe(0);
  });

  test('내가 안 넣은 동명 런타임은 «안» 걷는다', async () => {
    const live = new Map<string, unknown>([['other.tool', {}]]);
    const register = ((rt: { id: string }) => { live.set(rt.id, rt); }) as unknown as typeof registerToolRuntime;
    const unregister = ((id: string) => { live.delete(id); return undefined; }) as unknown as typeof unregisterToolRuntime;
    const handle = await registerMcpClients({
      servers: [{ id: 'krea', transport: 'http' as const, url: 'https://api.krea.ai/mcp', enabled: true }],
      registerRuntime: register,
      unregisterRuntime: unregister,
      createClient: () => okClient([{ name: 'list_files' }]),
      logger: { info: () => {}, warn: () => {} },
    });
    expect(handle.registered).toBe(1);
    await handle.shutdown();
    expect(live.has('other.tool')).toBe(true);
    expect(live.size).toBe(1);
  });
});
