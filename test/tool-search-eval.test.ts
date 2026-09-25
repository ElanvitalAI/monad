import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSearchEvalFixture,
  renderSearchEvalMarkdown,
  runSearchEval,
} from '../src/tool-search-eval.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'tool-search-eval-test-'));
}

describe('tool-search-eval fixture', () => {
  test('generates scenarios with known truth sets', () => {
    const dir = tmp();
    try {
      const fixture = createSearchEvalFixture(dir, { complexity: 'small' });
      expect(fixture.scenarios.map(s => s.id)).toEqual(['console_call', 'await_fetch']);
      expect(fixture.fileCount).toBe(24);
      for (const scenario of fixture.scenarios) {
        expect(scenario.truth.size).toBe(4);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('compares rg and ast-grep against the same ground truth', async () => {
    const result = await runSearchEval({ complexity: 'small' });
    const rgConsole = result.metrics.find(m => m.engine === 'rg' && m.scenarioId === 'console_call');
    const astConsole = result.metrics.find(m => m.engine === 'ast-grep' && m.scenarioId === 'console_call');

    expect(rgConsole).toBeTruthy();
    expect(rgConsole!.truePositives).toBe(4);
    expect(rgConsole!.falsePositives).toBeGreaterThan(0);

    if (astConsole?.available) {
      expect(astConsole.truePositives).toBe(4);
      expect(astConsole.falsePositives).toBe(0);
      expect(astConsole.precision).toBe(1);
    }
  });

  test('renders markdown summary', async () => {
    const result = await runSearchEval({ complexity: 'small' });
    const md = renderSearchEvalMarkdown(result);
    expect(md).toContain('# Search Tool Evaluation');
    expect(md).toContain('| scenario | engine |');
    expect(md).toContain('console_call');
    expect(md).toContain('await_fetch');
  });
});
