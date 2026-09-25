// PR-Δ23 (Sprint 16 · 2026-04-30 · F10) — fuzzy picker tests.
//
// chooseFrom's numbered fallback gains a substring filter mode when
// the option count crosses `fuzzyThreshold` (default 10). Lets users
// narrow a long picker list (codex models · skill catalogs) without
// scrolling. Numbered + key-letter shortcuts continue to work on the
// FULL list (so `1` always picks the first original option even
// after a filter narrows the visible set).

import { describe, expect, test } from 'bun:test';
import {
  chooseFrom,
  fuzzyFilter,
  type ChoiceOption,
} from '../src/onboarding/io-extended';
import { scriptedIO } from '../src/onboarding';

function buildLongOptions(count: number): ChoiceOption<string>[] {
  const out: ChoiceOption<string>[] = [];
  const flavors = ['claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus', 'claude-4-haiku', 'claude-4-sonnet', 'gpt-4o', 'gpt-4o-mini', 'o1-preview', 'gemini-1.5-flash', 'gemini-1.5-pro', 'grok-2', 'mistral-large'];
  for (let i = 0; i < count; i++) {
    const label = flavors[i % flavors.length] + (i >= flavors.length ? `-v${Math.floor(i / flavors.length)}` : '');
    out.push({ key: String(i + 1), label, value: label });
  }
  return out;
}

describe('Δ23 · fuzzyFilter primitive', () => {
  test('empty query returns input unchanged', () => {
    const opts = buildLongOptions(3);
    expect(fuzzyFilter(opts, '')).toEqual(opts);
    expect(fuzzyFilter(opts, '   ')).toEqual(opts);
  });

  test('case-insensitive substring across label / key / description', () => {
    const opts: ChoiceOption<string>[] = [
      { key: '1', label: 'Claude Haiku', value: 'haiku', description: 'fast + cheap' },
      { key: '2', label: 'Claude Sonnet', value: 'sonnet', description: 'balanced' },
      { key: '3', label: 'GPT-4o', value: 'gpt', description: 'OpenAI flagship' },
    ];
    expect(fuzzyFilter(opts, 'claude').map(o => o.value)).toEqual(['haiku', 'sonnet']);
    expect(fuzzyFilter(opts, 'CHEAP').map(o => o.value)).toEqual(['haiku']);   // description match
    expect(fuzzyFilter(opts, 'gpt').map(o => o.value)).toEqual(['gpt']);
  });

  test('returns empty array on no match', () => {
    const opts = buildLongOptions(3);
    expect(fuzzyFilter(opts, 'no-such-thing')).toEqual([]);
  });
});

describe('Δ23 · chooseFrom fuzzy mode (option count ≥ threshold)', () => {
  test('typing a unique substring auto-selects the matching option', async () => {
    const opts = buildLongOptions(20);
    const io = scriptedIO(['mistral']);
    const result = await chooseFrom(io, 'Pick a model:', opts);
    expect(result).toContain('mistral-large');
    expect(io.outputs.some(o => /auto-selected/.test(o))).toBe(true);
  });

  test('typing a substring with multiple matches narrows + re-prompts', async () => {
    const opts = buildLongOptions(20);
    // First input: 'claude' → multiple matches. Second input: '1' picks
    // the first option of the ORIGINAL list (claude-3-haiku at idx 0).
    const io = scriptedIO(['claude', '1']);
    const result = await chooseFrom(io, 'Pick a model:', opts);
    expect(result).toBe('claude-3-haiku');
    // Narrowed list message printed.
    expect(io.outputs.some(o => /matches for "claude"/.test(o))).toBe(true);
  });

  test('no-match input prints warning + re-shows full list', async () => {
    const opts = buildLongOptions(15);
    const io = scriptedIO(['no-such-thing', '2']);
    const result = await chooseFrom(io, 'Pick:', opts);
    expect(result).toBe(opts[1]!.value);
    expect(io.outputs.some(o => /no match for "no-such-thing"/.test(o))).toBe(true);
  });

  test('numeric pick still works in fuzzy mode (full-list index)', async () => {
    const opts = buildLongOptions(15);
    const io = scriptedIO(['7']);
    const result = await chooseFrom(io, 'Pick:', opts);
    expect(result).toBe(opts[6]!.value);
  });

  test('blank Enter still picks the default', async () => {
    const opts = buildLongOptions(15);
    const io = scriptedIO(['']);
    const result = await chooseFrom(io, 'Pick:', opts, { defaultIndex: 4 });
    expect(result).toBe(opts[4]!.value);
  });

  test('threshold gates the mode — short lists keep legacy invalid-choice text', async () => {
    const opts = buildLongOptions(3);          // < default threshold 10
    const io = scriptedIO(['claude', '1']);
    const result = await chooseFrom(io, 'Pick:', opts);
    expect(result).toBe(opts[0]!.value);
    // Legacy invalid-choice path was used for "claude" (no fuzzy hint).
    expect(io.outputs.some(o => /invalid choice/.test(o))).toBe(true);
    // No fuzzy "matches for" message.
    expect(io.outputs.some(o => /matches for "claude"/.test(o))).toBe(false);
  });

  test('explicit fuzzyThreshold: Infinity disables the mode even for long lists', async () => {
    const opts = buildLongOptions(20);
    const io = scriptedIO(['claude', '1']);
    const result = await chooseFrom(io, 'Pick:', opts, { fuzzyThreshold: Infinity });
    expect(result).toBe(opts[0]!.value);
    expect(io.outputs.some(o => /invalid choice/.test(o))).toBe(true);
  });
});
