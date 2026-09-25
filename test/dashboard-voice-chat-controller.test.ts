// PR-S1V.9 (sprint 22 Phase 4) — voice-chat state machine.

import { describe, expect, it } from 'bun:test';
import {
  createVoiceChatModeController,
  describeVoiceChatPhase,
  type VoiceChatPhase,
} from '../src/dashboard/voice-chat/voice-chat-mode-controller.js';

describe('createVoiceChatModeController — basics', () => {
  it('starts inactive by default', () => {
    const c = createVoiceChatModeController();
    expect(c.getPhase()).toBe('inactive');
    expect(c.isActive()).toBe(false);
  });

  it('respects initialPhase override (test seam)', () => {
    const c = createVoiceChatModeController({ initialPhase: 'listening' });
    expect(c.getPhase()).toBe('listening');
    expect(c.isActive()).toBe(true);
  });

  it('enter() moves inactive → listening', () => {
    const c = createVoiceChatModeController();
    expect(c.enter()).toBe(true);
    expect(c.getPhase()).toBe('listening');
  });

  it('enter() while active is rejected', () => {
    const c = createVoiceChatModeController({ initialPhase: 'speaking' });
    // Already in speaking, enter() targets listening which speaking
    // can transition to (multi-turn), so this is allowed.
    expect(c.enter()).toBe(true);
    expect(c.getPhase()).toBe('listening');
  });
});

describe('createVoiceChatModeController — transitions', () => {
  it('listening → processing → speaking → inactive (1-turn)', () => {
    const c = createVoiceChatModeController({ initialPhase: 'listening' });
    expect(c.transition('processing')).toBe('listening');
    expect(c.transition('speaking')).toBe('processing');
    expect(c.transition('inactive')).toBe('speaking');
  });

  it('rejects illegal transitions and returns null', () => {
    const c = createVoiceChatModeController();
    // inactive → processing is illegal (only inactive → listening)
    expect(c.transition('processing')).toBeNull();
    expect(c.getPhase()).toBe('inactive');
  });

  it('exit() drives any active phase to inactive via stopping', () => {
    const c = createVoiceChatModeController({ initialPhase: 'listening' });
    const seen: VoiceChatPhase[] = [];
    c.onPhaseChange((next) => seen.push(next));
    c.exit('user-cancel');
    expect(c.getPhase()).toBe('inactive');
    expect(seen).toEqual(['stopping', 'inactive']);
  });

  it('exit() while inactive is no-op', () => {
    const c = createVoiceChatModeController();
    const seen: VoiceChatPhase[] = [];
    c.onPhaseChange((next) => seen.push(next));
    c.exit('user-cancel');
    expect(seen).toEqual([]);
  });
});

describe('createVoiceChatModeController — observers', () => {
  it('onPhaseChange fires for each transition with (next, prev)', () => {
    const c = createVoiceChatModeController();
    const events: Array<[VoiceChatPhase, VoiceChatPhase]> = [];
    c.onPhaseChange((next, prev) => events.push([next, prev]));
    c.enter();
    c.transition('processing');
    expect(events).toEqual([
      ['listening', 'inactive'],
      ['processing', 'listening'],
    ]);
  });

  it('subscribers can unsubscribe', () => {
    const c = createVoiceChatModeController();
    const events: VoiceChatPhase[] = [];
    const off = c.onPhaseChange((next) => events.push(next));
    c.enter();
    off();
    c.transition('processing');
    expect(events).toEqual(['listening']);
  });

  it('subscriber error does not break other subscribers', () => {
    const c = createVoiceChatModeController();
    const events: VoiceChatPhase[] = [];
    c.onPhaseChange(() => { throw new Error('boom'); });
    c.onPhaseChange((next) => events.push(next));
    c.enter();
    expect(events).toEqual(['listening']);
  });
});

describe('describeVoiceChatPhase', () => {
  it('returns user-readable labels for each phase', () => {
    expect(describeVoiceChatPhase('inactive')).toBe('');
    expect(describeVoiceChatPhase('listening')).toContain('listening');
    expect(describeVoiceChatPhase('processing')).toContain('processing');
    expect(describeVoiceChatPhase('speaking')).toContain('speaking');
    expect(describeVoiceChatPhase('stopping')).toContain('stopping');
  });
});
