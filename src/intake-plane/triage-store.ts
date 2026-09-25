// In-memory TriageRoom store — cascade-zyu W3 Z1.
// Persistent SQLite store comes in W3 Y1 (#TBD). Until then the daemon
// keeps rooms in process memory; rooms vaporize on restart by design
// (low-confidence intake is short-lived anyway).

import type { TriageRoom } from './triage-room.js';

export interface TriageRoomQuery {
  intakeId?: string;
  status?: TriageRoom['status'];
}

export class TriageRoomStore {
  private byId = new Map<string, TriageRoom>();
  private byIntake = new Map<string, Set<string>>();

  upsert(room: TriageRoom): void {
    const prior = this.byId.get(room.id);
    this.byId.set(room.id, room);
    if (!prior) {
      let set = this.byIntake.get(room.intakeId);
      if (!set) {
        set = new Set();
        this.byIntake.set(room.intakeId, set);
      }
      set.add(room.id);
    }
  }

  get(id: string): TriageRoom | null {
    return this.byId.get(id) ?? null;
  }

  list(query: TriageRoomQuery = {}): readonly TriageRoom[] {
    let rooms: TriageRoom[];
    if (query.intakeId) {
      const ids = this.byIntake.get(query.intakeId) ?? new Set();
      rooms = Array.from(ids, (id) => this.byId.get(id)).filter((r): r is TriageRoom => !!r);
    } else {
      rooms = Array.from(this.byId.values());
    }
    if (query.status) rooms = rooms.filter((r) => r.status === query.status);
    return rooms;
  }

  delete(id: string): boolean {
    const room = this.byId.get(id);
    if (!room) return false;
    this.byId.delete(id);
    this.byIntake.get(room.intakeId)?.delete(id);
    return true;
  }

  size(): number {
    return this.byId.size;
  }

  clear(): void {
    this.byId.clear();
    this.byIntake.clear();
  }
}

let singleton: TriageRoomStore | null = null;

export function getTriageRoomStore(): TriageRoomStore {
  if (!singleton) singleton = new TriageRoomStore();
  return singleton;
}

export function _resetTriageRoomStore(): TriageRoomStore {
  singleton = new TriageRoomStore();
  return singleton;
}
