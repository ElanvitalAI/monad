// UXIntent 빌더 — decisions 채널 → UXIntent 발행 단위테스트 + RENDER 왕복.
import { describe, expect, it, beforeEach } from 'bun:test';
import type { IntakeClarification } from '../autopilot/mission-intake-clarify.js';
import { resetSurfaceCapabilities } from './ux-intent.js';
import { renderIntent } from './ux-render.js';
import { clarificationToUXIntent, approvalToUXIntent } from './ux-intent-builder.js';

const scopeQ: IntakeClarification = {
  questionId: 'q1', kind: 'scope', header: '완료 범위', blocking: true,
  question: '어디까지 이번 단계로?',
  options: [{ label: 'MVP 먼저', recommended: true }, { label: '전체' }],
};

describe('clarificationToUXIntent', () => {
  it('maps clarify question → UXIntent with decisions + freeform', () => {
    const intent = clarificationToUXIntent('m1', scopeQ, 'apm-clarify:tok:edit', {
      decisions: { arcHint: 5, scope: ['ux'] },
      surface: { source: 'telegram', target: '9' },
    });
    expect(intent.flowState).toBe('clarify:scope');
    expect(intent.options).toHaveLength(2);
    expect(intent.options[0]!.id).toBe('0');
    expect(intent.options[0]!.recommended).toBe(true);
    expect(intent.freeform?.marker).toBe('apm-clarify:tok:edit');
    expect(intent.context.decisions?.arcHint).toBe(5);
    expect(intent.context.signals?.blocking).toBe(true);
  });

  it('blocking prefix in prompt', () => {
    const intent = clarificationToUXIntent('m1', scopeQ, 'mk');
    expect(intent.prompt).toContain('[필수]');
  });
});

describe('approvalToUXIntent', () => {
  it('is consequential → RENDER forces buttons (not reactions)', () => {
    resetSurfaceCapabilities();
    const intent = approvalToUXIntent('m1', {
      prompt: '이 플랜으로 진행할까요?',
      decisions: { arcHint: 3 },
      surface: { source: 'telegram' },
    });
    expect(intent.flowState).toBe('hitl:approve-plan');
    expect(intent.context.signals?.consequential).toBe(true);
    // 승인→집행은 §9대로 버튼(리액션 금지) — RENDER 왕복으로 검증.
    const plan = renderIntent(intent);
    expect(plan.form).toBe('buttons');
    expect(plan.consequential).toBe(true);
  });

  it('carries criticalCount into signals', () => {
    const intent = approvalToUXIntent('m1', { prompt: 'x', criticalCount: 4 });
    expect(intent.context.signals?.criticalCount).toBe(4);
  });
});

describe('clarify RENDER 왕복 (simple → reactions on telegram)', () => {
  beforeEach(() => resetSurfaceCapabilities());
  it('2-option scope question renders as reactions (low-risk)', () => {
    const intent = clarificationToUXIntent('m1', scopeQ, 'mk', { surface: { source: 'telegram' } });
    const plan = renderIntent(intent);
    // clarify 는 consequential 아님 + 2옵션 simple → 리액션.
    expect(plan.form).toBe('reactions');
  });

  it('preserves the native platform from builder input through render plan', () => {
    const intent = clarificationToUXIntent('m1', scopeQ, 'mk', { surface: { source: 'native', nativePlatform: 'android' } });
    const plan = renderIntent(intent);
    expect(plan.surface).toBe('native');
    expect(plan.nativePlatform).toBe('android');
  });
});
