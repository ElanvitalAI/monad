// ── AU5 — ACP request_question bridge ──

import { describe, test, expect, spyOn } from 'bun:test';
import { extractAcpQuestion } from '../../src/acp/client.js';
import { debug } from '../../src/debug/log.js';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

function base(rawInput: unknown, kind = 'ask-user-question'): RequestPermissionRequest {
  return {
    sessionId: 'sess-1' as any,
    toolCall: {
      toolCallId: 'tc-1' as any,
      title: 'ACP call',
      kind: kind as any,
      rawInput,
    } as any,
    options: [] as any,
  } as RequestPermissionRequest;
}

describe('extractAcpQuestion', () => {
  test('detects kind=ask-user-question with well-formed questions', () => {
    const req = base({
      questions: [{
        id: 'q1',
        header: 'Choice',
        question: 'Pick one',
        options: [
          { label: 'A', description: 'opt a' },
          { label: 'B', description: 'opt b' },
        ],
      }],
    });
    const q = extractAcpQuestion(req, 'backend-x');
    expect(q).not.toBeNull();
    expect(q!.backendId).toBe('backend-x');
    expect(q!.questions).toHaveLength(1);
    expect(q!.questions[0]!.id).toBe('q1');
    expect(q!.questions[0]!.options).toHaveLength(2);
  });

  test('detects __monadQuestion marker even without kind', () => {
    const req = base({
      __monadQuestion: true,
      questions: [{
        id: 'x',
        header: 'X',
        question: 'Why',
        options: [
          { label: 'Yes', description: '' },
          { label: 'No',  description: '' },
        ],
      }],
    }, /* kind */ 'other');
    const q = extractAcpQuestion(req, 'b');
    expect(q).not.toBeNull();
    expect(q!.questions[0]!.header).toBe('X');
  });

  test('returns null when neither kind nor marker match', () => {
    const req = base({ questions: [] }, 'fs.readFile');
    expect(extractAcpQuestion(req, 'b')).toBeNull();
  });

  test('returns null when questions array is empty', () => {
    const req = base({ questions: [] });
    expect(extractAcpQuestion(req, 'b')).toBeNull();
  });

  test('skips ill-formed questions (< 2 options)', () => {
    const req = base({
      questions: [{
        id: 'q', header: 'H', question: 'Q',
        options: [{ label: 'Only', description: '' }],
      }],
    });
    expect(extractAcpQuestion(req, 'b')).toBeNull();
  });

  test('caps options at 4 + questions at 3', () => {
    const opts = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `O${i}`, description: '' }));
    const req = base({
      questions: [
        { id: 'a', header: 'a', question: '?', options: opts(6) },
        { id: 'b', header: 'b', question: '?', options: opts(2) },
        { id: 'c', header: 'c', question: '?', options: opts(2) },
        { id: 'd', header: 'd', question: '?', options: opts(2) },  // truncated
        { id: 'e', header: 'e', question: '?', options: opts(2) },  // truncated
      ],
    });
    const q = extractAcpQuestion(req, 'b')!;
    expect(q.questions).toHaveLength(3);
    expect(q.questions[0]!.options).toHaveLength(4);
  });

  test('truncates over-limit headers with an ellipsis and observes retained length only', () => {
    const log = spyOn(debug, 'log');
    const req = base({
      questions: [{
        id: 'q',
        header: 'Clarification',
        question: '?',
        options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
      }],
    });
    const q = extractAcpQuestion(req, 'b')!;
    expect(q.questions[0]!.header).toBe('Clarificati…');
    expect(q.questions[0]!.header).not.toBe('Clarificatio');
    expect(q.questions[0]!.header).toHaveLength(12);
    expect(log).toHaveBeenCalledWith('acp.client', 'question-header-truncated', {
      originalLength: 13,
      retainedLength: 12,
    });
    log.mockRestore();
  });

  test('keeps surrogate pairs intact when reserving space for the ellipsis', () => {
    const log = spyOn(debug, 'log');
    const req = base({
      questions: [
        { id: 'over', header: 'abcdefghij😀x', question: '?', options: [{ label: 'A' }, { label: 'B' }] },
        { id: 'exact', header: 'abcdefghij😀', question: '?', options: [{ label: 'A' }, { label: 'B' }] },
      ],
    });
    const q = extractAcpQuestion(req, 'b')!;
    expect(q.questions.map(question => question.header)).toEqual(['abcdefghij…', 'abcdefghij😀']);
    expect(q.questions[0]!.header).not.toContain('\ud83d');
    expect(log).toHaveBeenCalledWith('acp.client', 'question-header-truncated', {
      originalLength: 13,
      retainedLength: 11,
    });
    log.mockRestore();
  });

  test('preserves exact-limit and short headers without ellipsis or truncation observation', () => {
    const log = spyOn(debug, 'log');
    const req = base({
      questions: [
        { id: 'exact', header: 'twelve-chars', question: '?', options: [{ label: 'A' }, { label: 'B' }] },
        { id: 'short', header: 'Choice', question: '?', options: [{ label: 'A' }, { label: 'B' }] },
      ],
    });
    const q = extractAcpQuestion(req, 'b')!;
    expect(q.questions.map(question => question.header)).toEqual(['twelve-chars', 'Choice']);
    expect(log).not.toHaveBeenCalledWith('acp.client', 'question-header-truncated', expect.anything());
    log.mockRestore();
  });

  test('fills defaults for missing optional fields', () => {
    const req = base({
      questions: [{
        id: '', // will fall back to q1
        header: 0 as any, // will fall back to 'Choice'
        options: [{ label: 'A' }, { label: 'B' }],
      }],
    });
    const q = extractAcpQuestion(req, 'b')!;
    expect(q.questions[0]!.id).toBe('q1');
    expect(q.questions[0]!.header).toBe('Choice');
    expect(q.questions[0]!.question).toBe('(no question text)');
  });
});
