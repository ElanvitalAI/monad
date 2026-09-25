import { expect, test } from 'bun:test';
import { goalFileName } from './goal-author.js';
import { GOAL_DOCUMENT_EXTENSIONS, isGoalAuthorFileName, isGoalDocumentFileName } from './goal-document.js';

test('shares the legacy and author-produced goal document extensions', () => {
  const authored = goalFileName({ title: 'shared corpus extension', document: 'document' }, new Date('2026-08-09T00:00:00.000Z'));

  expect(GOAL_DOCUMENT_EXTENSIONS).toEqual(['.txt', '.md']);
  expect(isGoalDocumentFileName('legacy-goal.txt')).toBe(true);
  expect(isGoalDocumentFileName(authored)).toBe(true);
  expect(isGoalAuthorFileName(authored)).toBe(true);
  expect(isGoalAuthorFileName('goal-without-prefix.md')).toBe(false);
  expect(isGoalDocumentFileName('GOAL-not-a-document.json')).toBe(false);
});
