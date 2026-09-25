// ── B4 선결 — the design-check verdict is DATA, and says why it is blocked ──
//
// `runRepositoryDesignCheck` used to fold three different facts into one
// number: "declared these", "these are missing", and "I could not read a
// path". A renderer that only sees an exit code cannot tell "no rulebooks are
// missing" from "the directory was unreadable" — both are just a list it never
// received. These tests pin the distinction that makes rendering possible.

import { describe, test, expect } from 'bun:test';
import { resolveDesignCheck, designCheckExitCode, type DesignCheckDeps } from './design-check';

function deps(files: Record<string, string>, dirs: Record<string, string[]>): DesignCheckDeps {
  return {
    readFile: (path) => {
      const found = files[path];
      if (found === undefined) throw new Error(`ENOENT: ${path}`);
      return found;
    },
    readdir: (path) => {
      const found = dirs[path];
      if (found === undefined) throw new Error(`ENOENT: scandir ${path}`);
      return found;
    },
  };
}

const DOC = '/repo/DESIGN.md';
const CRAFT = '/craft';

describe('resolveDesignCheck — the verdict', () => {
  test('returns declared, unavailable AND available lists', () => {
    const out = resolveDesignCheck(DOC, CRAFT, deps(
      { [DOC]: '## Craft rulebooks\n- color\n- ghost-book\n' },
      { [CRAFT]: ['color.md', 'typography.md', 'NOTICE.md'] },
    ));

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.declaredRulebooks).toEqual(['color', 'ghost-book']);
    expect(out.unavailableRulebooks).toEqual(['ghost-book']);
    // `availableRulebooks` is the field that did not exist before. Without it a
    // renderer wanting "offered but not declared" would re-scan the directory,
    // which is how the second, drifting copy of a rule gets born here.
    expect(out.availableRulebooks).toEqual(['color', 'typography']);
    expect(out.documentPath).toBe(DOC);
    expect(out.craftDirectory).toBe(CRAFT);
  });

  test('NOTICE.md is the licence record, never a rulebook', () => {
    const out = resolveDesignCheck(DOC, CRAFT, deps(
      { [DOC]: '## Craft rulebooks\n- NOTICE\n' },
      { [CRAFT]: ['NOTICE.md', 'color.md'] },
    ));
    if (!out.ok) throw new Error('unreachable');
    expect(out.availableRulebooks).not.toContain('NOTICE');
    // Declaring it must therefore READ AS MISSING, not as satisfied — a repo
    // that lists NOTICE has a broken DESIGN.md, and the verdict should say so.
    expect(out.unavailableRulebooks).toEqual(['NOTICE']);
  });

  test('the rulebook section ends at the next heading', () => {
    const out = resolveDesignCheck(DOC, CRAFT, deps(
      { [DOC]: '## Craft rulebooks\n- color\n\n## Something else\n- not-a-rulebook\n' },
      { [CRAFT]: ['color.md'] },
    ));
    if (!out.ok) throw new Error('unreachable');
    expect(out.declaredRulebooks).toEqual(['color']);
  });
});

describe('resolveDesignCheck — blocked is a VALUE, and names which read failed', () => {
  test('unreadable craft directory reports craft-directory + its path', () => {
    const out = resolveDesignCheck(DOC, CRAFT, deps({ [DOC]: '## Craft rulebooks\n- color\n' }, {}));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.blockedOn).toBe('craft-directory');
    expect(out.path).toBe(CRAFT);
  });

  test('unreadable DESIGN.md reports design-document + its path', () => {
    const out = resolveDesignCheck(DOC, CRAFT, deps({}, { [CRAFT]: ['color.md'] }));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.blockedOn).toBe('design-document');
    expect(out.path).toBe(DOC);
  });

  test('the two blocked reasons are DISTINGUISHABLE — this is the point', () => {
    const noDir = resolveDesignCheck(DOC, CRAFT, deps({ [DOC]: 'x' }, {}));
    const noDoc = resolveDesignCheck(DOC, CRAFT, deps({}, { [CRAFT]: [] }));
    if (noDir.ok || noDoc.ok) throw new Error('unreachable');
    // Both exit 1 through the CLI, which is exactly why the exit code alone
    // cannot drive a renderer: it collapses these into one state.
    expect(designCheckExitCode(noDir)).toBe(designCheckExitCode(noDoc));
    expect(noDir.blockedOn).not.toBe(noDoc.blockedOn);
  });
});

describe('designCheckExitCode', () => {
  test('0 only when a verdict exists AND nothing is missing', () => {
    const clean = resolveDesignCheck(DOC, CRAFT, deps(
      { [DOC]: '## Craft rulebooks\n- color\n' },
      { [CRAFT]: ['color.md'] },
    ));
    expect(designCheckExitCode(clean)).toBe(0);
  });

  test('1 when a declared rulebook is missing', () => {
    const missing = resolveDesignCheck(DOC, CRAFT, deps(
      { [DOC]: '## Craft rulebooks\n- ghost\n' },
      { [CRAFT]: ['color.md'] },
    ));
    expect(designCheckExitCode(missing)).toBe(1);
  });

  test('an empty craft directory is NOT the same as an unreadable one', () => {
    // Empty directory + nothing declared = a legitimate clean pass. If a future
    // change made an empty scan throw, this test goes red rather than the
    // repository silently reporting "blocked" for a healthy project.
    const empty = resolveDesignCheck(DOC, CRAFT, deps({ [DOC]: 'no section here' }, { [CRAFT]: [] }));
    expect(empty.ok).toBe(true);
    expect(designCheckExitCode(empty)).toBe(0);
  });
});
