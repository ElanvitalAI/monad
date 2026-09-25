// H6 P4 · AgentRoomRegistry unit tests.

import { describe, test, expect } from 'bun:test';
import {
  AgentRoomRegistry,
  getDefaultAgentRoomRegistry,
  _resetDefaultAgentRoomRegistryForTesting,
} from '../src/agent-room/registry.js';
import type { AgentRoomInstance } from '../src/agent-room/types.js';

function makeRoom(
  id: string,
  windowId = 1,
  opts: { disposeImpl?: () => Promise<void> } = {},
): AgentRoomInstance {
  return {
    id,
    windowId,
    preset: 'three-split',
    members: [
      { sessionId: 's0', paneId: 'p0', brand: 'codex', launchedAt: 1 },
    ],
    createdAt: 1,
    dispose: opts.disposeImpl ?? (async () => {}),
  };
}

describe('AgentRoomRegistry · register + get', () => {
  test('register + get round-trip', () => {
    const r = new AgentRoomRegistry();
    const room = makeRoom('room-1');
    r.register(room);
    expect(r.get('room-1')?.id).toBe('room-1');
  });

  test('duplicate id throws', () => {
    const r = new AgentRoomRegistry();
    r.register(makeRoom('room-1'));
    expect(() => r.register(makeRoom('room-1'))).toThrow(/duplicate/);
  });

  test('nextId is monotonic', () => {
    const r = new AgentRoomRegistry();
    expect(r.nextId()).toBe('room-1');
    expect(r.nextId()).toBe('room-2');
    expect(r.nextId()).toBe('room-3');
  });

  test('subscribe sees register/dispose/window-closed events', async () => {
    const r = new AgentRoomRegistry();
    const seen: string[] = [];
    const sub = r.subscribe((event) => {
      seen.push(event.type === 'register' ? `${event.type}:${event.room.id}` : `${event.type}:${event.roomId}`);
    });
    r.register(makeRoom('room-1', 7));
    await r.dispose('room-1');
    r.register(makeRoom('room-2', 9));
    r.onWindowClosed(9);
    sub.dispose();
    expect(seen).toEqual([
      'register:room-1',
      'dispose:room-1',
      'register:room-2',
      'window-closed:room-2',
    ]);
  });
});

describe('AgentRoomRegistry · list + find', () => {
  test('list returns serializable snapshots (no dispose handle)', () => {
    const r = new AgentRoomRegistry();
    r.register(makeRoom('room-1'));
    r.register(makeRoom('room-2', 2));
    const snaps = r.list();
    expect(snaps).toHaveLength(2);
    for (const s of snaps) {
      expect('dispose' in s).toBe(false);
    }
  });

  test('findByWindowId returns matching room', () => {
    const r = new AgentRoomRegistry();
    r.register(makeRoom('room-1', 7));
    r.register(makeRoom('room-2', 8));
    expect(r.findByWindowId(7)?.id).toBe('room-1');
    expect(r.findByWindowId(99)).toBeUndefined();
  });
});

describe('AgentRoomRegistry · dispose', () => {
  test('dispose calls room.dispose + unregisters', async () => {
    const r = new AgentRoomRegistry();
    let disposed = 0;
    r.register(
      makeRoom('room-1', 1, {
        disposeImpl: async () => {
          disposed += 1;
        },
      }),
    );
    const result = await r.dispose('room-1');
    expect(result).toEqual({ closed: true, disposedSessions: 1 });
    expect(disposed).toBe(1);
    expect(r.get('room-1')).toBeUndefined();
  });

  test('dispose is idempotent on missing id', async () => {
    const r = new AgentRoomRegistry();
    const result = await r.dispose('room-ghost');
    expect(result).toEqual({ closed: false, disposedSessions: 0 });
  });

  test('disposeByWindowId tears down matching room exactly once', async () => {
    const r = new AgentRoomRegistry();
    let disposed = 0;
    r.register(
      makeRoom('room-1', 7, {
        disposeImpl: async () => {
          disposed += 1;
        },
      }),
    );
    const first = await r.disposeByWindowId(7);
    const second = await r.disposeByWindowId(7);
    expect(first).toEqual({ closed: true, disposedSessions: 1, roomId: 'room-1' });
    expect(second).toEqual({ closed: false, disposedSessions: 0 });
    expect(disposed).toBe(1);
  });

  test('dispose swallows errors from room.dispose · still removes entry', async () => {
    const r = new AgentRoomRegistry();
    r.register(
      makeRoom('room-1', 1, {
        disposeImpl: async () => {
          throw new Error('boom');
        },
      }),
    );
    const result = await r.dispose('room-1');
    expect(result.closed).toBe(true);
    expect(r.get('room-1')).toBeUndefined();
  });
});

describe('default registry singleton', () => {
  test('same instance returned until reset', () => {
    _resetDefaultAgentRoomRegistryForTesting();
    const a = getDefaultAgentRoomRegistry();
    const b = getDefaultAgentRoomRegistry();
    expect(a).toBe(b);
    _resetDefaultAgentRoomRegistryForTesting();
    const c = getDefaultAgentRoomRegistry();
    expect(c).not.toBe(a);
  });
});
