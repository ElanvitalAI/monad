// Intake Triage Room — cascade-zyu W3 Z1.
// Low-confidence IntakeDraft → showroom-style triage session where the
// user (or the Patcher/Thinker in W5+) votes on each item.
// ROADMAP-showroom-x-task-fabric §4 Z1 / scenario S1.

import type { IntakeDraft, IntakeItemDraft } from './types.js';

export type TriageVote =
  | 'approve'        // accept the item as-drafted
  | 'reject'         // discard the item
  | 'clarify'        // route to clarify pass (open question)
  | 'defer'          // keep for later review
  | 'edit';          // user-edited (replacement payload carried separately)

export const TRIAGE_VOTES: readonly TriageVote[] = [
  'approve', 'reject', 'clarify', 'defer', 'edit',
];

export function isTriageVote(v: unknown): v is TriageVote {
  return typeof v === 'string' && (TRIAGE_VOTES as readonly string[]).includes(v);
}

export type TriageVoter =
  | { kind: 'user'; userId?: string }
  | { kind: 'patcher'; modelId?: string }
  | { kind: 'thinker'; modelId?: string }
  | { kind: 'auto-rule'; ruleId: string };

export interface TriageItemDecision {
  itemId: string;
  vote: TriageVote;
  voter: TriageVoter;
  ts: string;
  /** Edited payload when `vote === 'edit'`. */
  edited?: Partial<Pick<IntakeItemDraft, 'text' | 'kind' | 'priorityHint' | 'targetSurface'>>;
  /** Optional rationale (free-form). */
  rationale?: string;
}

export type TriageRoomStatus =
  | 'open'        // accepting votes
  | 'resolved'    // every item has a decision
  | 'archived';   // closed without complete resolution

export const TRIAGE_ROOM_STATUSES: readonly TriageRoomStatus[] = [
  'open', 'resolved', 'archived',
];

export interface TriageRoom {
  schema_version: 1;
  /** `triage:<hex>`. */
  id: string;
  intakeId: string;
  createdAt: string;
  updatedAt: string;
  status: TriageRoomStatus;
  /** Snapshot of the items that needed triage (low confidence /
   *  `needsClarification` / `proposedAction === 'ask-user'`). */
  pendingItems: readonly IntakeItemDraft[];
  decisions: readonly TriageItemDecision[];
  /** Optional anchor to a showroom session when the room renders inside
   *  the PWA Showroom panel (Z0 anchor reuse). */
  showroomSessionId?: string;
  /** Reason the draft was routed to triage (policy id + confidence). */
  trigger: TriageTrigger;
}

export interface TriageTrigger {
  policyId: string;
  /** Draft confidence (0-1). */
  confidence: number;
  /** Number of items that flagged into triage. */
  flaggedItemCount: number;
}

export interface TriageRoomInit {
  intakeId: string;
  pendingItems: readonly IntakeItemDraft[];
  trigger: TriageTrigger;
  showroomSessionId?: string;
  /** Test seam. */
  id?: string;
  /** Test seam. */
  now?: number;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newTriageRoomId(): string {
  return `triage:${randomHex(8)}`;
}

function nowIso(now?: number): string {
  return new Date(now ?? Date.now()).toISOString();
}

export function createTriageRoom(init: TriageRoomInit): TriageRoom {
  if (!init.intakeId) {
    throw new RangeError('TriageRoom.intakeId must be non-empty');
  }
  if (init.pendingItems.length === 0) {
    throw new RangeError('TriageRoom needs at least one pending item');
  }
  const ts = nowIso(init.now);
  return {
    schema_version: 1,
    id: init.id ?? newTriageRoomId(),
    intakeId: init.intakeId,
    createdAt: ts,
    updatedAt: ts,
    status: 'open',
    pendingItems: Object.freeze([...init.pendingItems]),
    decisions: Object.freeze([]),
    showroomSessionId: init.showroomSessionId,
    trigger: { ...init.trigger },
  };
}

/** Record a vote for one item. Throws when the item is unknown or already
 *  has a non-edit vote (use {@link reviseTriageVote} to overwrite). */
export function castTriageVote(
  room: TriageRoom,
  decision: TriageItemDecision,
  opts?: { now?: number },
): TriageRoom {
  if (room.status !== 'open') {
    throw new Error(`TriageRoom ${room.id} is ${room.status}`);
  }
  const known = room.pendingItems.some((it) => it.id === decision.itemId);
  if (!known) {
    throw new RangeError(`item ${decision.itemId} not in room`);
  }
  const prior = room.decisions.find((d) => d.itemId === decision.itemId);
  if (prior) {
    throw new Error(`item ${decision.itemId} already voted (use reviseTriageVote)`);
  }
  const now = nowIso(opts?.now);
  const decisions = Object.freeze([...room.decisions, { ...decision, ts: now }]);
  const status: TriageRoomStatus = decisions.length >= room.pendingItems.length
    ? 'resolved'
    : 'open';
  return { ...room, decisions, updatedAt: now, status };
}

/** Replace an existing decision for an item. Useful when a user edits
 *  their vote before the room resolves. */
export function reviseTriageVote(
  room: TriageRoom,
  decision: TriageItemDecision,
  opts?: { now?: number },
): TriageRoom {
  if (room.status === 'archived') {
    throw new Error(`TriageRoom ${room.id} is archived`);
  }
  const idx = room.decisions.findIndex((d) => d.itemId === decision.itemId);
  if (idx === -1) {
    return castTriageVote(room, decision, opts);
  }
  const now = nowIso(opts?.now);
  const next = [...room.decisions];
  next[idx] = { ...decision, ts: now };
  return {
    ...room,
    decisions: Object.freeze(next),
    updatedAt: now,
  };
}

/** Archive the room without resolving — typically when the intake is discarded. */
export function archiveTriageRoom(
  room: TriageRoom,
  opts?: { now?: number },
): TriageRoom {
  if (room.status === 'archived') return room;
  return {
    ...room,
    status: 'archived',
    updatedAt: nowIso(opts?.now),
  };
}

/** Roll the room decisions back into an IntakeDraft — produces a new
 *  draft with items filtered / edited per the votes. Items voted
 *  `reject` / `defer` are dropped; `edit` items merge their payload. */
export function applyTriageRoomToDraft(
  draft: IntakeDraft,
  room: TriageRoom,
): IntakeDraft {
  if (room.intakeId !== draft.intakeId) {
    throw new Error(`room.intakeId mismatch: ${room.intakeId} vs ${draft.intakeId}`);
  }
  const decisionMap = new Map<string, TriageItemDecision>();
  for (const d of room.decisions) decisionMap.set(d.itemId, d);
  const items: IntakeItemDraft[] = [];
  for (const item of draft.items) {
    const d = decisionMap.get(item.id);
    if (!d) {
      items.push(item);
      continue;
    }
    switch (d.vote) {
      case 'approve':
        items.push({ ...item, needsClarification: false });
        break;
      case 'edit':
        items.push({ ...item, ...(d.edited ?? {}), needsClarification: false });
        break;
      case 'clarify':
        items.push({ ...item, needsClarification: true });
        break;
      case 'reject':
      case 'defer':
        // dropped
        break;
    }
  }
  return { ...draft, items };
}
