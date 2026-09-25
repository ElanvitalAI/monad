// hitl-acp-adapter multi-option fan-out tests — M5 of PLAN-ask-user-
// question-cross-surface-2026-05-13.
//
// Verifies the M5 path: `createAcpQuestionApproverFromHitl({ questionChannels })`
// dispatches via `requestQuestion()` instead of the legacy yes/no
// collapse. Tests both branches by toggling `questionChannels`.

import { describe, expect, test } from 'bun:test';

import { createAcpQuestionApproverFromHitl } from '../src/hitl/hitl-acp-adapter.js';
import type { QuestionChannel } from '../src/hitl/question.js';
import type { ConfirmChannel } from '../src/hitl/confirm.js';
import type { AcpQuestionRequest } from '../src/acp/client.js';

const sampleReq: AcpQuestionRequest = {
  backendId: 'test-backend',
  sessionId: 'sess-1',
  questions: [
    {
      id: 'pick',
      header: 'Pick',
      question: 'Choose one',
      options: [
        { label: 'A', description: 'first' },
        { label: 'B', description: 'second' },
        { label: 'C', description: 'third' },
      ],
    },
  ],
};

describe('createAcpQuestionApproverFromHitl multi-option path (M5)', () => {
  test('fans out via requestQuestion when questionChannels are wired', async () => {
    const channel: QuestionChannel = {
      name: 'mock',
      async ask(req) {
        // Verify the AskUserQuestionRequest shape we got is correct.
        expect(req.questions[0]?.id).toBe('pick');
        expect(req.questions[0]?.options).toHaveLength(3);
        return { answers: { pick: 'B' } };
      },
      cancel() { /* unused — only one channel */ },
    };
    const approver = createAcpQuestionApproverFromHitl({ questionChannels: [channel] });
    const result = await approver(sampleReq);
    expect(result.answers).toEqual({ pick: 'B' });
    expect(result.cancelled).toBeUndefined();
  });

  test('forwards otherText through the multi-option path', async () => {
    const channel: QuestionChannel = {
      name: 'mock',
      async ask() {
        return {
          answers: { pick: 'Other' },
          otherText: { pick: '인터넷 검색해줘' },
        };
      },
      cancel() {},
    };
    const approver = createAcpQuestionApproverFromHitl({ questionChannels: [channel] });
    const result = await approver(sampleReq);
    expect(result.answers).toEqual({ pick: 'Other' });
    expect(result.otherText).toEqual({ pick: '인터넷 검색해줘' });
  });

  test('cancel result propagates cancelled flag', async () => {
    const channel: QuestionChannel = {
      name: 'mock',
      async ask() { return { answers: {}, cancelled: true }; },
      cancel() {},
    };
    const approver = createAcpQuestionApproverFromHitl({ questionChannels: [channel] });
    const result = await approver(sampleReq);
    expect(result.cancelled).toBe(true);
    expect(result.answers).toEqual({});
  });

  test('null result (no channel configured) returns all-failed fallback', async () => {
    const channel: QuestionChannel = {
      name: 'mock-unconfigured',
      async ask() { return null; },
      cancel() {},
    };
    const approver = createAcpQuestionApproverFromHitl({
      questionChannels: [channel],
      timeoutMs: 50,   // race times out fast
    });
    const result = await approver(sampleReq);
    expect(result.cancelled).toBe(true);
    expect(result.answers).toEqual({});
  });
});

describe('createAcpQuestionApproverFromHitl legacy yes/no path (compat)', () => {
  test('without questionChannels, falls back to yes/no collapse', async () => {
    let confirmCalls = 0;
    const confirm: ConfirmChannel = {
      name: 'mock-confirm',
      async request() {
        confirmCalls += 1;
        return true;   // Approve → first option
      },
      cancel() {},
    };
    const approver = createAcpQuestionApproverFromHitl({ channels: [confirm] });
    const result = await approver(sampleReq);
    expect(confirmCalls).toBe(1);
    expect(result.answers).toEqual({ pick: 'A' });   // first option
    expect(result.cancelled).toBeUndefined();
  });

  test('yes/no reject → cancelled', async () => {
    const confirm: ConfirmChannel = {
      name: 'mock-confirm',
      async request() { return false; },
      cancel() {},
    };
    const approver = createAcpQuestionApproverFromHitl({ channels: [confirm] });
    const result = await approver(sampleReq);
    expect(result.cancelled).toBe(true);
  });
});
