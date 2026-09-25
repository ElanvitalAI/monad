// UX 리액션 라우터 — 카드↔intent 매핑 + 리액션→UXEvent 라우팅 단위테스트 (P2 코어).
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  registerCardIntent,
  clearCardIntent,
  hasCardIntent,
  resolveReactionEvent,
  resetCardIntents,
} from './ux-reaction-router.js';

const reaction = (emoji?: string) => ({
  message_id: 42,
  new_reaction: emoji ? [{ type: 'emoji', emoji }] : [],
});

describe('ux-reaction-router', () => {
  beforeEach(() => resetCardIntents());

  it('등록된 native 카드의 플랫폼을 UXEvent까지 보존한다', () => {
    registerCardIntent(42, { missionId: 'm1', flowState: 'hitl:approve-plan', surface: { source: 'native', nativePlatform: 'ios', target: '9' } });
    const ev = resolveReactionEvent(42, reaction('👍'));
    expect(ev?.verdict).toBe('approve');
    expect(ev?.missionId).toBe('m1');
    expect(ev?.flowState).toBe('hitl:approve-plan');
    expect(ev?.surface?.source).toBe('native');
    expect(ev?.surface?.nativePlatform).toBe('ios');
  });

  it('👎 → reject', () => {
    registerCardIntent(42, { missionId: 'm1', flowState: 'clarify:scope' });
    expect(resolveReactionEvent(42, reaction('👎'))?.verdict).toBe('reject');
  });

  it('미등록 메시지 → null (형제 핸들러 무간섭)', () => {
    expect(resolveReactionEvent(999, reaction('👍'))).toBeNull();
  });

  it('리액션 제거(빈 new_reaction) → verdict 없음', () => {
    registerCardIntent(42, { missionId: 'm1', flowState: 'x' });
    expect(resolveReactionEvent(42, reaction())?.verdict).toBeUndefined();
  });

  it('clearCardIntent 후 라우팅 안 됨(1회성 정리)', () => {
    registerCardIntent(42, { missionId: 'm1', flowState: 'x' });
    expect(hasCardIntent(42)).toBe(true);
    clearCardIntent(42);
    expect(hasCardIntent(42)).toBe(false);
    expect(resolveReactionEvent(42, reaction('👍'))).toBeNull();
  });

  it('reset 후 전체 정리', () => {
    registerCardIntent(1, { missionId: 'a', flowState: 'x' });
    registerCardIntent(2, { missionId: 'b', flowState: 'y' });
    resetCardIntents();
    expect(hasCardIntent(1)).toBe(false);
    expect(hasCardIntent(2)).toBe(false);
  });
});
