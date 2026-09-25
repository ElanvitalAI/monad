// H6 P4 · Live agent-room registry.
//
// Tracks the set of currently-running rooms so the slash handler and
// LLM tools (`/agent-room list` · `AgentRoomList` · `AgentRoomClose`)
// can look up + dispose without re-walking the window registry.
//
// Design rails (PLAN §D5, §D11):
//   - D5  Dispose is cascade + best-effort. Every member session's
//         dispose() runs in parallel; we swallow individual failures
//         so a single broken adapter doesn't strand the others.
//   - D11 Room ids are session-scoped monotonic (`room-1`, `room-2`,
//         ...). Bundle 2 layers named presets on top (`/agent-room
//         spawn my-plan-exec`).
//
// The registry itself owns no agent or VW handles; it's a thin Map
// that the room-builder writes to and the slash/tool layer reads.

import { debug } from '../debug/log.js';
import type {
  AgentRoomInstance,
  AgentRoomMemberInstance,
  AgentRoomPresetName,
} from './types.js';

/** Serializable snapshot of a room — used by `AgentRoomList` tool
 *  output and `/agent-room list` rendering. Stripped of the live
 *  `dispose` handle because this crosses the LLM tool boundary. */
export interface AgentRoomSnapshot {
  readonly id: string;
  readonly windowId: number;
  readonly preset: AgentRoomPresetName;
  readonly members: readonly AgentRoomMemberInstance[];
  readonly createdAt: number;
}

export type AgentRoomRegistryEvent =
  | { type: 'register'; room: AgentRoomSnapshot }
  | { type: 'dispose'; roomId: string }
  | { type: 'window-closed'; roomId: string; windowId: number };

export class AgentRoomRegistry {
  private rooms = new Map<string, AgentRoomInstance>();
  private seq = 0;
  private listeners = new Set<(event: AgentRoomRegistryEvent) => void>();

  /** Allocate the next room id. Internal — room-builder owns lifetime. */
  nextId(): string {
    this.seq += 1;
    return `room-${this.seq}`;
  }

  register(room: AgentRoomInstance): void {
    if (this.rooms.has(room.id)) {
      throw new Error(`agent-room registry: duplicate id ${room.id}`);
    }
    this.rooms.set(room.id, room);
    this.emit({
      type: 'register',
      room: {
        id: room.id,
        windowId: room.windowId,
        preset: room.preset,
        members: room.members,
        createdAt: room.createdAt,
      },
    });
    if (debug.enabled) {
      debug.log('agent-room.registry.register', room.id, {
        windowId: room.windowId,
        preset: room.preset,
        members: room.members.length,
      });
    }
  }

  get(id: string): AgentRoomInstance | undefined {
    return this.rooms.get(id);
  }

  list(): readonly AgentRoomSnapshot[] {
    const out: AgentRoomSnapshot[] = [];
    for (const room of this.rooms.values()) {
      out.push({
        id: room.id,
        windowId: room.windowId,
        preset: room.preset,
        members: room.members,
        createdAt: room.createdAt,
      });
    }
    return out;
  }

  findByWindowId(windowId: number): AgentRoomInstance | undefined {
    for (const room of this.rooms.values()) {
      if (room.windowId === windowId) return room;
    }
    return undefined;
  }

  /** Dispose + unregister. Idempotent: second call returns
   *  `{ closed: false, disposedSessions: 0 }` without error. */
  async dispose(id: string): Promise<{ closed: boolean; disposedSessions: number }> {
    const room = this.rooms.get(id);
    if (!room) return { closed: false, disposedSessions: 0 };
    this.rooms.delete(id);
    this.emit({ type: 'dispose', roomId: id });
    const before = room.members.length;
    try {
      await room.dispose();
    } catch (err) {
      if (debug.enabled) {
        debug.log('agent-room.registry.dispose-error', id, {
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
    return { closed: true, disposedSessions: before };
  }

  /** Dispose a room by its host VW id. Used by the dashboard's
   *  `window:close` bridge so closing the VW directly still tears
   *  down member sessions exactly once. Safe to race with the normal
   *  `dispose(roomId)` path because `dispose()` deletes the room
   *  before awaiting the async teardown. */
  async disposeByWindowId(
    windowId: number,
  ): Promise<{ closed: boolean; disposedSessions: number; roomId?: string }> {
    const room = this.findByWindowId(windowId);
    if (!room) return { closed: false, disposedSessions: 0 };
    const result = await this.dispose(room.id);
    return result.closed
      ? { ...result, roomId: room.id }
      : result;
  }

  /** Hook fired by the VW registry when a window closes out from
   *  under us (test/helper path). Removes only the registry entry.
   *  The production dashboard bridge should prefer `disposeByWindowId`
   *  so member sessions are torn down as well. */
  onWindowClosed(windowId: number): void {
    const room = this.findByWindowId(windowId);
    if (!room) return;
    this.rooms.delete(room.id);
    this.emit({ type: 'window-closed', roomId: room.id, windowId });
    if (debug.enabled) {
      debug.log('agent-room.registry.window-closed', room.id, {
        windowId,
        memberCount: room.members.length,
      });
    }
  }

  /** Test reset — clears all rooms without running dispose. */
  _resetForTesting(): void {
    this.rooms.clear();
    this.seq = 0;
    this.listeners.clear();
  }

  subscribe(listener: (event: AgentRoomRegistryEvent) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private emit(event: AgentRoomRegistryEvent): void {
    if (this.listeners.size === 0) return;
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* observer isolation */ }
    }
  }
}

let _defaultRegistry: AgentRoomRegistry | null = null;

export function getDefaultAgentRoomRegistry(): AgentRoomRegistry {
  if (!_defaultRegistry) _defaultRegistry = new AgentRoomRegistry();
  return _defaultRegistry;
}

export function _resetDefaultAgentRoomRegistryForTesting(): void {
  if (_defaultRegistry) _defaultRegistry._resetForTesting();
  _defaultRegistry = null;
}
