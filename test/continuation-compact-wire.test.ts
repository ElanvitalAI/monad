// ── Source-grep guard for the §5-⑤ continuation auto-compaction wire ──
//
// Single-purpose: assert that `makeContinuationRunTurn` actually invokes
// `compactSessionHistory` on the continuation session BEFORE each turn,
// gated by `chat.autoCompact`. The compact substrate (Phase A) is fully
// unit-tested in test/compact-session.test.ts, but per memory
// `feedback_dep_inject_seam_must_be_wired` + `feedback_source_level_grep_
// test_value`: a dep-inject seam that no production caller invokes is
// dead — and a unit-tested pipeline plus a green build can both pass
// while this wire is silently dropped in a refactor, leaving the
// autonomous loop reloading an unbounded history forever.
//
// If the wire legitimately moves, update the regexes + leave a pointer.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const src = readFileSync(join(REPO_ROOT, 'src/dispatch/continuation-turn-runner.ts'), 'utf-8');

describe('continuation-turn-runner §5-⑤ auto-compaction wire', () => {
  test('imports compactSessionHistory from the session compact module', () => {
    expect(src).toMatch(
      /import\s+\{\s*compactSessionHistory\s*\}\s+from\s+['"][^'"]*session\/compact-session(\.js)?['"]/,
    );
  });

  test('invokes compactSessionHistory on the continuation session', () => {
    expect(src).toMatch(/compactSessionHistory\(\s*session\.id\s*,/);
  });

  test('gated by chat.autoCompact.enabled', () => {
    expect(src).toMatch(/autoCompact\?\.enabled/);
    expect(src).toMatch(/cfg\.chat\?\.autoCompact/);
  });

  test('resolves the active model id for context-window inference', () => {
    expect(src).toMatch(/cfg\.llm\?\.model\s*\?\?\s*getProviderForConfig\(cfg\)\.defaultModel/);
    expect(src).toMatch(/compactSessionHistory\([^)]*\{[^}]*modelId[^}]*config:\s*autoCompact/s);
  });

  test('compaction precedes the turn — compact call appears before runTurn', () => {
    const compactAt = src.indexOf('compactSessionHistory(session.id');
    const runTurnAt = src.indexOf('await runTurn({');
    expect(compactAt).toBeGreaterThan(-1);
    expect(runTurnAt).toBeGreaterThan(-1);
    expect(compactAt).toBeLessThan(runTurnAt);
  });

  test('compaction is best-effort — wrapped so a failure never breaks the turn', () => {
    // The compact call sits inside a try/catch above the runTurn call.
    const guard = src.slice(src.indexOf('if (autoCompact?.enabled)'), src.indexOf('await runTurn({'));
    expect(guard).toContain('try {');
    expect(guard).toMatch(/catch\s*\(/);
  });
});
