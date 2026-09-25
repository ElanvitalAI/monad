// Test helper — poll until a Unix socket is bound by a server.
//
// Pulled out of 4 daemon-flow test files (M1+M2 cleanup C5) so the
// timeout / poll cadence stays consistent. 3 seconds is generous
// for parallel test load (`bun test` runs files concurrently); under
// that the server-side bind happens within ~50ms.

import { isUnixSocketAlive } from '../../src/tui-client/acp-transport-unix-client.js';

/** Poll `path` until a server is listening, up to `maxMs`. Throws if
 *  the socket never comes up. The default 3s upper bound is large
 *  enough to absorb concurrent-test-suite jitter without slowing the
 *  happy path (returns as soon as alive). */
export async function waitForSocket(path: string, maxMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isUnixSocketAlive(path)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`socket ${path} not bound after ${maxMs}ms`);
}
