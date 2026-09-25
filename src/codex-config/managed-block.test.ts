// PLAN-codex-app-server-hermes-parity §5 Phase H3·1 test —
// regenerateManagedBlock + removeManagedBlock. User-content byte-
// preservation is the critical invariant.

import { describe, test, expect } from 'bun:test';
import {
  regenerateManagedBlock,
  removeManagedBlock,
  MARKER_START,
  MARKER_END,
} from './managed-block.js';

const USER_TOML = `model = "gpt-5.4"

[projects."/Users/example/.config"]
trust_level = "trusted"

[projects."/Users/example/source/axon/monad-agent"]
trust_level = "trusted"
`;

describe('regenerateManagedBlock · first write', () => {
  test('appends block to existing user content with separator', () => {
    const r = regenerateManagedBlock(USER_TOML, 'foo = "bar"');
    expect(r.replaced).toBe(false);
    expect(r.content.startsWith(USER_TOML.replace(/\n+$/, ''))).toBe(true);
    expect(r.content).toContain(MARKER_START);
    expect(r.content).toContain('foo = "bar"');
    expect(r.content).toContain(MARKER_END);
    expect(r.content).toMatch(/\n\n# managed by monad-agent/);
  });

  test('produces no leading newline when input is empty', () => {
    const r = regenerateManagedBlock('', 'foo = "bar"');
    expect(r.replaced).toBe(false);
    expect(r.content.startsWith(MARKER_START)).toBe(true);
  });

  test('normalizes trailing newlines in body', () => {
    const r = regenerateManagedBlock('', 'foo = "bar"\n\n\n');
    const expected = `${MARKER_START}\nfoo = "bar"\n${MARKER_END}\n`;
    expect(r.content).toBe(expected);
  });
});

describe('regenerateManagedBlock · in-place replace', () => {
  test('replaces existing managed section', () => {
    const first = regenerateManagedBlock(USER_TOML, 'foo = "old"').content;
    const second = regenerateManagedBlock(first, 'foo = "new"');
    expect(second.replaced).toBe(true);
    expect(second.content).toContain('foo = "new"');
    expect(second.content).not.toContain('foo = "old"');
    // user content survives both edits
    expect(second.content).toContain('model = "gpt-5.4"');
    expect(second.content).toContain('trust_level = "trusted"');
  });

  test('idempotent re-run with same body returns same bytes', () => {
    const a = regenerateManagedBlock(USER_TOML, 'foo = "bar"').content;
    const b = regenerateManagedBlock(a, 'foo = "bar"').content;
    expect(b).toBe(a);
  });

  test('preserves byte-identical user content outside markers', () => {
    const exotic = `# user comment with tabs\t\t\nmodel = "x"\n\n  trailing-spaces  \n`;
    const r = regenerateManagedBlock(exotic + '\n', 'foo = "bar"');
    const before = r.content.slice(0, r.content.indexOf(MARKER_START)).replace(/\n+$/, '');
    expect(before).toBe(exotic.replace(/\n+$/, ''));
  });

  test('preserves content AFTER the managed section', () => {
    const withTrailing =
      `${MARKER_START}\nfoo = "old"\n${MARKER_END}\n\n# user comment after\nbar = "baz"\n`;
    const r = regenerateManagedBlock(withTrailing, 'foo = "new"');
    expect(r.content).toContain('# user comment after');
    expect(r.content).toContain('bar = "baz"');
  });
});

describe('regenerateManagedBlock · malformed markers', () => {
  test('start without end → treats as no managed section + appends', () => {
    const broken = `model = "x"\n${MARKER_START}\nstuff\n`;
    const r = regenerateManagedBlock(broken, 'foo = "bar"');
    expect(r.replaced).toBe(false);
    // appended section is at the end
    expect(r.content.endsWith(`${MARKER_END}\n`)).toBe(true);
  });

  test('end before start → no replace', () => {
    const broken = `${MARKER_END}\nfoo = "bar"\n${MARKER_START}\n`;
    const r = regenerateManagedBlock(broken, 'foo = "new"');
    expect(r.replaced).toBe(false);
  });
});

describe('removeManagedBlock', () => {
  test('strips the section + reports removed: true', () => {
    const withBlock = regenerateManagedBlock(USER_TOML, 'foo = "bar"').content;
    const r = removeManagedBlock(withBlock);
    expect(r.removed).toBe(true);
    expect(r.content).not.toContain(MARKER_START);
    expect(r.content).not.toContain('foo = "bar"');
    expect(r.content).toContain('model = "gpt-5.4"');
    expect(r.content).toContain('trust_level = "trusted"');
  });

  test('returns input unchanged when no markers', () => {
    const r = removeManagedBlock(USER_TOML);
    expect(r.removed).toBe(false);
    expect(r.content).toBe(USER_TOML);
  });

  test('handles managed-only file (no user content)', () => {
    const onlyBlock = regenerateManagedBlock('', 'foo = "bar"').content;
    const r = removeManagedBlock(onlyBlock);
    expect(r.removed).toBe(true);
    expect(r.content.trim()).toBe('');
  });
});
