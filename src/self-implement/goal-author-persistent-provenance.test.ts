import { describe, expect, spyOn, test } from 'bun:test';

import type { CodebaseGrounding } from '../autopilot/mission-codebase-gate.js';
import { debug } from '../debug/log.js';
import { authorGoal, type GoalAuthorDeps } from './goal-author.js';

const ask = '대상 경로: src/self-implement/goal-author.ts\n\n지속 접지 근거 출처 계약을 검사한다.';

const baseFacts: CodebaseGrounding = {
  grounded: true,
  context: '',
  files: ['src/self-implement/goal-author.ts'],
  persistentEvidence: [],
  codeFacts: [],
  skillFacts: [],
  memoryFacts: [],
  documentFacts: [],
  refFacts: [],
  ptyFacts: [],
};

const deps: GoalAuthorDeps = {
  ground: async () => baseFacts,
  enhance: async (original) => ({ original, checklist: [], verbatimPreserved: true }),
  slugFn: async () => 'persistent-provenance',
};

function tracedPaths(document: string): string {
  return document.slice(document.indexOf('## TRACED PATHS'), document.indexOf('## SCOPE BOUNDARY'));
}

describe('goal author persistent grounding provenance', () => {
  test('renders distinct code and memory labels, preserves unknown evidence, retains the heading, and observes each source count', async () => {
    const log = spyOn(debug, 'log').mockImplementation(() => undefined);
    const codeEvidence = 'src/self-implement/goal-author.ts:1824 — renderer preserves source labels.';
    const memoryEvidence = 'memory://goal-author — prior incident is retained independently.';
    const unknownEvidence = 'opaque://persistent-evidence — source association is unavailable.';

    try {
      const authored = await authorGoal(ask, {
        ...deps,
        ground: async () => ({
          ...baseFacts,
          persistentEvidence: [codeEvidence, memoryEvidence, unknownEvidence],
          persistentEvidenceItems: [
            { text: codeEvidence, sourceKind: 'code' },
            { text: memoryEvidence, sourceKind: 'memory' },
            { text: unknownEvidence },
          ],
        }),
      });

      expect(authored.document).toContain('Persistent grounding evidence is listed in the traced-path section below.');
      expect(tracedPaths(authored.document)).toBe(
        `## TRACED PATHS\n1. [code] ${codeEvidence}\n2. [memory] ${memoryEvidence}\n3. [unknown] ${unknownEvidence}\n\n`,
      );
      expect(log).toHaveBeenCalledWith('goal-author', 'persistent-grounding-evidence-source-count', {
        authorRunId: expect.any(String),
        counts: { code: 1, skill: 0, memory: 1, doc: 0, pty: 0, unknown: 1 },
      });
    } finally {
      log.mockRestore();
    }
  });

  test('preserves the no-persistent-evidence fallback text', async () => {
    const authored = await authorGoal(ask, {
      ...deps,
      ground: async () => ({ ...baseFacts, grounded: false, files: [] }),
    });

    expect(tracedPaths(authored.document)).toBe(
      '## TRACED PATHS\n- Evidence unavailable — grounding found no persistent evidence and the cause remains undifferentiated. Grounding needs behavior and causation, not only locations: state what the target code does today and why that is a problem, and name a function, constant, or type that the target file exports. A pure-addition ask ("also record field X") often fails here because it names no current behavior to ground. Re-authoring the same input may also produce different evidence, but try that first. See docs/manual/MANUAL-goal-authoring-method-2026-08-03.md\n\n',
    );
  });
});
