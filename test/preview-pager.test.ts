// ── Track J: preview pager tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  openPager, getActivePager, _resetPagerForTesting,
  type PreviewPagerDeps,
} from '../src/preview/pager';
import type { ShowPreviewModalReturn, ShowPreviewModalOpts } from '../src/dashboard/modals/preview';

type FakeHandle = {
  dispose: () => void;
  disposed: boolean;
  bounds: { row: number; col: number; width: number; height: number };
  id: string;
};

function fakeHandle(id: string): FakeHandle {
  return {
    id,
    disposed: false,
    bounds: { row: 0, col: 0, width: 0, height: 0 },
    dispose() { this.disposed = true; },
  };
}

function makeDeps(
  onShow: (opts: ShowPreviewModalOpts) => ShowPreviewModalReturn | null,
): PreviewPagerDeps & { calls: ShowPreviewModalOpts[]; disposals: FakeHandle[] } {
  const calls: ShowPreviewModalOpts[] = [];
  const disposals: FakeHandle[] = [];
  return {
    coordinator: {} as PreviewPagerDeps['coordinator'],
    termSize: () => ({ cols: 80, rows: 24 }),
    calls,
    disposals,
    async showFn(_path, opts) {
      calls.push(opts);
      const result = onShow(opts);
      if (result) disposals.push(result.handle as unknown as FakeHandle);
      return result;
    },
  };
}

function okShow(opts: ShowPreviewModalOpts): ShowPreviewModalReturn {
  return {
    handle: fakeHandle(`h-${opts.skip ?? 0}`) as unknown as ShowPreviewModalReturn['handle'],
    result: { kind: 'lines', lines: ['stub'] },
  };
}

describe('preview pager', () => {
  beforeEach(() => _resetPagerForTesting());
  afterEach(() => _resetPagerForTesting());

  test('openPager renders first page with skip=0', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    expect(pager).not.toBeNull();
    expect(deps.calls[0]?.skip).toBe(0);
    expect(getActivePager()).toBe(pager);
  });

  test('returns null + clears singleton when first render fails', async () => {
    const deps = makeDeps(() => null);
    const pager = await openPager('/tmp/a.pdf', deps);
    expect(pager).toBeNull();
    expect(getActivePager()).toBeNull();
  });

  test('next() increments skip and re-renders', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    await pager!.next();
    await pager!.next();
    expect(deps.calls.map(c => c.skip)).toEqual([0, 1, 2]);
  });

  test('prev() clamps at 0 without re-render', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    await pager!.prev();
    expect(pager!.skip).toBe(0);
    expect(deps.calls.length).toBe(1);
    await pager!.next();
    await pager!.prev();
    expect(pager!.skip).toBe(0);
  });

  test('close() disposes last modal + drops singleton', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    await pager!.next();
    pager!.close();
    expect(pager!.alive).toBe(false);
    expect(getActivePager()).toBeNull();
    expect(deps.disposals.at(-1)?.disposed).toBe(true);
  });

  test('handleKey: j / space / pagedown → next', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    expect(await pager!.handleKey('j')).toBe(true);
    expect(await pager!.handleKey('space')).toBe(true);
    expect(await pager!.handleKey('pagedown')).toBe(true);
    expect(pager!.skip).toBe(3);
  });

  test('handleKey: k / pageup → prev', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    await pager!.next();
    expect(await pager!.handleKey('k')).toBe(true);
    expect(pager!.skip).toBe(0);
  });

  test('handleKey: q / esc → close', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    expect(await pager!.handleKey('q')).toBe(true);
    expect(pager!.alive).toBe(false);
  });

  test('opening a second pager closes the first', async () => {
    const deps1 = makeDeps(okShow);
    const a = await openPager('/tmp/a.pdf', deps1);
    const deps2 = makeDeps(okShow);
    const b = await openPager('/tmp/b.pdf', deps2);
    expect(a?.alive).toBe(false);
    expect(b?.alive).toBe(true);
    expect(getActivePager()).toBe(b);
  });

  test('handleKey: unrecognized → false (passthrough)', async () => {
    const deps = makeDeps(okShow);
    const pager = await openPager('/tmp/a.pdf', deps);
    expect(await pager!.handleKey('x')).toBe(false);
    expect(await pager!.handleKey('enter')).toBe(false);
  });

  test('onPageChange hook fires with status line', async () => {
    const deps = makeDeps(okShow);
    const labels: string[] = [];
    deps.onPageChange = (l) => labels.push(l);
    const pager = await openPager('/tmp/a.pdf', deps);
    await pager!.next();
    expect(labels.length).toBe(2);
    expect(labels[0]).toContain('preview: /tmp/a.pdf');
    expect(labels[1]).toContain('skip=1');
  });

  test('ttlMs forwarded as 0 (persistent)', async () => {
    const deps = makeDeps(okShow);
    await openPager('/tmp/a.pdf', deps);
    expect(deps.calls[0]?.ttlMs).toBe(0);
  });
});
