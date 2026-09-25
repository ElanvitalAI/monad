// Intake Triage Room — cascade-zyu W3 Z1.

import { describe, expect, test } from 'bun:test';
import type { IntakeDraft, IntakeItemDraft } from '../src/intake-plane/types.js';
import {
  DEFAULT_TRIAGE_POLICY,
  evaluateTriage,
} from '../src/intake-plane/triage-policy.js';
import {
  applyTriageRoomToDraft,
  archiveTriageRoom,
  castTriageVote,
  createTriageRoom,
  reviseTriageVote,
} from '../src/intake-plane/triage-room.js';
import {
  TriageRoomStore,
  _resetTriageRoomStore,
} from '../src/intake-plane/triage-store.js';

function makeItem(over?: Partial<IntakeItemDraft>): IntakeItemDraft {
  return {
    id: 'item-1',
    kind: 'implementation',
    text: 'do thing',
    links: [],
    needsClarification: false,
    proposedAction: 'task-create',
    ...over,
  };
}

function makeDraft(over?: Partial<IntakeDraft>): IntakeDraft {
  return {
    intakeId: 'in-1',
    title: 'd',
    summary: 's',
    items: [makeItem()],
    openQuestions: [],
    suggestedMode: 'task-creation',
    confidence: 0.9,
    ...over,
  };
}

describe('evaluateTriage', () => {
  test('no trigger when draft is high-confidence + all items clean', () => {
    const ev = evaluateTriage(makeDraft());
    expect(ev.trigger).toBeNull();
    expect(ev.flaggedItems).toHaveLength(0);
  });

  test('triggers below confidence ceiling', () => {
    const ev = evaluateTriage(makeDraft({ confidence: 0.3 }));
    expect(ev.trigger).not.toBeNull();
    expect(ev.trigger?.policyId).toBe('default-v1');
    expect(ev.trigger?.confidence).toBe(0.3);
  });

  test('triggers on needsClarification items even at high confidence', () => {
    const ev = evaluateTriage(makeDraft({
      items: [
        makeItem({ id: 'a' }),
        makeItem({ id: 'b', needsClarification: true }),
      ],
    }));
    expect(ev.trigger).not.toBeNull();
    expect(ev.flaggedItems).toHaveLength(1);
    expect(ev.flaggedItems[0]?.id).toBe('b');
  });

  test('triggers on ask-user proposedAction', () => {
    const ev = evaluateTriage(makeDraft({
      items: [makeItem({ id: 'q', proposedAction: 'ask-user' })],
    }));
    expect(ev.trigger).not.toBeNull();
    expect(ev.flaggedItems).toHaveLength(1);
  });

  test('triggers on unknown kind', () => {
    const ev = evaluateTriage(makeDraft({
      items: [makeItem({ id: 'u', kind: 'unknown' })],
    }));
    expect(ev.trigger).not.toBeNull();
  });

  test('low confidence with no flagged items uses all items', () => {
    const ev = evaluateTriage(makeDraft({ confidence: 0.2 }));
    expect(ev.flaggedItems).toHaveLength(1);
  });

  test('policy overrides — askUserAlwaysTriggers=false suppresses ask-user', () => {
    const ev = evaluateTriage(
      makeDraft({ items: [makeItem({ proposedAction: 'ask-user' })] }),
      { ...DEFAULT_TRIAGE_POLICY, askUserAlwaysTriggers: false },
    );
    expect(ev.trigger).toBeNull();
  });
});

describe('TriageRoom — create + vote', () => {
  test('createTriageRoom seeds open status with pending items', () => {
    const room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' }), makeItem({ id: 'b' })],
      trigger: { policyId: 'default-v1', confidence: 0.3, flaggedItemCount: 2 },
      now: 1000,
    });
    expect(room.id).toMatch(/^triage:[0-9a-f]+$/);
    expect(room.status).toBe('open');
    expect(room.pendingItems).toHaveLength(2);
    expect(room.createdAt).toBe(room.updatedAt);
  });

  test('throws on empty intakeId / pending items', () => {
    expect(() => createTriageRoom({
      intakeId: '',
      pendingItems: [makeItem()],
      trigger: { policyId: 'p', confidence: 0, flaggedItemCount: 0 },
    })).toThrow();
    expect(() => createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [],
      trigger: { policyId: 'p', confidence: 0, flaggedItemCount: 0 },
    })).toThrow();
  });

  test('castTriageVote records the decision + bumps updatedAt', () => {
    let room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' }), makeItem({ id: 'b' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 2 },
      now: 1000,
    });
    room = castTriageVote(room, {
      itemId: 'a', vote: 'approve', voter: { kind: 'user' }, ts: '',
    }, { now: 2000 });
    expect(room.decisions).toHaveLength(1);
    expect(room.decisions[0]?.vote).toBe('approve');
    expect(room.status).toBe('open');
    expect(room.updatedAt).not.toBe(room.createdAt);
  });

  test('room resolves when every item is voted', () => {
    let room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' }), makeItem({ id: 'b' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 2 },
    });
    room = castTriageVote(room, {
      itemId: 'a', vote: 'approve', voter: { kind: 'user' }, ts: '',
    });
    room = castTriageVote(room, {
      itemId: 'b', vote: 'reject', voter: { kind: 'user' }, ts: '',
    });
    expect(room.status).toBe('resolved');
  });

  test('cannot vote on unknown item', () => {
    const room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 1 },
    });
    expect(() => castTriageVote(room, {
      itemId: 'unknown', vote: 'approve', voter: { kind: 'user' }, ts: '',
    })).toThrow();
  });

  test('cannot double-vote without revise', () => {
    let room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 1 },
    });
    room = castTriageVote(room, {
      itemId: 'a', vote: 'approve', voter: { kind: 'user' }, ts: '',
    });
    expect(() => castTriageVote(room, {
      itemId: 'a', vote: 'reject', voter: { kind: 'user' }, ts: '',
    })).toThrow();
  });

  test('reviseTriageVote overwrites prior decision', () => {
    let room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 1 },
    });
    room = castTriageVote(room, {
      itemId: 'a', vote: 'approve', voter: { kind: 'user' }, ts: '',
    });
    room = reviseTriageVote(room, {
      itemId: 'a', vote: 'reject', voter: { kind: 'user' }, ts: '',
    });
    expect(room.decisions[0]?.vote).toBe('reject');
  });

  test('archived room rejects further votes', () => {
    let room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 1 },
    });
    room = archiveTriageRoom(room);
    expect(room.status).toBe('archived');
    expect(() => castTriageVote(room, {
      itemId: 'a', vote: 'approve', voter: { kind: 'user' }, ts: '',
    })).toThrow();
  });
});

describe('applyTriageRoomToDraft', () => {
  test('approve preserves item, reject drops, edit merges, clarify flags', () => {
    const draft = makeDraft({
      items: [
        makeItem({ id: 'keep' }),
        makeItem({ id: 'drop' }),
        makeItem({ id: 'edit-me', text: 'old' }),
        makeItem({ id: 'ask' }),
      ],
    });
    let room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: draft.items,
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 4 },
    });
    room = castTriageVote(room, { itemId: 'keep', vote: 'approve', voter: { kind: 'user' }, ts: '' });
    room = castTriageVote(room, { itemId: 'drop', vote: 'reject', voter: { kind: 'user' }, ts: '' });
    room = castTriageVote(room, {
      itemId: 'edit-me',
      vote: 'edit',
      voter: { kind: 'user' },
      ts: '',
      edited: { text: 'new text' },
    });
    room = castTriageVote(room, { itemId: 'ask', vote: 'clarify', voter: { kind: 'user' }, ts: '' });
    const next = applyTriageRoomToDraft(draft, room);
    expect(next.items).toHaveLength(3);
    expect(next.items.find((i) => i.id === 'edit-me')?.text).toBe('new text');
    expect(next.items.find((i) => i.id === 'ask')?.needsClarification).toBe(true);
    expect(next.items.find((i) => i.id === 'drop')).toBeUndefined();
  });

  test('throws on intakeId mismatch', () => {
    const draft = makeDraft({ intakeId: 'a' });
    const room = createTriageRoom({
      intakeId: 'b',
      pendingItems: [makeItem()],
      trigger: { policyId: 'p', confidence: 0, flaggedItemCount: 1 },
    });
    expect(() => applyTriageRoomToDraft(draft, room)).toThrow();
  });
});

describe('TriageRoomStore', () => {
  test('upsert + get + list by intakeId / status', () => {
    const store = new TriageRoomStore();
    const a = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 1 },
    });
    const b = createTriageRoom({
      intakeId: 'in-2',
      pendingItems: [makeItem({ id: 'a' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 1 },
    });
    store.upsert(a);
    store.upsert(b);
    expect(store.size()).toBe(2);
    expect(store.get(a.id)?.id).toBe(a.id);
    expect(store.list({ intakeId: 'in-1' })).toHaveLength(1);
    expect(store.list({ status: 'open' })).toHaveLength(2);
  });

  test('upsert idempotent on same id', () => {
    const store = new TriageRoomStore();
    const room = createTriageRoom({
      intakeId: 'in-1',
      pendingItems: [makeItem({ id: 'a' })],
      trigger: { policyId: 'p', confidence: 0.3, flaggedItemCount: 1 },
    });
    store.upsert(room);
    store.upsert(room);
    expect(store.size()).toBe(1);
  });

  test('singleton seam', () => {
    const s1 = _resetTriageRoomStore();
    expect(s1.size()).toBe(0);
  });
});
