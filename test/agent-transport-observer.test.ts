// H5 Phase 2 · TransportObserver tests.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  TransportObserver,
  attachObserver,
} from '../src/agent/transport-observer.js';
import {
  ChannelRouter,
  registerDefaultPatterns,
} from '../src/agent/channel-router.js';
import { emitPtyEvent, resetForTesting } from '../src/pty-shell/registry.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';

afterEach(() => {
  resetForTesting();
});

describe('TransportObserver', () => {
  test('ingest classifies + accumulates per-channel', () => {
    const router = new ChannelRouter();
    registerDefaultPatterns(router);
    const obs = new TransportObserver('pty-x', { router, adapterId: 'test' });
    obs.ingest('Reasoning: step 1\n');
    obs.ingest('Tool: running ls\n');
    obs.ingest('hello user\n');
    const snap = obs.snapshotChannels();
    expect(snap.reasoning).toContain('Reasoning: step 1');
    expect(snap['tool-call']).toContain('Tool: running ls');
    expect(snap.message).toContain('hello user');
    obs.dispose();
  });

  test('subscribes to pty-shell event bus for its ptyId only', () => {
    const router = new ChannelRouter();
    registerDefaultPatterns(router);
    const obs = new TransportObserver('pty-target', { router, adapterId: 'test' });
    emitPtyEvent({ type: 'output', id: 'pty-other', chunk: 'Reasoning: skip' });
    emitPtyEvent({ type: 'output', id: 'pty-target', chunk: 'Tool: match' });
    const snap = obs.snapshotChannels();
    expect(snap.reasoning).toBeUndefined();
    expect(snap['tool-call']).toContain('Tool: match');
    obs.dispose();
  });

  test('rolling buffer cap per channel', () => {
    const router = new ChannelRouter();
    registerDefaultPatterns(router);
    const obs = new TransportObserver('pty-cap', {
      router,
      adapterId: 'test',
      maxBytesPerChannel: 10,
    });
    obs.ingest('Tool: aaaaa');   // 11B → classified as tool-call
    obs.ingest('Tool: bbbbb');   // another 11B · total 22B → truncated
    const snap = obs.snapshotChannels();
    expect(snap['tool-call']!.length).toBeLessThanOrEqual(10);
    // Tail preserved (newest)
    expect(snap['tool-call']!.endsWith('bbbbb')).toBe(true);
    obs.dispose();
  });

  test('activeChannels lists keys currently buffered', () => {
    const router = new ChannelRouter();
    registerDefaultPatterns(router);
    const obs = new TransportObserver('pty-z', { router, adapterId: 'test' });
    obs.ingest('Reasoning: x');
    obs.ingest('hello');
    const channels = obs.activeChannels();
    expect(channels).toContain('reasoning');
    expect(channels).toContain('message');
    obs.dispose();
  });

  test('dispose unsubscribes + clears buffers', () => {
    const router = new ChannelRouter();
    registerDefaultPatterns(router);
    const obs = new TransportObserver('pty-d', { router, adapterId: 'test' });
    obs.ingest('Tool: before dispose');
    expect(obs.snapshotChannels()['tool-call']).toBeDefined();
    obs.dispose();
    // After dispose, further pty events are ignored
    emitPtyEvent({ type: 'output', id: 'pty-d', chunk: 'Reasoning: after' });
    expect(obs.snapshotChannels()).toEqual({});
  });
});

describe('attachObserver', () => {
  test('attaches to first PTY transport · throws without one', () => {
    const router = new ChannelRouter();
    registerDefaultPatterns(router);
    const session: EmbodiedAgentSession = {
      id: 'sess-1',
      launchSpec: { brand: 'codex' },
      transports: [
        { kind: 'pty', id: 'pty-attach-1', label: 'x' },
      ],
      state: () => ({ status: 'running' }),
      async send() {},
      async interrupt() {},
      async snapshot() { return ''; },
      async dispose() {},
    };
    const { observer, dispose } = attachObserver(session, { router, adapterId: 'test' });
    emitPtyEvent({ type: 'output', id: 'pty-attach-1', chunk: 'Tool: exec' });
    expect(observer.snapshotChannels()['tool-call']).toContain('Tool: exec');
    dispose();
  });

  test('throws when session has no PTY transport', () => {
    const router = new ChannelRouter();
    const session: EmbodiedAgentSession = {
      id: 'sess-noop',
      launchSpec: { brand: 'noop' },
      transports: [],
      state: () => ({ status: 'running' }),
      async send() {},
      async interrupt() {},
      async snapshot() { return ''; },
      async dispose() {},
    };
    expect(() => attachObserver(session, { router, adapterId: 'test' })).toThrow(/no PTY transport/);
  });
});
