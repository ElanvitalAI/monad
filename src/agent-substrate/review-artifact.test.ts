import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { persistReviewArtifact } from './review-artifact.js';

function persistAndRead(input: Parameters<typeof persistReviewArtifact>[0]): string {
  const artifact = persistReviewArtifact(input);
  try {
    return readFileSync(artifact.path, 'utf8');
  } finally {
    rmSync(artifact.path, { force: true });
    rmSync(`${artifact.path}.meta.json`, { force: true });
  }
}

describe('persistReviewArtifact', () => {
  test('persists a supplied goalFile verbatim after the existing review fields', () => {
    const goalFile = './docs/goals/../goals/GOAL-review-artifact.txt';
    const body = persistAndRead({
      origin: 'review-artifact-goal-file',
      runId: 'run-1',
      round: 1,
      verdict: 'warn',
      findings: ['finding'],
      mustFix: ['must fix'],
      shouldFix: ['should fix'],
      summary: 'summary',
      goalFile,
    });

    expect(JSON.parse(body)).toEqual({
      runId: 'run-1',
      round: 1,
      verdict: 'warn',
      findings: ['finding'],
      mustFix: ['must fix'],
      shouldFix: ['should fix'],
      summary: 'summary',
      goalFile,
    });
    expect(body).toBe(JSON.stringify({
      runId: 'run-1',
      round: 1,
      verdict: 'warn',
      findings: ['finding'],
      mustFix: ['must fix'],
      shouldFix: ['should fix'],
      summary: 'summary',
      goalFile,
    }, null, 2));
  });

  test('omits goalFile entirely when it is unavailable', () => {
    const body = persistAndRead({
      origin: 'review-artifact-no-goal-file',
      runId: 'run-1',
      round: 1,
      verdict: 'warn',
      findings: ['finding'],
      mustFix: ['must fix'],
      shouldFix: ['should fix'],
      summary: 'summary',
    });

    expect(JSON.parse(body)).toEqual({
      runId: 'run-1',
      round: 1,
      verdict: 'warn',
      findings: ['finding'],
      mustFix: ['must fix'],
      shouldFix: ['should fix'],
      summary: 'summary',
    });
    expect(body).toBe(JSON.stringify({
      runId: 'run-1',
      round: 1,
      verdict: 'warn',
      findings: ['finding'],
      mustFix: ['must fix'],
      shouldFix: ['should fix'],
      summary: 'summary',
    }, null, 2));
  });
});
