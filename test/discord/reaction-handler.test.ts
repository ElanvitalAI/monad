// Test: src/discord/reaction-handler.ts
//
// Coverage: emoji → decision mapping · ApprovalGate watch/handle/
// cancel · oneShot · allowedUserIds · custom vocab · removed events.

import { describe, expect, test } from 'bun:test';
import {
  ApprovalGate,
  DEFAULT_APPROVE_EMOJI,
  DEFAULT_REJECT_EMOJI,
  emojiToDecision,
  type ApprovalEvent,
  type ReactionEvent,
} from '../../src/discord/reaction-handler.js';

function rxn(over: Partial<ReactionEvent> = {}): ReactionEvent {
  return {
    channelId: 'ch-1',
    messageId: 'msg-1',
    userId: 'user-1',
    emoji: { name: '👍' },
    ...over,
  };
}

describe('emojiToDecision (default vocab)', () => {
  test('approve emoji → "approve"', () => {
    expect(emojiToDecision({ name: '👍' })).toBe('approve');
    expect(emojiToDecision({ name: '✅' })).toBe('approve');
    expect(emojiToDecision({ name: '✔️' })).toBe('approve');
  });
  test('reject emoji → "reject"', () => {
    expect(emojiToDecision({ name: '👎' })).toBe('reject');
    expect(emojiToDecision({ name: '❌' })).toBe('reject');
    expect(emojiToDecision({ name: '🛑' })).toBe('reject');
  });
  test('unknown emoji → "unknown"', () => {
    expect(emojiToDecision({ name: '🤔' })).toBe('unknown');
    expect(emojiToDecision({ name: '💡' })).toBe('unknown');
  });
  test('default sets contain expected entries', () => {
    expect(DEFAULT_APPROVE_EMOJI.has('👍')).toBe(true);
    expect(DEFAULT_REJECT_EMOJI.has('👎')).toBe(true);
  });
});

describe('emojiToDecision (custom vocab)', () => {
  test('caller can supply approve/reject sets', () => {
    const approve = new Set(['+1', 'lgtm']);
    const reject = new Set(['-1', 'nope']);
    expect(emojiToDecision({ name: '+1' }, approve, reject)).toBe('approve');
    expect(emojiToDecision({ name: 'lgtm' }, approve, reject)).toBe('approve');
    expect(emojiToDecision({ name: '-1' }, approve, reject)).toBe('reject');
    expect(emojiToDecision({ name: '👍' }, approve, reject)).toBe('unknown');
  });
});

describe('ApprovalGate.watch + handleReaction', () => {
  test('routes approve emoji to listener (one-shot default)', () => {
    const gate = new ApprovalGate();
    const events: ApprovalEvent[] = [];
    gate.watch('msg-1', (e) => events.push(e));

    expect(gate.size()).toBe(1);
    expect(gate.has('msg-1')).toBe(true);

    const notified = gate.handleReaction(rxn());
    expect(notified).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toBe('approve');
    expect(events[0]!.userId).toBe('user-1');

    // one-shot → listener removed after first decision
    expect(gate.has('msg-1')).toBe(false);
    expect(gate.size()).toBe(0);
  });

  test('routes reject emoji to listener', () => {
    const gate = new ApprovalGate();
    const events: ApprovalEvent[] = [];
    gate.watch('msg-1', (e) => events.push(e));
    gate.handleReaction(rxn({ emoji: { name: '👎' } }));
    expect(events[0]!.decision).toBe('reject');
  });

  test('unknown emoji does not fire listener; gate stays', () => {
    const gate = new ApprovalGate();
    const events: ApprovalEvent[] = [];
    gate.watch('msg-1', (e) => events.push(e));
    gate.handleReaction(rxn({ emoji: { name: '🤔' } }));
    expect(events).toHaveLength(0);
    expect(gate.has('msg-1')).toBe(true);
  });

  test('listener for unrelated message is not fired', () => {
    const gate = new ApprovalGate();
    const events: ApprovalEvent[] = [];
    gate.watch('msg-1', (e) => events.push(e));
    const notified = gate.handleReaction(rxn({ messageId: 'msg-OTHER' }));
    expect(notified).toBe(0);
    expect(events).toHaveLength(0);
    expect(gate.has('msg-1')).toBe(true);
  });

  test('multiple listeners on same message all fire', () => {
    const gate = new ApprovalGate();
    let aFired = false, bFired = false;
    gate.watch('msg-1', () => { aFired = true; });
    gate.watch('msg-1', () => { bFired = true; });
    gate.handleReaction(rxn());
    expect(aFired).toBe(true);
    expect(bFired).toBe(true);
    expect(gate.size()).toBe(0);  // both one-shot
  });

  test('oneShot:false → listener stays', () => {
    const gate = new ApprovalGate();
    let count = 0;
    gate.watch('msg-1', () => { count++; }, { oneShot: false });
    gate.handleReaction(rxn());
    gate.handleReaction(rxn({ emoji: { name: '👎' } }));
    expect(count).toBe(2);
    expect(gate.has('msg-1')).toBe(true);
  });
});

describe('ApprovalGate.allowedUserIds', () => {
  test('only allowed user ids decide; others bounce off without firing', () => {
    const gate = new ApprovalGate();
    const events: ApprovalEvent[] = [];
    gate.watch('msg-1', (e) => events.push(e), {
      allowedUserIds: new Set(['owner']),
    });
    gate.handleReaction(rxn({ userId: 'stranger' }));
    expect(events).toHaveLength(0);
    expect(gate.has('msg-1')).toBe(true);  // gate not consumed

    gate.handleReaction(rxn({ userId: 'owner' }));
    expect(events).toHaveLength(1);
    expect(gate.has('msg-1')).toBe(false);
  });
});

describe('ApprovalGate.handleReaction (removed events)', () => {
  test('removed=true does not consume one-shot gate', () => {
    const gate = new ApprovalGate();
    const events: ApprovalEvent[] = [];
    gate.watch('msg-1', (e) => events.push(e));
    gate.handleReaction(rxn({ removed: true }));
    expect(events).toHaveLength(1);
    expect(events[0]!.removed).toBe(true);
    expect(gate.has('msg-1')).toBe(true);  // not consumed
  });
});

describe('ApprovalGate.cancel + reset + unsubscribe', () => {
  test('cancel returns count and removes listeners', () => {
    const gate = new ApprovalGate();
    gate.watch('msg-1', () => {});
    gate.watch('msg-1', () => {});
    gate.watch('msg-2', () => {});
    expect(gate.cancel('msg-1')).toBe(2);
    expect(gate.has('msg-1')).toBe(false);
    expect(gate.has('msg-2')).toBe(true);
  });

  test('reset clears all', () => {
    const gate = new ApprovalGate();
    gate.watch('a', () => {});
    gate.watch('b', () => {});
    gate.reset();
    expect(gate.size()).toBe(0);
  });

  test('unsubscribe fn removes only that listener', () => {
    const gate = new ApprovalGate();
    let aFired = false, bFired = false;
    const offA = gate.watch('msg-1', () => { aFired = true; });
    gate.watch('msg-1', () => { bFired = true; });
    offA();
    gate.handleReaction(rxn());
    expect(aFired).toBe(false);
    expect(bFired).toBe(true);
  });
});

describe('ApprovalGate listener errors are swallowed', () => {
  test('one throwing listener does not block another', () => {
    const gate = new ApprovalGate();
    let bFired = false;
    gate.watch('msg-1', () => { throw new Error('boom'); });
    gate.watch('msg-1', () => { bFired = true; });
    expect(() => gate.handleReaction(rxn())).not.toThrow();
    expect(bFired).toBe(true);
  });
});

describe('ApprovalGate per-gate vocab override', () => {
  test('only the gate-level vocab is consulted', () => {
    const gate = new ApprovalGate();
    const events: ApprovalEvent[] = [];
    gate.watch('msg-1', (e) => events.push(e), {
      approveSet: new Set(['👌']),  // only 👌
      rejectSet: new Set(['👎']),
    });
    gate.handleReaction(rxn({ emoji: { name: '👍' } }));  // default approve, but custom set!
    expect(events).toHaveLength(0);  // 👍 not in custom set
    gate.handleReaction(rxn({ emoji: { name: '👌' } }));
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toBe('approve');
  });
});
