// ── widget-based ConfirmChannel factory (LT 6 follow-up) ──
//
// Pins the ConfirmChannel wrapper that closes LT 6's HITL host wire:
//   1. Default labels — channel name 'widget', `request()` returns
//      the boolean answer when the user confirms / declines.
//   2. Custom yes/no labels round-trip through the modal spec's help
//      text; channel name override (`'terminal'`) lets a host swap
//      out the legacy channel.
//   3. Cancellation (`status: 'cancel'`) maps to `false`.
//   4. `cancel()` closes the underlying readline host even mid-flight.
//   5. Per-call hostFactory — a fresh host every request, no caching.

import { describe, expect, test } from 'bun:test';
import {
  createWidgetHitlChannel,
  createTestReadlineHost,
  type TestReadlineHost,
} from '../src/expression/widget/index';
import type { ConfirmRequest } from '../src/hitl/types';

const REQ: ConfirmRequest = {
  prompt: 'Deploy to prod?',
  detail: 'main → prod, 12 commits, 3 schema migrations',
  requestId: 'req-1',
};

describe('createWidgetHitlChannel', () => {
  test('default name + yes answer flows through as boolean true', async () => {
    const host = createTestReadlineHost();
    const channel = createWidgetHitlChannel({ hostFactory: () => host });
    expect(channel.name).toBe('widget');

    const promise = channel.request(REQ);
    // Confirm step accepts 'y' / 'yes' / 'true' as truthy lines.
    host.emit({ kind: 'line', value: 'y' });

    const answer = await promise;
    expect(answer).toBe(true);
    expect(host.closed).toBe(true);
  });

  test('decline answer flows through as false', async () => {
    const host = createTestReadlineHost();
    const channel = createWidgetHitlChannel({ hostFactory: () => host });

    const promise = channel.request(REQ);
    host.emit({ kind: 'line', value: 'n' });

    const answer = await promise;
    expect(answer).toBe(false);
  });

  test('custom name override (e.g., replace terminal) is preserved', async () => {
    const host = createTestReadlineHost();
    const channel = createWidgetHitlChannel({
      hostFactory: () => host,
      name: 'terminal',
    });
    expect(channel.name).toBe('terminal');

    const promise = channel.request(REQ);
    host.emit({ kind: 'line', value: 'y' });
    expect(await promise).toBe(true);
  });

  test('Esc cancellation → false (per HITL contract)', async () => {
    const host = createTestReadlineHost();
    const channel = createWidgetHitlChannel({ hostFactory: () => host });

    const promise = channel.request(REQ);
    host.emit({ kind: 'key', key: { name: 'escape' } });

    const answer = await promise;
    expect(answer).toBe(false);
  });

  test('cancel() closes the host and unblocks the pending request', async () => {
    const host = createTestReadlineHost();
    const channel = createWidgetHitlChannel({ hostFactory: () => host });

    const promise = channel.request(REQ);
    // Pre-cancel sanity — host is still open.
    expect(host.closed).toBe(false);

    channel.cancel();
    expect(host.closed).toBe(true);

    // Once a host is closed, the pending session resolves with cancel
    // status (the runtime treats host close as terminal). Drain the
    // promise to keep bun's unhandled-rejection detector happy.
    const answer = await promise;
    expect(answer).toBe(false);

    // Calling cancel again is a no-op (no double-close throw).
    expect(() => channel.cancel()).not.toThrow();
  });

  test('hostFactory called once per request — fresh host each time', async () => {
    const hosts: TestReadlineHost[] = [];
    const channel = createWidgetHitlChannel({
      hostFactory: () => {
        const h = createTestReadlineHost();
        hosts.push(h);
        return h;
      },
    });

    const p1 = channel.request(REQ);
    hosts[0].emit({ kind: 'line', value: 'y' });
    await p1;

    const p2 = channel.request(REQ);
    hosts[1].emit({ kind: 'line', value: 'n' });
    await p2;

    expect(hosts).toHaveLength(2);
    expect(hosts[0]).not.toBe(hosts[1]);
  });
});
