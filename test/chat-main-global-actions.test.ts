import { describe, expect, test } from 'bun:test';

import { createChatMainGlobalActionRunner } from '../src/dashboard/input/chat-main-global-actions.js';

describe('createChatMainGlobalActionRunner', () => {
  test('routes every action kind through the corresponding dashboard effect', async () => {
    const calls: string[] = [];
    const run = createChatMainGlobalActionRunner({
      resizeLog: (delta, reset) => { calls.push(`resize:${delta}:${reset ? 'reset' : 'keep'}`); },
      focusLog: () => { calls.push('goto'); },
      toggleLogZoom: () => { calls.push('zoom'); },
      copyLastBlock: () => { calls.push('copy-last'); },
      spawnTerminalModal: () => { calls.push('spawn-terminal'); },
      copyLogPane: () => { calls.push('copy-log'); },
      rotateProviderNext: () => { calls.push('rotate-provider'); },
    });

    await run({ kind: 'resize-log', delta: 3 });
    await run({ kind: 'goto-log' });
    await run({ kind: 'toggle-log-zoom' });
    await run({ kind: 'copy-last-block' });
    await run({ kind: 'spawn-terminal-modal' });
    await run({ kind: 'copy-log-pane' });
    await run({ kind: 'provider-rotate-next' });

    expect(calls).toEqual([
      'resize:3:keep',
      'goto',
      'zoom',
      'copy-last',
      'spawn-terminal',
      'copy-log',
      'rotate-provider',
    ]);
  });
});
