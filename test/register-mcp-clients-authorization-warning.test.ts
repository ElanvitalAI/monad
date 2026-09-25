import { describe, expect, test } from 'bun:test';

import { registerMcpClients } from '../src/nexus/boot/register-mcp-clients.js';

async function bootWith(authorizedTools?: string[]) {
  const warns: string[] = [];
  const handle = await registerMcpClients({
    servers: [{
      id: 'partial-server',
      transport: 'stdio',
      command: ['fake'],
      ...(authorizedTools ? { authorizedTools } : {}),
    }],
    handshakeTimeoutMs: 0,
    logger: { info: () => {}, warn: (line) => warns.push(line) },
    createClient: () => ({
      start: async () => {},
      listTools: async () => [{ name: 'build' }, { name: 'test' }],
      callTool: async () => ({ content: [] }),
      dispose: async () => {},
    }),
    registerRuntime: () => {},
  });
  await handle.shutdown();
  return warns;
}

describe('registerMcpClients — authorization warnings', () => {
  test('partially authorized server warns with server id, total tools, and authorized count', async () => {
    const warns = await bootWith(['build']);

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(JSON.stringify('partial-server'));
    expect(warns[0]).toContain('2 tool(s)');
    expect(warns[0]).toContain('1 authorized');
    expect(warns[0]).toContain('unlisted tool calls will be denied');
  });

  test('fully authorized server does not emit an authorization warning', async () => {
    expect(await bootWith(['build', 'test'])).toEqual([]);
  });

  test('zero authorized server retains its existing warning', async () => {
    const warns = await bootWith();

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('NONE authorized');
    expect(warns[0]).toContain('every call will be denied');
    expect(warns[0]).toContain('authorizedTools');
  });
});
