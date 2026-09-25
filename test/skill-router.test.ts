// ── Skill router + index tests ──
//
// Covers:
//   - parseSkillMd frontmatter extension (triggers, autoTrigger)
//   - buildSkillIndex / getSkillIndex / reloadSkillIndex lifecycle
//   - detectSkillTrigger scoring, tie-breaking, description bonus cap
//   - shouldAutoRoute gating

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillMd } from '../src/skills/runner';
import {
  buildSkillIndex, getSkillIndex, reloadSkillIndex, resetSkillIndex,
  type SkillIndexEntry,
} from '../src/skills/index';
import {
  detectSkillTrigger, shouldAutoRoute,
  detectLLM, buildClassifierPrompt, parseClassifierJson,
  type LLMClassifyResult,
} from '../src/skills/router';

// ── Helpers ──

let root: string;
function skillDir(name: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
}
function writeSkill(name: string, frontmatter: string, body = 'body'): void {
  const d = skillDir(name);
  writeFileSync(join(d, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}\n`);
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'skill-router-')); resetSkillIndex(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); resetSkillIndex(); });

// ═══════════════════════════════════════════
// 1. parseSkillMd — new frontmatter fields
// ═══════════════════════════════════════════

describe('parseSkillMd — triggers + autoTrigger', () => {
  test('list form: triggers:\\n  - a\\n  - b', () => {
    writeSkill('s1', `name: s1\ndescription: d\ntriggers:\n  - 요약\n  - summarize`);
    const m = parseSkillMd('s1', root);
    expect(m?.triggers).toEqual(['요약', 'summarize']);
  });

  test('comma-separated form: triggers: a, b, c', () => {
    writeSkill('s2', `name: s2\ntriggers: 요약, summarize, digest`);
    const m = parseSkillMd('s2', root);
    expect(m?.triggers).toEqual(['요약', 'summarize', 'digest']);
  });

  test('missing triggers → field is undefined', () => {
    writeSkill('s3', `name: s3`);
    const m = parseSkillMd('s3', root);
    expect(m?.triggers).toBeUndefined();
  });

  test('autoTrigger: true (string form parsed as boolean)', () => {
    writeSkill('s4', `name: s4\nautoTrigger: true`);
    const m = parseSkillMd('s4', root);
    expect(m?.autoTrigger).toBe(true);
  });

  test('autoTrigger: false', () => {
    writeSkill('s5', `name: s5\nautoTrigger: false`);
    const m = parseSkillMd('s5', root);
    expect(m?.autoTrigger).toBe(false);
  });

  test('autoTrigger accepts yes / 1 / no / 0', () => {
    writeSkill('yes1', `name: yes1\nautoTrigger: yes`);
    expect(parseSkillMd('yes1', root)?.autoTrigger).toBe(true);

    writeSkill('one1', `name: one1\nautoTrigger: 1`);
    expect(parseSkillMd('one1', root)?.autoTrigger).toBe(true);

    writeSkill('no1', `name: no1\nautoTrigger: no`);
    expect(parseSkillMd('no1', root)?.autoTrigger).toBe(false);

    writeSkill('zero1', `name: zero1\nautoTrigger: 0`);
    expect(parseSkillMd('zero1', root)?.autoTrigger).toBe(false);
  });

  test('absent autoTrigger → undefined (distinct from false)', () => {
    writeSkill('s6', `name: s6`);
    const m = parseSkillMd('s6', root);
    expect(m?.autoTrigger).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// 2. Index caching
// ═══════════════════════════════════════════

describe('skill index', () => {
  test('buildSkillIndex returns metadata for every skill with SKILL.md', () => {
    writeSkill('a', `name: a\ndescription: dA\ntriggers: x,y`);
    writeSkill('b', `name: b\ndescription: dB\nautoTrigger: true`);

    const idx = buildSkillIndex(root);
    const byName = Object.fromEntries(idx.map(e => [e.name, e]));

    expect(idx).toHaveLength(2);
    expect(byName.a!.triggers).toEqual(['x', 'y']);
    expect(byName.a!.autoTrigger).toBe(false);   // defaulted
    expect(byName.b!.triggers).toEqual([]);       // defaulted
    expect(byName.b!.autoTrigger).toBe(true);
  });

  test('getSkillIndex caches — same baseDir returns identical array', () => {
    writeSkill('a', `name: a`);
    const first = getSkillIndex(root);
    const second = getSkillIndex(root);
    expect(second).toBe(first);   // reference equality — cached
  });

  test('reloadSkillIndex picks up a newly-added skill', () => {
    writeSkill('a', `name: a`);
    const first = getSkillIndex(root);
    expect(first).toHaveLength(1);

    writeSkill('b', `name: b`);
    // Without reload, cache still returns 1.
    expect(getSkillIndex(root)).toHaveLength(1);

    const n = reloadSkillIndex(root);
    expect(n).toBe(2);
    expect(getSkillIndex(root)).toHaveLength(2);
  });

  test('missing SKILL.md files are silently skipped', () => {
    mkdirSync(join(root, 'half-skill'), { recursive: true });
    writeSkill('ok', `name: ok`);
    const idx = buildSkillIndex(root);
    expect(idx.map(e => e.name)).toEqual(['ok']);
  });

  // Phase 3 — extracted triggers + triggerSource
  test('extractedTriggers populated from description when no explicit triggers', () => {
    writeSkill('auto', `name: auto\ndescription: Use when: 요약, 정리, 저장.`);
    const idx = buildSkillIndex(root);
    const e = idx.find(x => x.name === 'auto')!;
    expect(e.triggers).toEqual([]);
    expect(e.extractedTriggers).toEqual(['요약', '정리', '저장']);
    expect(e.triggerSource).toBe('extracted');
  });

  test('extraction skipped when autoExtract: false', () => {
    writeSkill('silent', `name: silent\ndescription: Use when: 요약, 정리.\nautoExtract: false`);
    const idx = buildSkillIndex(root);
    const e = idx.find(x => x.name === 'silent')!;
    expect(e.extractedTriggers).toEqual([]);
    expect(e.triggerSource).toBe('none');
  });

  test('explicit triggers coexist with extracted, duplicates deduped (explicit wins)', () => {
    writeSkill('both', `name: both\ndescription: Use when: 요약, 정리, 저장.\ntriggers: 요약, analyze`);
    const idx = buildSkillIndex(root);
    const e = idx.find(x => x.name === 'both')!;
    expect(e.triggers).toEqual(['요약', 'analyze']);
    // 요약 appears in explicit → dropped from extracted
    expect(e.extractedTriggers).toEqual(['정리', '저장']);
    expect(e.triggerSource).toBe('both');
  });

  test('triggerSource = "none" when both explicit and extracted empty', () => {
    writeSkill('plain', `name: plain\ndescription: A boring skill with no markers.`);
    const idx = buildSkillIndex(root);
    const e = idx.find(x => x.name === 'plain')!;
    expect(e.triggers).toEqual([]);
    expect(e.extractedTriggers).toEqual([]);
    expect(e.triggerSource).toBe('none');
  });

  test('triggerSource = "explicit" when only frontmatter triggers', () => {
    writeSkill('x', `name: x\ndescription: No marker here.\ntriggers: a, b`);
    const idx = buildSkillIndex(root);
    const e = idx.find(x => x.name === 'x')!;
    expect(e.triggerSource).toBe('explicit');
    expect(e.extractedTriggers).toEqual([]);
  });

  test('extracted dedup is case-insensitive against explicit', () => {
    writeSkill('ci', `name: ci\ndescription: Use when: SUMMARY, analyze.\ntriggers: summary`);
    const idx = buildSkillIndex(root);
    const e = idx.find(x => x.name === 'ci')!;
    // Extracted 'SUMMARY' would collide case-insensitively with explicit 'summary' → dropped.
    expect(e.triggers).toEqual(['summary']);
    expect(e.extractedTriggers).toEqual(['analyze']);
  });
});

// ═══════════════════════════════════════════
// 3. detectSkillTrigger — scoring
// ═══════════════════════════════════════════

function mkEntry(over: Partial<SkillIndexEntry> & { name: string }): SkillIndexEntry {
  return {
    name: over.name,
    description: over.description ?? '',
    triggers: over.triggers ?? [],
    autoTrigger: over.autoTrigger ?? false,
    skillDir: over.skillDir ?? `/tmp/${over.name}`,
  };
}

describe('detectSkillTrigger', () => {
  test('no index → no candidates', () => {
    const r = detectSkillTrigger('요약해줘', []);
    expect(r.candidates).toEqual([]);
    expect(r.top).toBeNull();
  });

  test('empty input → no candidates', () => {
    const r = detectSkillTrigger('   ', [mkEntry({ name: 'a', triggers: ['요약'] })]);
    expect(r.top).toBeNull();
  });

  test('single trigger hit → candidate surfaces', () => {
    const r = detectSkillTrigger('이거 요약해줘', [
      mkEntry({ name: 'digest', triggers: ['요약', 'summarize'] }),
    ]);
    expect(r.top?.name).toBe('digest');
    expect(r.top?.score).toBeGreaterThanOrEqual(1);
    expect(r.top?.matchedTriggers).toEqual(['요약']);
    expect(r.unambiguous).toBe(true);
  });

  test('case-insensitive trigger match', () => {
    const r = detectSkillTrigger('SUMMARIZE this', [
      mkEntry({ name: 'd', triggers: ['summarize'] }),
    ]);
    expect(r.top?.name).toBe('d');
  });

  test('multiple trigger hits boost score', () => {
    const r = detectSkillTrigger('요약 summarize digest', [
      mkEntry({ name: 'a', triggers: ['요약', 'summarize'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ]);
    expect(r.top?.name).toBe('a');
    expect(r.top?.matchedTriggers).toHaveLength(2);
    expect(r.unambiguous).toBe(true);
  });

  test('description bonus is capped so common words don\'t dominate', () => {
    // Input shares many description words but no triggers with skill b.
    // Skill a has a single trigger hit — should still win even when
    // we lower minScore enough for the description-only candidate
    // to appear.
    const input = 'summary report overview analysis';
    const r = detectSkillTrigger(input, [
      mkEntry({ name: 'a', triggers: ['summary'] }),
      mkEntry({ name: 'b', triggers: [], description: 'summary report overview analysis digest brief' }),
    ], { minScore: 0.1 });
    expect(r.candidates).toHaveLength(2);
    expect(r.top?.name).toBe('a');
    expect(r.top!.score).toBeGreaterThan(r.candidates[1]!.score);
  });

  test('tie at top → unambiguous = false', () => {
    const r = detectSkillTrigger('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ]);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]!.score).toBe(r.candidates[1]!.score);
    expect(r.unambiguous).toBe(false);
  });

  test('alphabetical tie-break on name keeps output stable', () => {
    const r = detectSkillTrigger('요약', [
      mkEntry({ name: 'zeta', triggers: ['요약'] }),
      mkEntry({ name: 'alpha', triggers: ['요약'] }),
    ]);
    expect(r.candidates[0]!.name).toBe('alpha');
    expect(r.candidates[1]!.name).toBe('zeta');
  });

  test('no triggers in skill + no description match → no candidate', () => {
    const r = detectSkillTrigger('요약', [
      mkEntry({ name: 'silent', triggers: [], description: 'unrelated thing' }),
    ]);
    expect(r.top).toBeNull();
  });

  test('skill description match alone does NOT reach minScore by default', () => {
    // Description provides at most 0.5 (capped). Default minScore=1.
    const r = detectSkillTrigger('overview please', [
      mkEntry({ name: 'lonely', triggers: [], description: 'overview reports diagrams visual' }),
    ]);
    expect(r.top).toBeNull();
  });

  test('lowering minScore surfaces description-only matches', () => {
    const r = detectSkillTrigger('overview analysis', [
      mkEntry({ name: 'weak', triggers: [], description: 'overview analysis report diagrams' }),
    ], { minScore: 0.1 });
    expect(r.top?.name).toBe('weak');
  });

  // Phase 3 — extracted-trigger scoring
  test('extracted trigger hit scores 0.6, below default minScore=1 by itself', () => {
    // Single extracted hit → score 0.6, at exactly minScore, surfaces.
    const r = detectSkillTrigger('요약해줘', [{
      name: 'e', description: 'd', triggers: [],
      extractedTriggers: ['요약'], triggerSource: 'extracted',
      autoTrigger: false, skillDir: '/tmp/e',
    }]);
    expect(r.top?.name).toBe('e');
    expect(r.top?.score).toBeCloseTo(0.6, 5);
    expect(r.top?.matchedExtractedTriggers).toEqual(['요약']);
    expect(r.top?.matchedTriggers).toEqual([]);
  });

  test('explicit 1 hit (1.0) beats extracted 1 hit (0.6)', () => {
    const r = detectSkillTrigger('요약', [
      { name: 'exp', description: 'd', triggers: ['요약'], extractedTriggers: [],
        triggerSource: 'explicit', autoTrigger: false, skillDir: '/tmp/exp' },
      { name: 'ext', description: 'd', triggers: [], extractedTriggers: ['요약'],
        triggerSource: 'extracted', autoTrigger: false, skillDir: '/tmp/ext' },
    ]);
    expect(r.top?.name).toBe('exp');
    expect(r.unambiguous).toBe(true);
  });

  test('weights tunable via opts', () => {
    const r = detectSkillTrigger('요약', [{
      name: 'a', description: 'd', triggers: [],
      extractedTriggers: ['요약'], triggerSource: 'extracted',
      autoTrigger: false, skillDir: '/tmp/a',
    }], { extractedTriggerWeight: 0.1, minScore: 0.05 });
    expect(r.top?.score).toBeCloseTo(0.1, 5);
  });

  test('autoTrigger flag flows through to candidate', () => {
    const r = detectSkillTrigger('요약', [
      mkEntry({ name: 'a', triggers: ['요약'], autoTrigger: true }),
    ]);
    expect(r.top?.autoTrigger).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 4. shouldAutoRoute — gating logic
// ═══════════════════════════════════════════

describe('shouldAutoRoute', () => {
  const base = (over: Partial<SkillIndexEntry> & { name: string }) => mkEntry(over);

  test('global opt-out blocks auto-route even with everything set', () => {
    const r = detectSkillTrigger('요약', [base({ name: 'a', triggers: ['요약'], autoTrigger: true })]);
    expect(shouldAutoRoute(r, { autoRouteEnabled: false })).toBe(false);
  });

  test('skill without autoTrigger blocked by default (requireAutoTrigger=true)', () => {
    const r = detectSkillTrigger('요약', [base({ name: 'a', triggers: ['요약'], autoTrigger: false })]);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
  });

  test('requireAutoTrigger: false lets a high-score skill without autoTrigger route', () => {
    // Two explicit triggers to clear default minScore 2.0.
    const r = detectSkillTrigger('요약 정리', [
      base({ name: 'a', triggers: ['요약', '정리'], autoTrigger: false }),
    ]);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true, requireAutoTrigger: false })).toBe(true);
  });

  test('tied candidates block auto-route (ambiguous)', () => {
    const r = detectSkillTrigger('요약', [
      base({ name: 'a', triggers: ['요약'], autoTrigger: true }),
      base({ name: 'b', triggers: ['요약'], autoTrigger: true }),
    ]);
    expect(r.unambiguous).toBe(false);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
  });

  test('autoTrigger + unambiguous + two trigger hits + opt-in → auto-route', () => {
    // Two explicit triggers (score 2.0) clear the default minScore 2.0.
    const r = detectSkillTrigger('요약해줘 — 정리까지', [
      base({ name: 'a', triggers: ['요약', '정리'], autoTrigger: true }),
    ]);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(true);
  });

  // Phase 4 — score-based gating (default minScore 2.0 after session 21)
  test('minScore 2.0 (default) blocks extracted-only single hit (score 0.6)', () => {
    const r = detectSkillTrigger('요약', [{
      name: 'a', description: 'd', triggers: [],
      extractedTriggers: ['요약'], triggerSource: 'extracted',
      autoTrigger: true, skillDir: '/tmp/a',
    }]);
    expect(r.top?.score).toBeCloseTo(0.6, 5);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
  });

  test('minScore 0.5 lets extracted-only single hit (score 0.6) route', () => {
    const r = detectSkillTrigger('요약', [{
      name: 'a', description: 'd', triggers: [],
      extractedTriggers: ['요약'], triggerSource: 'extracted',
      autoTrigger: true, skillDir: '/tmp/a',
    }]);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true, minScore: 0.5 })).toBe(true);
  });

  test('two extracted hits (score 1.2) still below tightened default minScore 2.0', () => {
    const r = detectSkillTrigger('요약 정리', [{
      name: 'a', description: 'd', triggers: [],
      extractedTriggers: ['요약', '정리'], triggerSource: 'extracted',
      autoTrigger: true, skillDir: '/tmp/a',
    }]);
    expect(r.top?.score).toBeCloseTo(1.2, 5);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
    // Explicit opt-in to lenient threshold still lets it route
    expect(shouldAutoRoute(r, { autoRouteEnabled: true, minScore: 1.0 })).toBe(true);
  });

  test('single explicit trigger (score 1.0) below default minScore 2.0', () => {
    const r = detectSkillTrigger('요약', [
      base({ name: 'a', triggers: ['요약'], autoTrigger: true }),
    ]);
    expect(r.top?.score).toBeCloseTo(1.0, 5);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
  });

  test('two explicit triggers (score 2.0) clear default minScore 2.0', () => {
    const r = detectSkillTrigger('요약 정리', [
      base({ name: 'a', triggers: ['요약', '정리'], autoTrigger: true }),
    ]);
    expect(r.top?.score).toBeCloseTo(2.0, 5);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(true);
  });

  // Session 21 — minTier gating.
  test('tier gate: T3 active model blocks T1-only skill from auto-route', () => {
    const r = detectSkillTrigger('요약 정리', [
      { ...base({ name: 'heavy', triggers: ['요약', '정리'], autoTrigger: true }), minTier: 'T1' },
    ]);
    // Score clears threshold, but active T3 < min T1 → gate refuses.
    expect(shouldAutoRoute(r, { autoRouteEnabled: true, activeTier: 'T3' })).toBe(false);
    // No activeTier passed → no gate, fires as usual.
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(true);
  });

  test('tier gate: T1 active model runs any skill regardless of minTier', () => {
    const r = detectSkillTrigger('요약 정리', [
      { ...base({ name: 'any', triggers: ['요약', '정리'], autoTrigger: true }), minTier: 'T3' },
    ]);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true, activeTier: 'T1' })).toBe(true);
  });

  test('tier gate: skill without minTier treated as T2 (active T2 OK, T3 blocked)', () => {
    const r = detectSkillTrigger('요약 정리', [
      base({ name: 'legacy', triggers: ['요약', '정리'], autoTrigger: true }),
    ]);
    // Undefined minTier → tierMeetsMin treats as T2.
    expect(shouldAutoRoute(r, { autoRouteEnabled: true, activeTier: 'T2' })).toBe(true);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true, activeTier: 'T3' })).toBe(false);
  });

  test('lenient profile: requireAutoTrigger=false + minScore=0.5 matches the user friendly path', () => {
    // Real-world Phase 3: youtube-master extracted "요약", no autoTrigger.
    const r = detectSkillTrigger('요약', [{
      name: 'youtube-master', description: 'd', triggers: [],
      extractedTriggers: ['요약'], triggerSource: 'extracted',
      autoTrigger: false, skillDir: '/tmp/ym',
    }]);
    expect(shouldAutoRoute(r, {
      autoRouteEnabled: true, minScore: 0.5, requireAutoTrigger: false,
    })).toBe(true);
  });

  // Phase 3 — extracted-only match must NOT auto-route.
  test('extracted-only match with autoTrigger does NOT auto-route (Phase 3 gate)', () => {
    // Explicit triggers empty, extracted matches the input. Even with
    // autoTrigger + autoRouteEnabled + unambiguous, the gate refuses
    // because matchedTriggers (explicit) is empty — authored intent
    // is required before auto-executing.
    const r = detectSkillTrigger('요약해줘', [{
      name: 'a', description: 'd', triggers: [],
      extractedTriggers: ['요약'], triggerSource: 'extracted',
      autoTrigger: true, skillDir: '/tmp/a',
    }]);
    expect(r.top?.name).toBe('a');
    expect(r.top?.matchedTriggers).toEqual([]);
    expect(r.top?.matchedExtractedTriggers).toEqual(['요약']);
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
  });

  test('description-only match with autoTrigger does NOT auto-route', () => {
    // No trigger words in input but description matches (won't pass
    // default minScore=1 anyway). Lower minScore just to surface —
    // auto-route should still refuse because matchedTriggers is empty.
    const r = detectSkillTrigger('overview analysis', [
      base({ name: 'a', triggers: [], autoTrigger: true, description: 'overview analysis digest report' }),
    ], { minScore: 0.1 });
    if (r.top) {
      expect(r.top.matchedTriggers).toEqual([]);
    }
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
  });
});

// ═══════════════════════════════════════════
// 5. parseClassifierJson
// ═══════════════════════════════════════════

describe('parseClassifierJson', () => {
  test('strict JSON parses', () => {
    const r = parseClassifierJson('{"skill":"a","confidence":0.8,"reason":"x"}');
    expect(r.skill).toBe('a');
    expect(r.confidence).toBe(0.8);
    expect(r.reason).toBe('x');
  });

  test('confidence clamped to [0,1]', () => {
    expect(parseClassifierJson('{"skill":"a","confidence":1.5}').confidence).toBe(1);
    expect(parseClassifierJson('{"skill":"a","confidence":-0.2}').confidence).toBe(0);
  });

  test('null skill → null', () => {
    const r = parseClassifierJson('{"skill":null,"confidence":0.3}');
    expect(r.skill).toBeNull();
  });

  test('empty string skill → null', () => {
    const r = parseClassifierJson('{"skill":"","confidence":0.3}');
    expect(r.skill).toBeNull();
  });

  test('JSON embedded in prose — extracts outermost braces', () => {
    const raw = 'Sure! Here is the verdict:\n\n{"skill":"digest","confidence":0.72}\n\nHope this helps.';
    const r = parseClassifierJson(raw);
    expect(r.skill).toBe('digest');
    expect(r.confidence).toBe(0.72);
  });

  test('code-fenced JSON parses', () => {
    const raw = '```json\n{"skill":"a","confidence":0.9}\n```';
    const r = parseClassifierJson(raw);
    expect(r.skill).toBe('a');
  });

  test('garbage → { skill:null, confidence:0 }', () => {
    const r = parseClassifierJson('no json here at all');
    expect(r.skill).toBeNull();
    expect(r.confidence).toBe(0);
  });

  test('missing confidence → 0', () => {
    const r = parseClassifierJson('{"skill":"a"}');
    expect(r.confidence).toBe(0);
  });
});

// ═══════════════════════════════════════════
// 6. buildClassifierPrompt
// ═══════════════════════════════════════════

describe('buildClassifierPrompt', () => {
  test('includes every skill name and description snippet', () => {
    const p = buildClassifierPrompt('something', [
      mkEntry({ name: 'alpha', description: 'aaa' }),
      mkEntry({ name: 'beta', description: 'bbb' }),
    ]);
    expect(p).toContain('- alpha: aaa');
    expect(p).toContain('- beta: bbb');
    expect(p).toContain('User query:\nsomething');
  });

  test('truncates long descriptions to keep prompt small', () => {
    const long = 'x'.repeat(500);
    const p = buildClassifierPrompt('q', [mkEntry({ name: 'a', description: long })]);
    // 160 chars is the cap defined in the router; prompt must not
    // contain a 200+ run of the truncated char.
    expect(p).not.toContain('x'.repeat(200));
  });

  test('collapses whitespace in descriptions', () => {
    const p = buildClassifierPrompt('q', [
      mkEntry({ name: 'a', description: 'line1\n\n\nline2\tline3' }),
    ]);
    expect(p).toContain('- a: line1 line2 line3');
  });
});

// ═══════════════════════════════════════════
// 7. detectLLM — fallback behaviour
// ═══════════════════════════════════════════

describe('detectLLM', () => {
  test('keyword unambiguous + over threshold → classifier not called', async () => {
    let called = false;
    const classify = async (): Promise<LLMClassifyResult> => {
      called = true;
      return { skill: 'other', confidence: 0.99 };
    };
    const r = await detectLLM('요약 summarize 정리', [
      mkEntry({ name: 'digest', triggers: ['요약', 'summarize', '정리'] }),
    ], { classify });
    expect(called).toBe(false);
    expect(r.top?.name).toBe('digest');
  });

  test('no classifier + keyword below threshold → returns keyword result as-is', async () => {
    const r = await detectLLM('요약', [
      mkEntry({ name: 'digest', triggers: ['요약'] }),
    ]); // no classify
    expect(r.top?.name).toBe('digest');
    // Single trigger hit → kwScore=1 < default threshold=2, but classifier
    // absent, so we gracefully return the keyword result.
  });

  test('ambiguous keyword + classifier picks one → LLM verdict wins', async () => {
    const classify = async (): Promise<LLMClassifyResult> => ({ skill: 'b', confidence: 0.9 });
    const r = await detectLLM('요약해줘', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ], { classify });
    expect(r.top?.name).toBe('b');
    expect(r.unambiguous).toBe(true);
  });

  test('classifier confidence below threshold → keyword result preserved', async () => {
    const classify = async (): Promise<LLMClassifyResult> => ({ skill: 'b', confidence: 0.3 });
    const r = await detectLLM('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ], { classify, llmConfidenceThreshold: 0.5 });
    // kw result was ambiguous — top is 'a' (alphabetical tie-break)
    expect(r.top?.name).toBe('a');
    expect(r.unambiguous).toBe(false);
  });

  test('classifier returns null skill → keyword result preserved', async () => {
    const classify = async (): Promise<LLMClassifyResult> => ({ skill: null, confidence: 0.9 });
    const r = await detectLLM('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ], { classify });
    expect(r.top?.name).toBe('a');
    expect(r.unambiguous).toBe(false);
  });

  test('classifier hallucinates a non-indexed name → ignored', async () => {
    const classify = async (): Promise<LLMClassifyResult> => ({ skill: 'ghost', confidence: 0.95 });
    const r = await detectLLM('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ], { classify });
    expect(['a', 'b']).toContain(r.top?.name);   // kw result, not 'ghost'
  });

  test('classifier throws → graceful fallback to keyword', async () => {
    const classify = async (): Promise<LLMClassifyResult> => { throw new Error('api dead'); };
    const r = await detectLLM('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ], { classify });
    expect(r.top).not.toBeNull();
  });

  test('LLM picks a skill keyword also saw → matchedTriggers carry over, score preserved', async () => {
    const classify = async (): Promise<LLMClassifyResult> => ({ skill: 'b', confidence: 0.9 });
    const r = await detectLLM('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ], { classify });
    expect(r.top?.name).toBe('b');
    expect(r.top?.matchedTriggers).toEqual(['요약']);
    // Session 21: synth now carries max(kwScore, confidence) — not
    // `confidence + 10`. For a 1.0 keyword match that's 1.0, not 10.9.
    expect(r.top?.score).toBeCloseTo(1.0, 5);
  });

  test('LLM NOT consulted when keyword found nothing — no blind classification over the full menu', async () => {
    // Session 21 tightening: detectLLM is a tiebreaker among real kw
    // candidates, not a blind classifier. With an input the keyword
    // router can't score, classify must not fire.
    let called = false;
    const classify = async (): Promise<LLMClassifyResult> => {
      called = true;
      return { skill: 'quiet', confidence: 0.9 };
    };
    const r = await detectLLM('do the thing', [
      mkEntry({ name: 'quiet', triggers: ['never-matches'], autoTrigger: true }),
    ], { classify });
    expect(called).toBe(false);
    expect(r.top).toBeNull();
  });

  test('LLM NOT consulted when only one kw candidate (no real ambiguity)', async () => {
    // Single unambiguous keyword match but below keywordScoreThreshold.
    // Previously this fell through to LLM. Now it does not — one
    // candidate isn't ambiguity.
    let called = false;
    const classify = async (): Promise<LLMClassifyResult> => {
      called = true;
      return { skill: 'a', confidence: 0.9 };
    };
    await detectLLM('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
    ], { classify, keywordScoreThreshold: 5 });
    expect(called).toBe(false);
  });

  test('LLM consulted on genuine ambiguity (2+ candidates tied) and synth can\'t silently auto-route', async () => {
    const classify = async (): Promise<LLMClassifyResult> => ({ skill: 'b', confidence: 0.8 });
    const r = await detectLLM('요약', [
      mkEntry({ name: 'a', triggers: ['요약'] }),
      mkEntry({ name: 'b', triggers: ['요약'] }),
    ], { classify });
    expect(r.top?.name).toBe('b');
    // Synth score = max(kwScore 1.0, confidence 0.8) = 1.0. Below
    // default minScore 2.0 → no silent auto-route even with
    // autoRouteEnabled.
    expect(shouldAutoRoute(r, { autoRouteEnabled: true })).toBe(false);
  });

  test('empty index short-circuits — classifier not called', async () => {
    let called = false;
    const classify = async (): Promise<LLMClassifyResult> => { called = true; return { skill: 'x', confidence: 1 }; };
    const r = await detectLLM('anything', [], { classify });
    expect(called).toBe(false);
    expect(r.top).toBeNull();
  });
});
