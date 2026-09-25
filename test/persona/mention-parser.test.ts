// Test: src/persona/mention-parser.ts

import { describe, expect, test } from 'bun:test';
import { parseMentions, resolveMention, type PersonaSource } from '../../src/persona/mention-parser.js';
import type { PersonaProfile } from '../../src/persona/types.js';

const SAGE: PersonaProfile = Object.freeze({
  personaId: 'sage', displayName: 'Sage',
  mentionPatterns: ['@sage', 'sage,?'],
});
const PRAGMA: PersonaProfile = Object.freeze({
  personaId: 'pragmatist', displayName: 'Pragmatist',
  mentionPatterns: ['@pragmatist', '/pragma/i'],
});
const NO_PATTERNS: PersonaProfile = Object.freeze({
  personaId: 'reviewer', displayName: 'Reviewer',
  // no mentionPatterns — only default `@<personaId>`
});

function source(...ps: PersonaProfile[]): PersonaSource {
  const map = new Map<string, PersonaProfile>();
  for (const p of ps) map.set(p.personaId, p);
  return {
    list: () => Array.from(map.values()),
    get: (id) => map.get(id),
  };
}

describe('parseMentions — default pattern @<personaId>', () => {
  test('finds @sage at start', () => {
    const m = parseMentions('@sage 이거 봐줘', source(SAGE));
    expect(m).toHaveLength(1);
    expect(m[0]!.persona.personaId).toBe('sage');
    expect(m[0]!.start).toBe(0);
    expect(m[0]!.end).toBe(5);
  });

  test('case-insensitive', () => {
    const m = parseMentions('@SAGE check this', source(SAGE));
    expect(m).toHaveLength(1);
    expect(m[0]!.persona.personaId).toBe('sage');
  });

  test('no patterns persona (default only) still works', () => {
    const m = parseMentions('hey @reviewer please', source(NO_PATTERNS));
    expect(m).toHaveLength(1);
    expect(m[0]!.persona.personaId).toBe('reviewer');
  });

  test('word boundary on default pattern only — NO_PATTERNS persona', () => {
    // Default `@<personaId>\b` enforces boundary. mentionPatterns
    // (when set) are user-supplied raw regex with no boundary
    // guarantee — that's user responsibility.
    const m = parseMentions('this @reviewerbrush plant', source(NO_PATTERNS));
    expect(m).toHaveLength(0);
    const m2 = parseMentions('this @reviewer please', source(NO_PATTERNS));
    expect(m2).toHaveLength(1);
  });
});

describe('parseMentions — custom patterns', () => {
  test('literal substring matches anywhere', () => {
    const m = parseMentions('Sage, please review', source(SAGE));
    // mentionPatterns includes 'sage,?' which is escaped as a literal
    // → matches 'sage,' and 'sage'. With `@sage` default also possible.
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]!.persona.personaId).toBe('sage');
  });

  test('slash-wrapped regex pattern', () => {
    const m = parseMentions('Pragmatist views', source(PRAGMA));
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]!.persona.personaId).toBe('pragmatist');
  });
});

describe('parseMentions — multi-persona', () => {
  test('returns matches in source order', () => {
    const m = parseMentions(
      '@sage and @pragmatist both',
      source(SAGE, PRAGMA),
    );
    expect(m).toHaveLength(2);
    expect(m[0]!.persona.personaId).toBe('sage');
    expect(m[1]!.persona.personaId).toBe('pragmatist');
  });

  test('overlapping matches deduped (longest wins)', () => {
    const longer: PersonaProfile = Object.freeze({
      personaId: 'sage', displayName: 'Sage',
      mentionPatterns: ['@sage analyzer'],
    });
    const m = parseMentions('@sage analyzer please', source(longer));
    // The default `@sage` and the custom `@sage analyzer` overlap;
    // the longer (custom) one wins.
    expect(m).toHaveLength(1);
    expect(m[0]!.raw).toContain('analyzer');
  });

  test('empty source → empty matches', () => {
    expect(parseMentions('@sage', source())).toEqual([]);
  });

  test('empty text → empty matches', () => {
    expect(parseMentions('', source(SAGE))).toEqual([]);
  });
});

describe('resolveMention — single string', () => {
  test('direct id lookup', () => {
    expect(resolveMention('sage', source(SAGE))?.personaId).toBe('sage');
    expect(resolveMention('@sage', source(SAGE))?.personaId).toBe('sage');
  });

  test('via mention pattern', () => {
    expect(resolveMention('@pragmatist', source(PRAGMA))?.personaId).toBe('pragmatist');
  });

  test('returns null on no match', () => {
    expect(resolveMention('@unknown', source(SAGE))).toBeNull();
    expect(resolveMention('', source(SAGE))).toBeNull();
  });
});
