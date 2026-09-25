// GET /v1/bots/commands — catalog over the wire.
//
// Handler tests prove the JSON is `botCommandCatalog()` unchanged.
// The wiring suite boots the real NEXUS HTTP server: `routeRequest` is
// not exported, so a direct handler import cannot prove the route line
// exists (same reason as `test/design-check-route-wiring.test.ts`).

import { afterEach, describe, expect, it, mock, spyOn, test } from 'bun:test';
import * as commandSurface from '../src/bots/command-surface.js';
import { botCommandCatalog } from '../src/bots/command-surface.js';
import { handleBotCommands } from '../src/nexus/api/bot-commands.js';
import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';

const PATH = '/v1/bots/commands';

function serverFixture() {
  const state = createNexusState({ nexusVersion: 'test', phase: 'test' });
  const eventBus = new NexusEventBus();
  state.bus = eventBus;
  return { state, eventBus, registry: new TabRegistry(state) };
}

describe('handleBotCommands — wire shape', () => {
  it('returns 200 JSON deeply equal to botCommandCatalog()', async () => {
    const resp = handleBotCommands();
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('application/json');
    const body = await resp.json();
    expect(body).toEqual(botCommandCatalog());
  });

  it('exposes only name/description/arguments and never invents hasHandler', async () => {
    const body = (await handleBotCommands().json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect(Object.keys(entry).sort()).toEqual(['arguments', 'description', 'name']);
      expect(entry).not.toHaveProperty('hasHandler');
      expect(typeof entry.name).toBe('string');
      expect((entry.name as string).length).toBeGreaterThan(0);
      for (const argument of entry.arguments as Array<Record<string, unknown>>) {
        expect(Object.keys(argument).sort()).toEqual(['description', 'name', 'required']);
      }
    }
  });

  it('repeat requests return identical bodies (no side effects)', async () => {
    const first = await handleBotCommands().text();
    const second = await handleBotCommands().text();
    expect(second).toBe(first);
  });
});

afterEach(() => mock.restore());

describe('GET /v1/bots/commands — wiring', () => {
  test('the route answers over real HTTP with command names, matches the catalog, and leaves /v1/worktrees intact', async () => {
    const dispatchSpy = spyOn(commandSurface, 'dispatchBotCommand').mockImplementation(() => {
      throw new Error('dispatchBotCommand must not run for GET /v1/bots/commands');
    });
    const handlerSpies = commandSurface.botCommandDeclarations.map((command) =>
      spyOn(command, 'handler').mockImplementation(() => {
        throw new Error(`${command.name} handler must not run for GET /v1/bots/commands`);
      }),
    );

    const assertArmedThrow = async (run: () => unknown, needle: string) => {
      try {
        await run();
      } catch (error) {
        expect((error as Error).message).toContain(needle);
        return;
      }
      throw new Error(`expected throw containing ${needle}`);
    };

    const server = startNexusHttpServer({
      ...serverFixture(),
      metaApi: { noAuth: true },
      startPort: 58000 + Math.floor(Math.random() * 1000),
    });
    try {
      await assertArmedThrow(
        () => commandSurface.dispatchBotCommand(
          commandSurface.botCommandDeclarations[0]!,
          [],
          { surface: 'discord', hasOpts: false },
        ),
        'dispatchBotCommand must not run for GET /v1/bots/commands',
      );
      await assertArmedThrow(
        () => commandSurface.botCommandDeclarations[0]!.handler([]),
        'handler must not run for GET /v1/bots/commands',
      );
      dispatchSpy.mockClear();
      for (const spy of handlerSpies) spy.mockClear();

      const response = await fetch(`${server.url}${PATH}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const body = await response.json();
      expect(body).toEqual(botCommandCatalog());
      expect(Array.isArray(body)).toBe(true);
      expect((body as Array<{ name: string }>)[0]!.name.length).toBeGreaterThan(0);

      const again = await fetch(`${server.url}${PATH}`);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(body);

      expect(dispatchSpy).toHaveBeenCalledTimes(0);
      for (const spy of handlerSpies) expect(spy).toHaveBeenCalledTimes(0);

      const neighbor = await fetch(`${server.url}/v1/worktrees`);
      expect(neighbor.status).toBe(200);
      const neighborBody = (await neighbor.json()) as Record<string, unknown>;
      expect(neighborBody).toHaveProperty('worktrees');
      expect(Array.isArray(neighborBody.worktrees)).toBe(true);
    } finally {
      server.stop();
    }
  });
});
