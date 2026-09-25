import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { markdownSection, parseGoalId, TEST_SCENARIO_SECTION_TITLES } from './goal-author.js';

const TEST_SCENARIO_SECTION_TITLE = TEST_SCENARIO_SECTION_TITLES[0].replace(/^##\s+/, '');

export interface GoalTestScenarioSample {
  readonly path: string;
  readonly goalId: string | null;
  /** null means the H2 is absent; an empty string means the H2 exists but has no body. */
  readonly scenario: string | null;
}

export interface GoalTestScenarioQuery {
  readonly viewedGoalCount: number;
  readonly sectionPresentCount: number;
  readonly samples: readonly GoalTestScenarioSample[];
}

export function extractGoalTestScenario(document: string): string | null {
  return markdownSection(document, TEST_SCENARIO_SECTION_TITLE);
}

function newestGoalPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^GOAL-.*\.md$/.test(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name);
      return { path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path))
    .map(({ path }) => path);
}

export function sampleGoalTestScenarios(directory: string, limit: number): GoalTestScenarioQuery {
  const paths = newestGoalPaths(directory).slice(0, limit);
  const samples = paths.map((path) => {
    const document = readFileSync(path, 'utf8');
    return {
      path,
      goalId: parseGoalId(document) ?? null,
      scenario: extractGoalTestScenario(document),
    };
  });
  return {
    viewedGoalCount: samples.length,
    sectionPresentCount: samples.filter((sample) => sample.scenario !== null).length,
    samples,
  };
}

export function renderGoalTestScenarioQuery(query: GoalTestScenarioQuery): string {
  const summary = `summary: ${query.viewedGoalCount} goal documents viewed; ${query.sectionPresentCount} with ${TEST_SCENARIO_SECTION_TITLES[0]}`;
  if (query.samples.length === 0) return summary;
  return [
    summary,
    ...query.samples.map((sample) => [
      `${sample.goalId ?? 'unknown GoalId'} · ${sample.path}`,
      sample.scenario === null ? '검증 시나리오: 없음' : sample.scenario === '' ? '검증 시나리오: 비어 있음' : `검증 시나리오:\n${sample.scenario}`,
    ].join('\n')),
  ].join('\n\n');
}
