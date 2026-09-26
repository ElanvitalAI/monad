// ── GET /v1/design-check is actually REACHABLE ──
//
// ⛔ Why this file is separate from `src/nexus/api/design-check.test.ts`:
//    that file asks "does the handler compute the right body?", which an
//    in-process import can answer. It CANNOT answer "is this handler on the
//    request path?" — `routeRequest` is not exported, so a unit test can only
//    ever call the handler directly and pass whether or not the route line
//    exists. CLAUDE.md states the rule outright: a wiring change is verified
//    through the entrance, not through an import.
//
// So this boots the real NEXUS HTTP server on a scratch port and fetches the
// URL, the same way `test/mcp-widget-call-route.test.ts` proves its route.
// Delete the `if (pathname === '/v1/design-check')` line and this goes red;
// the sibling unit tests would stay green.

import { describe, expect, test } from 'bun:test';
import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';

const PATH = '/v1/design-check';

function serverFixture() {
  const state = createNexusState({ nexusVersion: 'test', phase: 'test' });
  const eventBus = new NexusEventBus();
  state.bus = eventBus;
  return { state, eventBus, registry: new TabRegistry(state) };
}

describe('GET /v1/design-check — wiring', () => {
  test('the route answers over real HTTP with the verdict wire shape', async () => {
    const server = startNexusHttpServer({
      ...serverFixture(),
      metaApi: { noAuth: true },
      startPort: 57000 + Math.floor(Math.random() * 1000),
    });
    try {
      const response = await fetch(`${server.url}${PATH}`);

      // 200 even when the verdict is "blocked" — a blocked verdict is a
      // RESULT the panel renders, not a transport failure. A 404 here means
      // the route line is missing; a 500 means the handler threw.
      expect(response.status).toBe(200);

      const body = await response.json() as Record<string, unknown>;
      // Shape, not values: this suite runs both inside the elanous checkout
      // (where a verdict resolves) and potentially outside it, so asserting
      // a specific rulebook list would pin the environment rather than the
      // wiring. What must hold either way is that the discriminant arrived.
      expect(body).toHaveProperty('ok');
      expect(typeof body.ok).toBe('boolean');
      expect(body).toHaveProperty('exitCode');
      expect([0, 1]).toContain(body.exitCode as number);

      if (body.ok === true) {
        expect(Array.isArray(body.declaredRulebooks)).toBe(true);
        expect(Array.isArray(body.unavailableRulebooks)).toBe(true);
        expect(Array.isArray(body.availableRulebooks)).toBe(true);
      } else {
        // ⭐ The reason must survive the wire. If `blockedOn` were dropped in
        // serialization the panel would be back to "an empty list", which is
        // the exact failure this endpoint exists to prevent.
        expect(['no-repository', 'craft-directory', 'design-document'])
          .toContain(body.blockedOn as string);
      }
    } finally {
      server.stop();
    }
  });
});
