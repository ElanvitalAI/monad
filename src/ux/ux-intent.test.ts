// UXIntent 계약 + SurfaceCapabilities 레지스트리 단위 테스트 (P0).
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  getSurfaceCapabilities,
  reportSurfaceCapabilities,
  resetSurfaceCapabilities,
  surfaceSupports,
  type UXIntent,
  type UXEvent,
} from './ux-intent.js';

describe('SurfaceCapabilities registry', () => {
  beforeEach(() => resetSurfaceCapabilities());

  it('returns RFC §2.4 defaults for known surfaces', () => {
    expect(surfaceSupports('telegram', 'reactions')).toBe(true);
    expect(surfaceSupports('telegram', 'force-reply')).toBe(true);
    expect(surfaceSupports('telegram', 'select')).toBe(false); // telegram = no select
    expect(surfaceSupports('discord', 'select')).toBe(true);
    expect(surfaceSupports('discord', 'modal')).toBe(true);
    expect(surfaceSupports({ source: 'native', nativePlatform: 'ios' }, 'live-activity')).toBe(true);
    expect(surfaceSupports({ source: 'native', nativePlatform: 'android' }, 'live-activity')).toBe(false);
    expect(surfaceSupports({ source: 'native' }, 'native-action')).toBe(true);
    expect(surfaceSupports({ source: 'native' }, 'live-activity')).toBe(false);
    expect(surfaceSupports('tui', 'reactions')).toBe(false);
    expect(surfaceSupports('tui', 'buttons')).toBe(true);
  });

  it('self-report overrides defaults', () => {
    reportSurfaceCapabilities('telegram', ['text', 'buttons']); // drop reactions
    expect(surfaceSupports('telegram', 'reactions')).toBe(false);
    expect(surfaceSupports('telegram', 'buttons')).toBe(true);
  });

  it('reset restores defaults', () => {
    reportSurfaceCapabilities('telegram', ['text']);
    expect(surfaceSupports('telegram', 'reactions')).toBe(false);
    resetSurfaceCapabilities();
    expect(surfaceSupports('telegram', 'reactions')).toBe(true);
  });

  it('unknown-ish surface still returns a capability set (graceful)', () => {
    const cap = getSurfaceCapabilities({ source: 'native', nativePlatform: 'android' });
    expect(cap.interactions.has('text')).toBe(true);
    expect(cap.interactions.has('native-action')).toBe(true);
  });

  it('uses the persisted native channel with a separate platform capability axis', () => {
    expect(getSurfaceCapabilities({ source: 'native', nativePlatform: 'ios' }).interactions.has('live-activity')).toBe(true);
    expect(getSurfaceCapabilities({ source: 'native', nativePlatform: 'android' }).interactions.has('live-activity')).toBe(false);
  });
});

describe('UXIntent / UXEvent contract shape', () => {
  it('accepts a well-formed intent with decisions context', () => {
    const intent: UXIntent = {
      missionId: 'm1',
      flowState: 'clarify:arc',
      prompt: '아크 수를 확인하세요',
      options: [
        { id: 'ok', label: '진행', value: 'proceed', recommended: true, kind: 'approve' },
        { id: 'edit', label: '직접 고치기', value: 'edit', kind: 'edit' },
      ],
      freeform: { marker: 'clarify:m1:free', hint: '이렇게 바꿔주세요' },
      context: {
        decisions: { arcHint: 5, scope: ['ux'] },
        signals: { criticalCount: 2, round: 1 },
        urgency: 'normal',
      },
      surface: { source: 'telegram', target: '12345' },
    };
    expect(intent.options).toHaveLength(2);
    expect(intent.context.decisions?.arcHint).toBe(5);
  });

  it('accepts a normalized event (verdict vs option vs freeform)', () => {
    const ev: UXEvent = {
      missionId: 'm1',
      flowState: 'hitl:approve-plan',
      verdict: 'approve',
      surface: { source: 'telegram', target: '12345' },
    };
    expect(ev.verdict).toBe('approve');
    expect(ev.optionId).toBeUndefined();
  });
});
