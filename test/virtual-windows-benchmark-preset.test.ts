import { describe, expect, test } from 'bun:test';

import {
  MAX_BENCHMARK_PANES,
  spawnLLMBenchmark,
} from '../src/virtual-windows/benchmark-preset.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { createVWEventBus } from '../src/virtual-windows/event-bus.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

function harness(opts?: { writePane?: (id: string, bytes: string) => void }) {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 160, height: 40 }),
  });
  const writes: Array<[string, string]> = [];
  const writePane = opts?.writePane ?? ((id, b) => writes.push([id, b]));
  const bus = createVWEventBus({ addressBook: book, writePane });
  return { coord, book, reg, bus, writes };
}

describe('spawnLLMBenchmark', () => {
  test('rejects zero providers', () => {
    const h = harness();
    expect(() => spawnLLMBenchmark(
      { prompt: 'hi', providers: [] },
      { registry: h.reg, eventBus: h.bus, addressBook: h.book },
    )).toThrow(/at least one provider/);
  });

  test('rejects too many providers', () => {
    const h = harness();
    expect(() => spawnLLMBenchmark(
      { prompt: 'hi', providers: Array.from({ length: MAX_BENCHMARK_PANES + 1 }, (_, i) => ({ name: `p${i}`, provider: `p${i}` })) },
      { registry: h.reg, eventBus: h.bus, addressBook: h.book },
    )).toThrow(/max 4 providers/);
  });

  test('2 providers → columns layout, 2 panes', () => {
    const h = harness();
    const r = spawnLLMBenchmark(
      { prompt: 'hi', providers: [
        { name: 'grok', provider: 'grok' },
        { name: 'gpt', provider: 'gpt' },
      ] },
      { registry: h.reg, eventBus: h.bus, addressBook: h.book },
    );
    expect(r.paneIds).toHaveLength(2);
    expect(r.window.listPanes()).toHaveLength(2);
  });

  test('4 providers → grid layout, 4 panes', () => {
    const h = harness();
    const r = spawnLLMBenchmark(
      { prompt: 'hi', providers: [
        { name: 'a', provider: 'a' },
        { name: 'b', provider: 'b' },
        { name: 'c', provider: 'c' },
        { name: 'd', provider: 'd' },
      ] },
      { registry: h.reg, eventBus: h.bus, addressBook: h.book },
    );
    expect(r.paneIds).toHaveLength(4);
    expect(r.window.listPanes()).toHaveLength(4);
  });

  test('initial broadcast fans out prompt to every pane', () => {
    const h = harness();
    spawnLLMBenchmark(
      { prompt: 'benchmark-question', providers: [
        { name: 'a', provider: 'a' },
        { name: 'b', provider: 'b' },
      ] },
      { registry: h.reg, eventBus: h.bus, addressBook: h.book },
    );
    expect(h.writes).toHaveLength(2);
    for (const [, bytes] of h.writes) expect(bytes).toBe('benchmark-question');
  });

  test('broadcastPrompt() reusable for follow-up questions', () => {
    const h = harness();
    const r = spawnLLMBenchmark(
      { prompt: 'first', providers: [
        { name: 'a', provider: 'a' },
        { name: 'b', provider: 'b' },
      ] },
      { registry: h.reg, eventBus: h.bus, addressBook: h.book },
    );
    const r2 = r.broadcastPrompt('follow-up');
    expect(r2.sent).toBe(2);
    expect(r2.failed).toBe(0);
    expect(h.writes.some(w => w[1] === 'follow-up')).toBe(true);
  });

  test('explicit layout=rows stacks panes', () => {
    const h = harness();
    const r = spawnLLMBenchmark(
      { prompt: 'hi', layout: 'rows', providers: [
        { name: 'a', provider: 'a' },
        { name: 'b', provider: 'b' },
        { name: 'c', provider: 'c' },
      ] },
      { registry: h.reg, eventBus: h.bus, addressBook: h.book },
    );
    // 3 rows — all same width as window interior.
    const rects = r.window.paneRects().map(p => p.rect);
    const firstWidth = rects[0]!.width;
    for (const rc of rects) expect(rc.width).toBe(firstWidth);
  });
});
