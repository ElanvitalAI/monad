// ── B4 — the panel's projection is where the third state is born ──
//
// The daemon sends three lists; the panel shows three states. The interesting
// one is `available` — a rulebook monad ships that the DESIGN.md has NOT
// declared. The CLI cannot show it (it prints only declared + unavailable),
// so this projection is the surface's own contribution, not a re-render.
//
// These tests are pure: no react-query, no DOM. The panel is then a paint of
// whatever this returns, which keeps the interesting logic testable.

import { describe, expect, test } from 'bun:test';
import { projectRulebookRows, describeBlocked } from './use-design-check';

describe('projectRulebookRows', () => {
  test('splits shipped-but-undeclared out as its own state', () => {
    const rows = projectRulebookRows({
      declaredRulebooks: ['color'],
      unavailableRulebooks: [],
      availableRulebooks: ['color', 'typography'],
    });
    expect(rows).toEqual([
      { name: 'color', status: 'declared' },
      { name: 'typography', status: 'available' },
    ]);
  });

  test('a declared name that is also shipped reads as declared, not available', () => {
    // Both lists contain it. If `available` won, every healthy rulebook would
    // render as "not declared" — the panel would be exactly wrong.
    const rows = projectRulebookRows({
      declaredRulebooks: ['color'],
      unavailableRulebooks: [],
      availableRulebooks: ['color'],
    });
    expect(rows).toEqual([{ name: 'color', status: 'declared' }]);
  });

  test('missing rulebooks sort FIRST, ahead of alphabetical order', () => {
    // `zeta` is missing and sorts last alphabetically. Severity has to beat
    // the name, or the one row a human opened the panel for gets buried.
    const rows = projectRulebookRows({
      declaredRulebooks: ['alpha', 'zeta'],
      unavailableRulebooks: ['zeta'],
      availableRulebooks: ['alpha', 'beta'],
    });
    expect(rows.map((r) => `${r.status}:${r.name}`)).toEqual([
      'missing:zeta',
      'declared:alpha',
      'available:beta',
    ]);
  });

  test('names are de-duplicated across the three lists', () => {
    const rows = projectRulebookRows({
      declaredRulebooks: ['color', 'color'],
      unavailableRulebooks: [],
      availableRulebooks: ['color'],
    });
    expect(rows).toHaveLength(1);
  });

  test('empty everywhere yields no rows rather than throwing', () => {
    expect(projectRulebookRows({
      declaredRulebooks: [], unavailableRulebooks: [], availableRulebooks: [],
    })).toEqual([]);
  });
});

describe('describeBlocked', () => {
  test('no-repository does NOT mention a missing file', () => {
    const message = describeBlocked('no-repository', null);
    // The failure mode this guards: telling an operator whose daemon simply
    // runs outside a checkout to go look for a DESIGN.md that was never
    // supposed to exist.
    expect(message).toContain('not running inside a git checkout');
    expect(message).not.toContain('DESIGN.md:');
  });

  test('the two read failures each name their own path', () => {
    expect(describeBlocked('craft-directory', '/monad/docs/design/craft'))
      .toContain('/monad/docs/design/craft');
    expect(describeBlocked('design-document', '/work/project/DESIGN.md'))
      .toContain('/work/project/DESIGN.md');
  });

  test('the two read failures produce DIFFERENT sentences', () => {
    // They arrive with the same exitCode; if the copy were shared the panel
    // would hand the reader back the ambiguity the endpoint just removed.
    expect(describeBlocked('craft-directory', '/a'))
      .not.toBe(describeBlocked('design-document', '/a'));
  });

  test('an unknown reason still names itself instead of going generic', () => {
    expect(describeBlocked('some-future-reason', null)).toContain('some-future-reason');
  });
});
