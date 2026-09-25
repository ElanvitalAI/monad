// ── WidgetHost × MSS M1.2 narrow tests ──
//
// Verifies that WidgetHost.spawn() stamps a fresh WidgetUri on every
// instance and that the layout-host slug `id` is preserved unchanged.

import { describe, expect, test } from 'bun:test';

import { WidgetHost } from '../src/widgets/host.ts';
import type { Widget } from '../src/widgets/types.ts';
import { asWidgetUri } from '../src/mss/uri/builder.ts';

interface NoopState { ticks: number }

const noopWidget: Widget<NoopState> = {
  type: 'mss-m1_2-noop',
  description: 'mss m1.2 narrow test widget',
  initialState: (): NoopState => ({ ticks: 0 }),
  render: () => [],
};

const noopHooks = {
  log: () => { /* no-op */ },
  requestRender: () => { /* no-op */ },
};

describe('WidgetHost × MSS M1.2 WidgetUri narrow', () => {
  test('spawn() stamps a valid WidgetUri on the instance', () => {
    const host = new WidgetHost(noopHooks);
    host.register(noopWidget, 'builtin', 'test');
    const inst = host.spawn({ type: 'mss-m1_2-noop', id: 'noop-1' });
    expect(inst.id).toBe('noop-1');
    expect(inst.widgetUri).toBeDefined();
    expect(() => asWidgetUri(inst.widgetUri!)).not.toThrow();
    expect(inst.widgetUri).toMatch(/^widget\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive spawns mint distinct WidgetUris', () => {
    const host = new WidgetHost(noopHooks);
    host.register(noopWidget, 'builtin', 'test');
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const inst = host.spawn({ type: 'mss-m1_2-noop', id: `noop-${i}` });
      seen.add(inst.widgetUri! as string);
    }
    expect(seen.size).toBe(8);
  });

  test('respawning the same slug after dispose mints a fresh WidgetUri', () => {
    const host = new WidgetHost(noopHooks);
    host.register(noopWidget, 'builtin', 'test');
    const first = host.spawn({ type: 'mss-m1_2-noop', id: 'reuse' });
    const firstUri = first.widgetUri!;
    host.dispose('reuse');
    const second = host.spawn({ type: 'mss-m1_2-noop', id: 'reuse' });
    expect(second.widgetUri).not.toBe(firstUri);
  });
});
