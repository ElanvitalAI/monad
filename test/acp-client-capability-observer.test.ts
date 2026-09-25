import { describe, expect, test } from 'bun:test';
import { AcpAgent } from '../src/acp/client.js';

function recordNegotiation(
  agent: AcpAgent,
  agentCapabilities: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean };
    sessionCapabilities?: { fork?: object; list?: object; resume?: object };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
  } | undefined,
): void {
  (agent as unknown as {
    recordCapabilities: (capabilities: typeof agentCapabilities, protocolVersion: number) => void;
  }).recordCapabilities(agentCapabilities, 1);
}

describe('AcpAgent capability observer', () => {
  test('does not notify before initialize negotiation completes', () => {
    const observed: unknown[] = [];
    new AcpAgent({
      backendId: 'codex',
      cwd: process.cwd(),
      onCapabilities: (capabilities) => observed.push(capabilities),
    });
    expect(observed).toEqual([]);
  });

  test('notifies after normalized negotiation with an immutable isolated snapshot', () => {
    const observed: unknown[] = [];
    const agent = new AcpAgent({
      backendId: 'codex',
      cwd: process.cwd(),
      onCapabilities: (capabilities) => observed.push(capabilities),
    });

    recordNegotiation(agent, {
      promptCapabilities: { image: true, audio: false },
      loadSession: false,
      sessionCapabilities: { fork: {}, list: {}, resume: {} },
      mcpCapabilities: { http: true, sse: true },
    });

    expect(observed).toHaveLength(1);
    const snapshot = observed[0] as ReturnType<AcpAgent['getCapabilities']>;
    expect(snapshot).toMatchObject({
      protocolVersion: 1,
      prompt: { image: true, audio: false },
      loadSession: false,
      session: { fork: true, list: true, resume: true },
      mcp: { http: true, sse: true },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot!.prompt)).toBe(true);
    expect(Object.isFrozen(snapshot!.session)).toBe(true);
    expect(Object.isFrozen(snapshot!.mcp)).toBe(true);
    expect(() => { (snapshot!.prompt as { image: boolean }).image = false; }).toThrow();
    expect(agent.getCapabilities()).toMatchObject({ prompt: { image: true, audio: false }, loadSession: false });
    expect(agent.getCapabilities()).not.toBe(snapshot);
  });

  test('an observer failure does not prevent the normalized capability state', () => {
    const agent = new AcpAgent({
      backendId: 'codex',
      cwd: process.cwd(),
      onCapabilities: () => { throw new Error('observer unavailable'); },
      log: () => {},
    });

    recordNegotiation(agent, undefined);

    expect(agent.getCapabilities()).toMatchObject({
      protocolVersion: 1,
      prompt: { image: false, audio: false },
      loadSession: false,
    });
  });
});
