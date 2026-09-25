import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGoalTestScenario, renderGoalTestScenarioQuery, sampleGoalTestScenarios } from './goal-test-scenarios.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createGoalDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'goal-test-scenarios-'));
  directories.push(directory);
  return directory;
}

function writeGoal(directory: string, name: string, document: string, modifiedAt: string): string {
  const path = join(directory, name);
  writeFileSync(path, document);
  const timestamp = new Date(modifiedAt);
  utimesSync(path, timestamp, timestamp);
  return path;
}

describe('goal test scenario sampling', () => {
  test('extracts only the exact H2 while distinguishing a missing section from an empty section', () => {
    expect(extractGoalTestScenario('## 검증 시나리오\nkept\n\n## Next\nignored')).toBe('kept\n');
    expect(extractGoalTestScenario('## 검증 시나리오 extra\nwrong')).toBeNull();
    expect(extractGoalTestScenario('## 검증 시나리오\n## Next')).toBe('');
    expect(extractGoalTestScenario('## Other\nbody')).toBeNull();
  });

  test('samples newest documents first, preserves content, applies limits, and counts present sections', () => {
    const directory = createGoalDirectory();
    const oldPath = writeGoal(directory, 'GOAL-old.md', '---\n- GoalId: 0000000000000001\n## 검증 시나리오\nold content\n', '2026-01-01T00:00:00.000Z');
    const emptyPath = writeGoal(directory, 'GOAL-empty.md', '---\n- GoalId: 0000000000000002\n## 검증 시나리오\n## Later\n', '2026-01-02T00:00:00.000Z');
    const missingPath = writeGoal(directory, 'GOAL-missing.md', '---\n- GoalId: 0000000000000003\n## Other\nno scenario\n', '2026-01-03T00:00:00.000Z');

    const query = sampleGoalTestScenarios(directory, 2);

    expect(query).toEqual({
      viewedGoalCount: 2,
      sectionPresentCount: 1,
      samples: [
        { path: missingPath, goalId: '0000000000000003', scenario: null },
        { path: emptyPath, goalId: '0000000000000002', scenario: '' },
      ],
    });
    expect(sampleGoalTestScenarios(directory, 3).samples.at(-1)).toEqual({ path: oldPath, goalId: '0000000000000001', scenario: 'old content\n' });
    expect(renderGoalTestScenarioQuery(query)).toBe([
      'summary: 2 goal documents viewed; 1 with ## 검증 시나리오',
      '0000000000000003 · ' + missingPath + '\n검증 시나리오: 없음',
      '0000000000000002 · ' + emptyPath + '\n검증 시나리오: 비어 있음',
    ].join('\n\n'));
  });
});
