import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectGoalClarificationClosure, classifyGoalInterviewRound } from './goal-author-closure.js';

function clarification(id: string, answer = `DEFERRED-UNTIL: answer ${id}`): string {
  return `- Clarification:
  - id: ${id}
  - header: Clarification
  - question: Question ${id}?
  - answer: ${answer}`;
}

function document(unresolved: number, evidence: number): string {
  return [
    ...Array.from({ length: unresolved }, (_, index) => clarification(`open-${index}`)),
    '- Persistent grounding evidence:',
    ...Array.from({ length: evidence }, (_, index) => `  - evidence ${index}`),
  ].join('\n');
}

test('converges when the new document has no unresolved clarifications regardless of evidence count', () => {
  expect(classifyGoalInterviewRound(document(1, 7), document(0, 4))).toBe('converged');
  expect(classifyGoalInterviewRound(document(1, 0), document(0, 9))).toBe('converged');
});

test('narrows when unresolved clarifications decrease', () => {
  expect(classifyGoalInterviewRound(document(2, 7), document(1, 7))).toBe('narrowed');
});

test('narrows when unresolved clarifications stay constant and persistent grounding evidence decreases', () => {
  expect(classifyGoalInterviewRound(document(1, 7), document(1, 4))).toBe('narrowed');
});

test('stalls when neither unresolved clarifications nor persistent grounding evidence decrease', () => {
  const unchanged = document(1, 4);
  expect(classifyGoalInterviewRound(unchanged, unchanged)).toBe('stalled');
  expect(classifyGoalInterviewRound(document(1, 4), document(1, 4))).toBe('stalled');
  expect(classifyGoalInterviewRound(document(1, 0), `${clarification('open-0')}\nNo persistent grounding evidence section.`)).toBe('stalled');
});

test('collects Markdown goal-author documents in a closure', () => {
  const root = mkdtempSync(join(tmpdir(), 'goal-author-closure-'));
  const goals = join(root, 'docs', 'goals');
  mkdirSync(goals, { recursive: true });
  try {
    writeFileSync(join(goals, 'GOAL-parent.md'), document(0, 1));
    writeFileSync(join(goals, 'GOAL-child.md'), `${document(1, 1)}\n- Parent: {"goalFile":"docs/goals/GOAL-parent.md","questionId":"parent-question"}`);
    writeFileSync(join(goals, 'GOAL-ignored.json'), document(1, 1));

    expect(collectGoalClarificationClosure('docs/goals/GOAL-parent.md', goals)).toEqual({
      start: { path: 'docs/goals/GOAL-parent.md', pending: 0 },
      descendants: [{ path: 'docs/goals/GOAL-child.md', pending: 1 }],
      documents: 2,
      pending: 1,
      status: 'open',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
