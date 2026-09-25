import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';

import { createPendingQuestion } from '../ask-user-question/pending-questions.js';
import { registerPendingQuestionsCommand } from './pending-questions-cli.js';

const request = {
  questions: [{
    id: 'format',
    header: 'Format',
    question: 'Use Prettier?',
    options: [{ label: 'Yes', description: 'Format it' }],
  }],
};

const observedAt = Date.parse('2026-08-12T00:00:02.000Z');

function createProgram(output: string[], writes: unknown[] = []) {
  const active = createPendingQuestion(
    'active-file', request, undefined,
    { now: () => new Date('2026-08-12T00:00:00.000Z') },
    { surface: 'file', delivery: 'file', expiresAt: '2026-08-12T00:01:00.000Z' },
  );
  const expired = createPendingQuestion(
    'expired-file', request, undefined,
    { now: () => new Date('2026-08-12T00:00:00.000Z') },
    { surface: 'file', delivery: 'file', expiresAt: '2026-08-12T00:00:01.000Z' },
  );
  const modal = createPendingQuestion(
    'modal-question', request, undefined,
    { now: () => new Date('2026-08-12T00:00:00.000Z') },
  );
  const delivered = createPendingQuestion(
    'delivered-question', request, undefined,
    { now: () => new Date('2026-08-12T00:00:00.000Z') },
    { surface: 'file', delivery: 'telegram', expiresAt: '2026-08-12T00:01:00.000Z' },
  );
  const program = new Command();
  registerPendingQuestionsCommand(program, {
    read: () => ({ ok: true as const, questions: [active, expired, modal, delivered] }),
    now: () => observedAt,
    writeAnswer: (answer) => { writes.push(answer); },
    out: { log: (line) => output.push(line) },
    setExitCode: () => {},
  });
  return program;
}

describe('pending questions CLI answerability', () => {
  test('reports active, expired, surface, and delivery answerability reasons in text and JSON', async () => {
    const output: string[] = [];
    const program = createProgram(output);

    await program.parseAsync(['node', 'monad', 'questions', 'pending']);
    expect(output.shift()).toBe([
      'active-file  waiting=2s  expiry=active  surface=file  questions=Use Prettier?  answerable=true  answerableReason=cli-answerable',
      'expired-file  waiting=2s  expiry=expired  surface=file  questions=Use Prettier?  answerable=false  answerableReason=expired',
      'modal-question  waiting=2s  expiry=no-expiry  surface=tui  questions=Use Prettier?  answerable=false  answerableReason=requires-surface:tui',
      'delivered-question  waiting=2s  expiry=active  surface=file  questions=Use Prettier?  answerable=false  answerableReason=requires-delivery:telegram',
    ].join('\n'));

    await program.parseAsync(['node', 'monad', 'questions', 'pending', '--json']);
    const pending = JSON.parse(output.shift()!);
    expect(pending.questions.map((question: { id: string; answerable: boolean; answerableReason: string }) => [
      question.id,
      question.answerable,
      question.answerableReason,
    ])).toEqual([
      ['active-file', true, 'cli-answerable'],
      ['expired-file', false, 'expired'],
      ['modal-question', false, 'requires-surface:tui'],
      ['delivered-question', false, 'requires-delivery:telegram'],
    ]);
  });

  test('preserves successful file answers and distinguishes expired, modal, and missing ids', async () => {
    const output: string[] = [];
    const writes: unknown[] = [];
    const program = createProgram(output, writes);
    const answer = '{"answers":{"format":"Yes"}}';

    await program.parseAsync(['node', 'monad', 'questions', 'answer', 'active-file', answer]);
    expect(output.shift()).toBe('Recorded answer for active-file.');
    expect(writes).toEqual([{ id: 'active-file', result: { answers: { format: 'Yes' } } }]);

    await program.parseAsync(['node', 'monad', 'questions', 'answer', 'expired-file', answer]);
    expect(output.shift()).toBe('Pending question expired-file has expired.');
    await program.parseAsync(['node', 'monad', 'questions', 'answer', 'modal-question', answer]);
    expect(output.shift()).toBe('Pending question modal-question exists but cannot be answered through this CLI (surface=tui, delivery=modal).');
    await program.parseAsync(['node', 'monad', 'questions', 'answer', 'missing-question', answer]);
    expect(output.shift()).toBe('No active file question found for missing-question.');
    expect(writes).toHaveLength(1);
  });
});
