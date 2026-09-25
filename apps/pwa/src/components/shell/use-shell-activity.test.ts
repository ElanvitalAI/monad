import { describe, expect, mock, test } from 'bun:test';
import { startActivityPolling } from './use-shell-activity';
import type { ShellActivitySnapshot } from './activity-snapshot';

describe('startActivityPolling', () => {
  test('loads quiet, then drops a late response after cleanup', async () => {
    const seen: ShellActivitySnapshot[] = [];
    let calls = 0;
    let release: ((response: Response) => void) | undefined;
    const fetchImpl = mock(() => {
      calls += 1;
      return new Promise<Response>((resolve) => { release = resolve; });
    });

    const stop = startActivityPolling(
      (snapshot) => { seen.push(snapshot); },
      { fetchImpl, listProgressFrames: async () => ({ logs: [] }) },
      60_000,
    );

    expect(calls).toBe(1);
    stop();
    release?.(new Response(JSON.stringify({ subjects: [] }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([]);
    expect(calls).toBe(1);
  });

  test('applies a completed fetch before cleanup', async () => {
    const seen: ShellActivitySnapshot[] = [];
    const fetchImpl = mock(async () => new Response(JSON.stringify({ subjects: [] }), { status: 200 }));
    const stop = startActivityPolling(
      (snapshot) => { seen.push(snapshot); },
      { fetchImpl, listProgressFrames: async () => ({ logs: [] }) },
      60_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([{ kind: 'quiet' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    stop();
  });
});
