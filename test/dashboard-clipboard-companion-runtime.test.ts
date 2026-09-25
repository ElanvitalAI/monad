import { describe, expect, test } from 'bun:test';

import { createDashboardClipboardCompanionRuntime } from '../src/dashboard/clipboard-companion-runtime.js';

describe('createDashboardClipboardCompanionRuntime', () => {
  test('opens companion after reset and poke', async () => {
    const calls: string[] = [];
    const runtime = createDashboardClipboardCompanionRuntime({
      resetCursor: () => { calls.push('reset'); },
      pokeNow: async () => { calls.push('poke'); },
      setOpen: (open) => { calls.push(`open:${open}`); },
      writeClipboardText: async () => true,
      pushCopiedLine: () => { calls.push('copied'); },
      pushCopyFailedLine: () => { calls.push('failed'); },
    });

    await runtime.open();
    expect(calls).toEqual(['reset', 'poke', 'open:true']);
    calls.length = 0;
    runtime.close();
    expect(calls).toEqual(['open:false']);
  });

  test('copies clipboard entries and refreshes on success', async () => {
    const calls: string[] = [];
    const runtime = createDashboardClipboardCompanionRuntime({
      resetCursor: () => { calls.push('reset'); },
      pokeNow: async () => { calls.push('poke'); },
      setOpen: () => { calls.push('open'); },
      writeClipboardText: async (text) => {
        calls.push(`write:${text}`);
        return text === 'ok';
      },
      pushCopiedLine: (n) => { calls.push(`copied:${n}`); },
      pushCopyFailedLine: () => { calls.push('failed'); },
    });

    await runtime.copyEntryAt([{ text: 'ok', ts: 1 }], 0);
    expect(calls).toEqual(['write:ok', 'copied:2', 'poke']);

    calls.length = 0;
    await runtime.copyEntryAt([{ text: 'bad', ts: 1 }], 0);
    expect(calls).toEqual(['write:bad', 'failed']);
  });
});
