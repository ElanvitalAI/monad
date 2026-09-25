import { describe, expect, test } from 'bun:test';

import { spawnPane } from '../src/virtual-windows/pane-spawner.js';

describe('spawnPane · deprecated ACP lane', () => {
  test('rejects the removed ACP virtual-window path with its migration target', async () => {
    await expect(
      spawnPane({ lane: 'acp', backendId: 'codex-app-server', cwd: '/tmp/proj' }),
    ).rejects.toThrow(
      "pane-spawner ACP lane is deprecated (backend=codex-app-server). Use the chat panel's backend chip + dashboard/chat/acp-chat.ts wire instead.",
    );
  });
});
