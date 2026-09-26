import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorGoal, type GoalAuthorDeps } from './goal-author.js';
import { targetScopedGoalText } from './goal-text-path-scope.js';
import { inferDecompositionShadow } from './orchestrator.js';

const TARGET_AND_METADATA = [
  '대상 경로: src/onboarding/non-interactive.ts',
  '경계: 데몬 셋업 게이트(src/nexus/setup-status.ts)는 이 골이 아니다',
  '- UNVERIFIABLE: corrected example: src/example.ts',
  '출처: docs/RFC-first-run.md',
  '- Command help probe: no inline bun bin/elanous.mjs command was named',
].join('\n');

const authorDeps: GoalAuthorDeps = {
  ground: async () => ({
    grounded: true,
    context: '',
    files: [],
    codeFacts: [],
    skillFacts: [],
    memoryFacts: [],
    documentFacts: [],
    refFacts: [],
    ptyFacts: [],
  }),
  enhance: async (original) => ({ original, checklist: [], verbatimPreserved: true }),
  slugFn: async () => 'target-scoped-paths',
};

describe('targetScopedGoalText', () => {
  test('excludes boundary, diagnostic, source, and guidance path lines with markdown markers', () => {
    const text = [
      '  - 경계: src/boundary.ts',
      '> Boundary decision: src/decision.ts',
      '- ⭐ 결정 1: src/star.ts',
      '- ⛔ 결정 2: src/stop.ts',
      '- ⏸️ 결정 3: src/pause.ts',
      '  - UNVERIFIABLE: src/diagnostic.ts',
      '> 출처: docs/source.md',
      '- Command help probe: bin/elanous.mjs',
      '  - Scope-boundary candidates: src/candidate.ts',
      '> If adopted, state each boundary: src/guidance.ts',
      'Implement src/kept.ts',
    ].join('\n');

    expect(targetScopedGoalText(text)).toBe('Implement src/kept.ts');
  });

  test('removes marker combinations and normalized SCOPE BOUNDARY headings only until the next heading', () => {
    const text = [
      '> - 경계: src/out.ts',
      '  > ## SCOPE BOUNDARY',
      '> - Boundary decision: src/a.ts 는 안 만진다',
      '  > ## Answer',
      '- src/b.ts 는 남긴다',
    ].join('\n');

    expect(targetScopedGoalText(text)).toBe('  > ## Answer\n- src/b.ts 는 남긴다');
  });

  test('preserves CRLF and mixed line endings for retained text', () => {
    const unchanged = '## Answer\r\n⑴ src/c.ts 를 고친다\r\n';
    const mixed = 'src/kept-a.ts\r\n> - 경계: src/out.ts\nsrc/kept-b.ts\r';

    expect(targetScopedGoalText(unchanged)).toBe(unchanged);
    expect(targetScopedGoalText(mixed)).toBe('src/kept-a.ts\r\nsrc/kept-b.ts\r');
  });

  test('preserves ordinary target text unchanged', () => {
    const text = '## Answer\n⑴ src/c.ts 를 고친다';

    expect(targetScopedGoalText(text)).toBe(text);
  });

  test('scopes decomposition fallback paths to implementation targets', () => {
    expect(inferDecompositionShadow(TARGET_AND_METADATA)).toMatchObject({
      candidatePieceCount: 1,
      paths: ['src/onboarding/non-interactive.ts'],
    });
  });

  test('prevents excluded metadata paths from becoming new implementation targets', async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'goal-text-path-scope-'));
    try {
      const authored = await authorGoal(`${TARGET_AND_METADATA}\nImplement src/new-target.ts`, {
        ...authorDeps,
        ground: async () => ({
          grounded: true,
          context: '',
          files: ['src/onboarding/non-interactive.ts'],
          codeFacts: [],
          skillFacts: [],
          memoryFacts: [],
          documentFacts: [],
          refFacts: [],
          ptyFacts: [],
        }),
        repositoryRoot: realpathSync(repositoryRoot),
      });

      expect(authored.document).toContain('- Implementation target is a new repository file: src/new-target.ts');
      expect(authored.document).not.toContain('new repository file: src/nexus/setup-status.ts');
      expect(authored.document).not.toContain('new repository file: src/example.ts');
      expect(authored.document).not.toContain('new repository file: docs/RFC-first-run.md');
      expect(authored.document).not.toContain('new repository file: bin/elanous.mjs');
    } finally {
      rmSync(repositoryRoot, { force: true, recursive: true });
    }
  });

  test('keeps removing the English scope metadata labels from the first landed piece', () => {
    const text = [
      'Implement src/kept.ts.',
      '  - > - Excluded boundary: src/excluded.ts',
      '> > Boundary decision: keep src/decided.ts unchanged',
      '  - Diagnostic: target candidates were inferred',
      'Verify src/kept.test.ts.',
    ].join('\n');

    expect(targetScopedGoalText(text)).toBe('Implement src/kept.ts.\nVerify src/kept.test.ts.');
  });

  test('preserves target text that merely mentions scope metadata away from a normalized line start', () => {
    const text = [
      'Decision signal: src/kept.ts must pass.',
      'The diagnostic output mentions src/kept.test.ts.',
      'Boundary decisions are recorded in src/kept.ts.',
    ].join('\r\n');

    expect(targetScopedGoalText(text)).toBe(text);
  });
});
