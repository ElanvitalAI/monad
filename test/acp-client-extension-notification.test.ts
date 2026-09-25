import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { AcpAgent } from '../src/acp/client.js';
import { debug } from '../src/debug/log.js';

type DebugEvent = { category: string; event: string; data: Record<string, unknown> | undefined };
type ExtensionClient = {
  extNotification?: (method: string, params: Record<string, unknown>) => Promise<void>;
  extMethod?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

let logSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => logSpy?.mockRestore());

function clientForTest(): ExtensionClient {
  const agent = new AcpAgent({ backendId: 'claude', cwd: process.cwd(), log: () => {} });
  return (agent as unknown as { buildClient(): ExtensionClient }).buildClient();
}

describe('AcpAgent vendor extension notifications', () => {
  test('accepts a vendor notification and records only backend, method, and params byte size', async () => {
    const events: DebugEvent[] = [];
    logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      events.push({ category, event, data: data as Record<string, unknown> | undefined });
    });
    const params = { mcpServers: [], prompt: 'must-not-appear-in-observation' };
    const client = clientForTest();

    await expect(client.extNotification?.('_x.ai/mcp/servers_updated', params)).resolves.toBeUndefined();

    const notification = events.find(({ category, event }) => category === 'acp.client' && event === 'ext-notification');
    expect(notification?.data).toEqual({
      backendId: 'claude',
      method: '_x.ai/mcp/servers_updated',
      paramsBytes: Buffer.byteLength(JSON.stringify(params), 'utf8'),
    });
    expect(JSON.stringify(notification)).not.toContain(params.prompt);
  });

  test('does not implement extMethod, preserving the SDK method-not-found path for extension requests', () => {
    expect(clientForTest().extMethod).toBeUndefined();
  });
});
