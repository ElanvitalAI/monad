import { describe, expect, test } from 'bun:test';
import { createTransientOverlayHost } from '../src/display/transient-overlay-host.js';

describe('transient-overlay-host', () => {
  test('paints mounted overlays in order', () => {
    const host = createTransientOverlayHost();
    host.mount({ id: 'b', order: 20, paint: () => 'B' });
    host.mount({ id: 'a', order: 10, paint: () => 'A' });
    host.mount({ id: 'c', order: 20, paint: () => 'C' });

    expect(host.listIds()).toEqual(['a', 'b', 'c']);
    expect(host.prepareFrame()).toBe('');
    expect(host.paint()).toBe('ABC');
  });

  test('update and dispose rewire authority in place', () => {
    const host = createTransientOverlayHost();
    const handle = host.mount({ id: 'drag-session', prepareFrame: () => 'old-pre', paint: () => 'old' });

    expect(host.prepareFrame()).toBe('old-pre');
    expect(host.paint()).toBe('old');

    handle.update({ order: 5, prepareFrame: () => 'new-pre', paint: () => 'new' });
    expect(host.listIds()).toEqual(['drag-session']);
    expect(host.prepareFrame()).toBe('new-pre');
    expect(host.paint()).toBe('new');

    handle.dispose();
    expect(host.prepareFrame()).toBe('');
    expect(host.paint()).toBe('');
  });

  test('isolates overlay painter throws', () => {
    const host = createTransientOverlayHost();
    host.mount({ id: 'pre-bad', order: 0, prepareFrame: () => { throw new Error('boom'); }, paint: () => '' });
    host.mount({ id: 'bad', order: 0, paint: () => { throw new Error('boom'); } });
    host.mount({ id: 'good', order: 1, paint: () => 'ok' });

    expect(host.prepareFrame()).toBe('');
    expect(host.paint()).toBe('ok');
  });
});
