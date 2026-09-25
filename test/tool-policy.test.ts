// Archon-port T1.1 (2026-05-08) — applyToolPolicy contract tests.
//
// Covers: allow-only / deny-only / both / empty allow / mcp wildcards
// / mixed mcp + exact / no-op shortcuts / back-compat alias / pure
// (no input mutation).

import { describe, it, expect } from 'bun:test';
import {
  applyToolPolicy,
  filterToolsByDeny,
  type ToolPolicy,
} from '../src/tool-runtime/tool-policy.js';

type Tool = { name: string };

const tools = (...names: string[]): Tool[] => names.map(n => ({ name: n }));

describe('applyToolPolicy', () => {
  it('returns input unchanged when policy is undefined', () => {
    const t = tools('Bash', 'Read');
    expect(applyToolPolicy(t, undefined)).toBe(t); // same ref
  });

  it('returns input unchanged when policy is empty object', () => {
    const t = tools('Bash', 'Read');
    expect(applyToolPolicy(t, {})).toBe(t);
  });

  it('returns input unchanged when allow + deny both undefined', () => {
    const t = tools('Bash', 'Read');
    expect(applyToolPolicy(t, { allow: undefined, deny: undefined })).toBe(t);
  });

  it('returns input unchanged for empty input array', () => {
    const t: Tool[] = [];
    expect(applyToolPolicy(t, { deny: ['Bash'] })).toBe(t);
  });

  it('returns input unchanged for undefined input', () => {
    expect(applyToolPolicy(undefined, { deny: ['Bash'] })).toBeUndefined();
  });

  // ── allow ───────────────────────────────────────────────────────

  it('allow with [] yields zero tools', () => {
    const t = tools('Bash', 'Read', 'Edit');
    expect(applyToolPolicy(t, { allow: [] })).toEqual([]);
  });

  it('allow keeps only matching tools', () => {
    const t = tools('Bash', 'Read', 'Edit', 'WebFetch');
    const r = applyToolPolicy(t, { allow: ['Read', 'WebFetch'] });
    expect(r?.map(x => x.name)).toEqual(['Read', 'WebFetch']);
  });

  it('allow with no matches yields empty array', () => {
    const t = tools('Bash', 'Read');
    expect(applyToolPolicy(t, { allow: ['NonExistent'] })).toEqual([]);
  });

  it('allow returns same reference when every tool matches', () => {
    const t = tools('Bash', 'Read');
    expect(applyToolPolicy(t, { allow: ['Bash', 'Read'] })).toBe(t);
  });

  // ── deny ────────────────────────────────────────────────────────

  it('deny removes matching tools (basic)', () => {
    const t = tools('Bash', 'Read', 'Edit');
    const r = applyToolPolicy(t, { deny: ['Bash'] });
    expect(r?.map(x => x.name)).toEqual(['Read', 'Edit']);
  });

  it('deny with no matches returns same reference', () => {
    const t = tools('Bash', 'Read');
    expect(applyToolPolicy(t, { deny: ['NonExistent'] })).toBe(t);
  });

  it('deny with empty array returns same reference', () => {
    const t = tools('Bash', 'Read');
    expect(applyToolPolicy(t, { deny: [] })).toBe(t);
  });

  // ── allow + deny (deny wins) ─────────────────────────────────────

  it('deny wins over allow when both match', () => {
    const t = tools('Bash', 'Read', 'Edit');
    const r = applyToolPolicy(t, {
      allow: ['Bash', 'Read'],
      deny: ['Bash'],
    });
    expect(r?.map(x => x.name)).toEqual(['Read']);
  });

  it('allow filter applies before deny', () => {
    const t = tools('A', 'B', 'C', 'D');
    const r = applyToolPolicy(t, { allow: ['A', 'B', 'C'], deny: ['C'] });
    expect(r?.map(x => x.name)).toEqual(['A', 'B']);
  });

  // ── MCP server prefix wildcards ─────────────────────────────────

  it('mcp__server (2 segments) matches whole server prefix', () => {
    const t = tools(
      'mcp__github__create_issue',
      'mcp__github__list_repos',
      'mcp__slack__send',
      'Bash',
    );
    const r = applyToolPolicy(t, { deny: ['mcp__github'] });
    expect(r?.map(x => x.name)).toEqual(['mcp__slack__send', 'Bash']);
  });

  it('mcp__server__tool (3 segments) is treated as exact name', () => {
    const t = tools(
      'mcp__github__create_issue',
      'mcp__github__list_repos',
      'Bash',
    );
    const r = applyToolPolicy(t, { deny: ['mcp__github__create_issue'] });
    expect(r?.map(x => x.name)).toEqual(['mcp__github__list_repos', 'Bash']);
  });

  it('mcp wildcard works in allow list', () => {
    const t = tools(
      'mcp__github__create_issue',
      'mcp__slack__send',
      'Bash',
    );
    const r = applyToolPolicy(t, { allow: ['mcp__github'] });
    expect(r?.map(x => x.name)).toEqual(['mcp__github__create_issue']);
  });

  it('mixed exact + mcp wildcard combine', () => {
    const t = tools(
      'mcp__github__a',
      'mcp__github__b',
      'mcp__slack__c',
      'Bash',
      'Read',
    );
    const r = applyToolPolicy(t, { allow: ['Bash', 'mcp__github'] });
    expect(r?.map(x => x.name)).toEqual([
      'mcp__github__a',
      'mcp__github__b',
      'Bash',
    ]);
  });

  // ── purity ──────────────────────────────────────────────────────

  it('does not mutate input array', () => {
    const t = tools('Bash', 'Read', 'Edit');
    const before = t.map(x => x.name);
    applyToolPolicy(t, { allow: ['Read'], deny: ['Read'] });
    expect(t.map(x => x.name)).toEqual(before);
  });

  it('skips non-string / empty entries silently', () => {
    const t = tools('Bash', 'Read');
    // Cast through unknown to test runtime tolerance — the runtime path
    // ignores typeof !== 'string' entries (callers may pass loosely-typed
    // user-config or YAML data).
    const r = applyToolPolicy(t, {
      deny: ['', 'Bash', null as unknown as string, undefined as unknown as string],
    });
    expect(r?.map(x => x.name)).toEqual(['Read']);
  });
});

describe('filterToolsByDeny (back-compat alias)', () => {
  it('matches applyToolPolicy({ deny }) semantics', () => {
    const t = tools('Bash', 'Read', 'Edit');
    expect(filterToolsByDeny(t, ['Bash'])?.map(x => x.name)).toEqual([
      'Read',
      'Edit',
    ]);
  });

  it('passes through when denyList undefined', () => {
    const t = tools('Bash', 'Read');
    expect(filterToolsByDeny(t, undefined)).toBe(t);
  });

  it('passes through when denyList empty', () => {
    const t = tools('Bash', 'Read');
    expect(filterToolsByDeny(t, [])).toBe(t);
  });

  it('handles MCP wildcards identically to applyToolPolicy', () => {
    const t = tools('mcp__a__x', 'mcp__a__y', 'mcp__b__z', 'Bash');
    const viaAlias = filterToolsByDeny(t, ['mcp__a']);
    const viaPolicy = applyToolPolicy(t, { deny: ['mcp__a'] });
    expect(viaAlias?.map(x => x.name)).toEqual(viaPolicy?.map(x => x.name));
  });
});

describe('type-level (compile-time)', () => {
  it('preserves the input element type', () => {
    type Detailed = { name: string; description: string };
    const t: Detailed[] = [
      { name: 'Bash', description: 'shell' },
      { name: 'Read', description: 'file read' },
    ];
    const r = applyToolPolicy(t, { allow: ['Bash'] });
    expect(r?.[0]?.description).toBe('shell');
    // Type narrowing — r is Detailed[] | undefined, not a {name}[]
    const _typed: Detailed[] | undefined = r;
    expect(_typed?.length).toBe(1);
  });

  it('ToolPolicy interface accepts readonly arrays', () => {
    const t = tools('A', 'B', 'C');
    const policy: ToolPolicy = {
      allow: ['A', 'B'] as const,
      deny: ['B'] as const,
    };
    const r = applyToolPolicy(t, policy);
    expect(r?.map(x => x.name)).toEqual(['A']);
  });
});
