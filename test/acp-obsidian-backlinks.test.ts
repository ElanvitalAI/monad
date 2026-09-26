// PLAN-ipad-notes-obsidian-typora §5 Phase O3·1 (2026-05-17) —
// Smoke tests for the daemon-side backlinks helper. Tests the pattern
// builder + rg integration via a tmpdir vault; the ACP method handler
// gets covered indirectly through the same path (the handler is a thin
// wrapper that calls findBacklinks).

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBacklinkPattern,
  extractHeadingAnchor,
  findBacklinks,
} from '../src/acp/obsidian-backlinks';

describe('buildBacklinkPattern', () => {
  test('escapes regex metacharacters', () => {
    expect(buildBacklinkPattern('Project (Q4)')).toContain('\\(Q4\\)');
    expect(buildBacklinkPattern('A.B')).toContain('A\\.B');
    expect(buildBacklinkPattern('Plus+Plus')).toContain('Plus\\+Plus');
  });

  test('captures plain wikilink', () => {
    const pattern = buildBacklinkPattern('Target');
    const regex = new RegExp(pattern);
    expect(regex.test('See [[Target]] for context')).toBe(true);
  });

  test('captures aliased wikilink', () => {
    const regex = new RegExp(buildBacklinkPattern('Target'));
    expect(regex.test('See [[Target|the target]]')).toBe(true);
  });

  test('captures heading-anchored wikilink', () => {
    const regex = new RegExp(buildBacklinkPattern('Target'));
    expect(regex.test('jump to [[Target#Section]]')).toBe(true);
  });

  test('captures path-prefixed wikilink', () => {
    const regex = new RegExp(buildBacklinkPattern('Target'));
    expect(regex.test('see [[Folder/Target]]')).toBe(true);
    expect(regex.test('see [[A/B/C/Target|alias]]')).toBe(true);
  });

  test('does not match unrelated wikilink', () => {
    const regex = new RegExp(buildBacklinkPattern('Target'));
    expect(regex.test('see [[Other]]')).toBe(false);
    expect(regex.test('see [[TargetSibling]]')).toBe(false);
  });

  test('rejects partial-prefix mismatches (no false positive on TargetX)', () => {
    const regex = new RegExp(buildBacklinkPattern('Target'));
    // TargetExtra would only match if the regex were unanchored on right.
    // The trailing `]]` requirement prevents that.
    expect(regex.test('see [[TargetExtra]]')).toBe(false);
  });
});

describe('findBacklinks · live rg over tmpdir vault', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'elanous-backlinks-test-'));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  test('returns matches for a target referenced from two other notes', async () => {
    writeFileSync(join(vault, 'Target.md'), '# Target\n\nstandalone\n');
    writeFileSync(join(vault, 'ReferrerA.md'), '# A\n\nrefers to [[Target]] here\n');
    writeFileSync(join(vault, 'ReferrerB.md'), '# B\n\nsee [[Target|the spec]]\n');
    writeFileSync(join(vault, 'Unrelated.md'), '# U\n\nno link\n');

    const result = await findBacklinks({ vaultRoot: vault, target: 'Target' });
    expect(result.error).toBeUndefined();
    const paths = result.matches.map((m) => m.path).sort();
    expect(paths).toEqual(['ReferrerA.md', 'ReferrerB.md']);
  });

  test('skips self-references (Target.md → [[Target]])', async () => {
    writeFileSync(join(vault, 'Target.md'), '# Target\n\nself-ref [[Target]] should not count\n');
    writeFileSync(join(vault, 'Other.md'), 'refers to [[Target]]\n');
    const result = await findBacklinks({ vaultRoot: vault, target: 'Target' });
    expect(result.error).toBeUndefined();
    expect(result.matches.map((m) => m.path)).toEqual(['Other.md']);
  });

  test('skips self-references under a subfolder (Notes/Target.md)', async () => {
    mkdirSync(join(vault, 'Notes'), { recursive: true });
    writeFileSync(join(vault, 'Notes/Target.md'), 'self [[Target]]\n');
    writeFileSync(join(vault, 'External.md'), 'see [[Target]]\n');
    const result = await findBacklinks({ vaultRoot: vault, target: 'Target' });
    expect(result.matches.map((m) => m.path).sort()).toEqual(['External.md']);
  });

  test('returns empty matches when nothing references the target', async () => {
    writeFileSync(join(vault, 'Lonely.md'), '# L\n\nno wikilinks here\n');
    const result = await findBacklinks({ vaultRoot: vault, target: 'Ghost' });
    expect(result.error).toBeUndefined();
    expect(result.matches).toEqual([]);
  });

  test('captures line number + snippet for the matching line', async () => {
    writeFileSync(
      join(vault, 'Doc.md'),
      'line 1\nline 2 with [[Target]] reference\nline 3\n',
    );
    const result = await findBacklinks({ vaultRoot: vault, target: 'Target' });
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0]!;
    expect(match.path).toBe('Doc.md');
    expect(match.lineNumber).toBe(2);
    expect(match.snippet).toContain('[[Target]]');
  });

  test('errors empty target', async () => {
    const result = await findBacklinks({ vaultRoot: vault, target: '   ' });
    expect(result.error).toBe('target-required');
    expect(result.matches).toEqual([]);
  });

  test('honors limit cap', async () => {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(vault, `R${i}.md`), `points to [[Target]]\n`);
    }
    const result = await findBacklinks({ vaultRoot: vault, target: 'Target', limit: 3 });
    expect(result.matches).toHaveLength(3);
  });

  test('regex-special target name escaped safely', async () => {
    writeFileSync(join(vault, 'Project (Q4).md'), '# project\n');
    writeFileSync(join(vault, 'Plan.md'), 'see [[Project (Q4)]] for q4 plan\n');
    const result = await findBacklinks({ vaultRoot: vault, target: 'Project (Q4)' });
    expect(result.error).toBeUndefined();
    expect(result.matches.map((m) => m.path)).toEqual(['Plan.md']);
  });

  test('rg spawn failure surfaces as rg-spawn error', async () => {
    const result = await findBacklinks({
      vaultRoot: vault,
      target: 'Target',
      rgBin: '/nonexistent/rg-bin-for-test',
    });
    expect(result.error).toContain('rg-spawn');
    expect(result.matches).toEqual([]);
  });

  // C4 (2026-05-17) — anchor surfaced in BacklinkMatch.
  test('anchor populated when source file uses [[Target#anchor]]', async () => {
    writeFileSync(join(vault, 'Target.md'), '# target\n## design-notes\n');
    writeFileSync(join(vault, 'Ref.md'), 'see [[Target#design-notes]] for details');
    const result = await findBacklinks({ vaultRoot: vault, target: 'Target' });
    const refMatch = result.matches.find(m => m.path === 'Ref.md');
    expect(refMatch?.anchor).toBe('design-notes');
  });

  test('anchor absent when source file uses plain [[Target]]', async () => {
    writeFileSync(join(vault, 'Target.md'), '# target\n');
    writeFileSync(join(vault, 'Plain.md'), 'see [[Target]] generally');
    const result = await findBacklinks({ vaultRoot: vault, target: 'Target' });
    const plainMatch = result.matches.find(m => m.path === 'Plain.md');
    expect(plainMatch?.anchor).toBeUndefined();
  });
});

// C4 (2026-05-17) — heading anchor extraction.
describe('extractHeadingAnchor', () => {
  test('plain wikilink → undefined', () => {
    expect(extractHeadingAnchor('see [[Target]]', 'Target')).toBeUndefined();
  });

  test('aliased wikilink without anchor → undefined', () => {
    expect(extractHeadingAnchor('see [[Target|alias]]', 'Target')).toBeUndefined();
  });

  test('plain heading anchor → returns slug', () => {
    expect(extractHeadingAnchor('see [[Target#design-notes]]', 'Target'))
      .toBe('design-notes');
  });

  test('heading + alias combo → returns heading slug', () => {
    expect(extractHeadingAnchor('see [[Target#api|the API section]]', 'Target'))
      .toBe('api');
  });

  test('path-prefixed wikilink + anchor', () => {
    expect(extractHeadingAnchor('see [[Folder/Target#summary]]', 'Target'))
      .toBe('summary');
  });

  test('multiple wikilinks → returns first anchor only', () => {
    expect(extractHeadingAnchor(
      'see [[Target#first]] and [[Target#second]]', 'Target',
    )).toBe('first');
  });

  test('wikilink pointing at different target → undefined', () => {
    expect(extractHeadingAnchor('see [[Other#x]]', 'Target')).toBeUndefined();
  });

  test('regex-special target name escaped safely', () => {
    expect(extractHeadingAnchor('see [[Project (Q4)#review]]', 'Project (Q4)'))
      .toBe('review');
  });
});

