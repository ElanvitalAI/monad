// ── Phase C: agent loader tests ──
//
// Covers parseAgentFrontmatter, parseAgentFile, loadAgents (built-in
// vs user override), resolveAgent cache, reloadAgents, and skill
// injection truncation. Uses real temp dirs (mkdtempSync) so the
// filesystem path is exercised end-to-end.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseAgentFrontmatter,
  parseAgentFile,
  listAgentFiles,
  loadAgents,
  resolveAgent,
  reloadAgents,
  resetAgentCache,
  buildSkillInjection,
  applySkillsToDefinition,
  SKILL_SNIPPET_BYTES,
} from '../src/agent/loader';
import type { AgentDefinition } from '../src/agent/types';
import type { SkillManifest } from '../src/skills/runner';

// ── Frontmatter parse ──

describe('parseAgentFrontmatter', () => {
  test('empty input → empty fm + empty body', () => {
    expect(parseAgentFrontmatter('')).toEqual({ fm: {}, body: '' });
  });

  test('no frontmatter → fm empty, body = full input', () => {
    expect(parseAgentFrontmatter('hello world')).toEqual({ fm: {}, body: 'hello world' });
  });

  test('basic key:value pairs', () => {
    const md = `---
name: alpha
model: claude-haiku
description: a test agent
---
body text`;
    const { fm, body } = parseAgentFrontmatter(md);
    expect(fm.name).toBe('alpha');
    expect(fm.model).toBe('claude-haiku');
    expect(fm.description).toBe('a test agent');
    expect(body).toBe('body text');
  });

  test('inline array: tools: [a, b, c]', () => {
    const md = `---
tools: [omni-market, web_search, layout.writePane]
---
body`;
    const { fm } = parseAgentFrontmatter(md);
    expect(fm.tools).toEqual(['omni-market', 'web_search', 'layout.writePane']);
  });

  test('empty inline array: tools: []', () => {
    const md = `---
tools: []
---
body`;
    const { fm } = parseAgentFrontmatter(md);
    expect(fm.tools).toEqual([]);
  });

  test('block list: tools:\\n  - a\\n  - b', () => {
    const md = `---
skills:
  - omni-market
  - apify-x-asset-sentiment
---
body`;
    const { fm } = parseAgentFrontmatter(md);
    expect(fm.skills).toEqual(['omni-market', 'apify-x-asset-sentiment']);
  });

  test('quoted strings are unwrapped', () => {
    const md = `---
description: "quoted with spaces"
name: 'single-quoted'
---
body`;
    const { fm } = parseAgentFrontmatter(md);
    expect(fm.description).toBe('quoted with spaces');
    expect(fm.name).toBe('single-quoted');
  });

  test('strips inline-array element quotes', () => {
    const md = `---
tools: ["a", "b"]
---
body`;
    const { fm } = parseAgentFrontmatter(md);
    expect(fm.tools).toEqual(['a', 'b']);
  });
});

// ── parseAgentFile ──

describe('parseAgentFile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('returns null when file is missing', () => {
    expect(parseAgentFile(join(dir, 'nope.md'))).toBeNull();
  });

  test('returns null when body is empty', () => {
    const path = join(dir, 'empty.md');
    writeFileSync(path, `---\nname: x\n---\n   \n`);
    expect(parseAgentFile(path)).toBeNull();
  });

  test('parses full frontmatter + body', () => {
    const path = join(dir, 'value-investor.md');
    writeFileSync(path, `---
name: value-investor
model: claude-sonnet-4-6
tools: [omni-market, web_search]
skills: [omni-market]
description: Classic value investor
---
You are Margaret Chen, a value investor.
Look for free cash flow yield.`);
    const def = parseAgentFile(path);
    expect(def).toEqual({
      name: 'value-investor',
      model: 'claude-sonnet-4-6',
      tools: ['omni-market', 'web_search'],
      skills: ['omni-market'],
      description: 'Classic value investor',
      systemPrompt: 'You are Margaret Chen, a value investor.\nLook for free cash flow yield.',
    });
  });

  test('falls back to filename for name when frontmatter omits it', () => {
    const path = join(dir, 'fallback-agent.md');
    writeFileSync(path, `---\nmodel: x\n---\nbody`);
    const def = parseAgentFile(path);
    expect(def?.name).toBe('fallback-agent');
  });

  test('omits optional fields when absent', () => {
    const path = join(dir, 'minimal.md');
    writeFileSync(path, `---\nname: minimal\n---\nbare prompt`);
    const def = parseAgentFile(path);
    expect(def).toEqual({ name: 'minimal', systemPrompt: 'bare prompt' });
    expect(def?.tools).toBeUndefined();
    expect(def?.skills).toBeUndefined();
  });
});

// ── listAgentFiles ──

describe('listAgentFiles', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-list-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('returns empty array when dir is missing', () => {
    expect(listAgentFiles(join(dir, 'nope'))).toEqual([]);
  });

  test('lists only *.md files, sorted, dotfiles excluded', () => {
    writeFileSync(join(dir, 'b.md'), 'body');
    writeFileSync(join(dir, 'a.md'), 'body');
    writeFileSync(join(dir, '.hidden.md'), 'body');
    writeFileSync(join(dir, 'README.txt'), 'body');
    expect(listAgentFiles(dir)).toEqual(['a.md', 'b.md']);
  });
});

// ── loadAgents (built-in + user override) ──

describe('loadAgents', () => {
  let builtinDir: string;
  let userDir: string;

  beforeEach(() => {
    builtinDir = mkdtempSync(join(tmpdir(), 'agent-builtin-'));
    userDir = mkdtempSync(join(tmpdir(), 'agent-user-'));
  });
  afterEach(() => {
    rmSync(builtinDir, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  });

  test('loads built-in only when user dir empty', () => {
    writeFileSync(join(builtinDir, 'value.md'), `---\nname: value-investor\n---\nbody`);
    const map = loadAgents({ builtinDir, userDir });
    expect(map.size).toBe(1);
    expect(map.get('value-investor')?.systemPrompt).toBe('body');
  });

  test('user file overrides built-in of same name', () => {
    writeFileSync(join(builtinDir, 'a.md'), `---\nname: agent-a\n---\nBUILTIN`);
    writeFileSync(join(userDir, 'a.md'), `---\nname: agent-a\n---\nUSER`);
    const map = loadAgents({ builtinDir, userDir });
    expect(map.size).toBe(1);
    expect(map.get('agent-a')?.systemPrompt).toBe('USER');
  });

  test('user file with new name adds alongside built-in', () => {
    writeFileSync(join(builtinDir, 'a.md'), `---\nname: agent-a\n---\nA`);
    writeFileSync(join(userDir, 'b.md'), `---\nname: agent-b\n---\nB`);
    const map = loadAgents({ builtinDir, userDir });
    expect(map.size).toBe(2);
    expect(map.get('agent-a')?.systemPrompt).toBe('A');
    expect(map.get('agent-b')?.systemPrompt).toBe('B');
  });

  test('missing builtin dir: gracefully degrades to user agents only', () => {
    writeFileSync(join(userDir, 'x.md'), `---\nname: x\n---\nU`);
    const map = loadAgents({ builtinDir: join(builtinDir, 'nope'), userDir });
    expect(map.size).toBe(1);
    expect(map.get('x')?.systemPrompt).toBe('U');
  });
});

// ── resolveAgent cache + reloadAgents ──

describe('resolveAgent / reloadAgents', () => {
  let builtinDir: string;
  let userDir: string;

  beforeEach(() => {
    builtinDir = mkdtempSync(join(tmpdir(), 'agent-resolve-'));
    userDir = mkdtempSync(join(tmpdir(), 'agent-resolve-u-'));
    resetAgentCache();
  });
  afterEach(() => {
    rmSync(builtinDir, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
    resetAgentCache();
  });

  test('first call loads, second call serves from cache', () => {
    writeFileSync(join(builtinDir, 'a.md'), `---\nname: a\n---\nv1`);
    const first = resolveAgent('a', { builtinDir, userDir });
    expect(first?.systemPrompt).toBe('v1');

    // Mutate the file — without reload, cache returns the old version.
    writeFileSync(join(builtinDir, 'a.md'), `---\nname: a\n---\nv2`);
    const second = resolveAgent('a', { builtinDir, userDir });
    expect(second?.systemPrompt).toBe('v1');

    reloadAgents({ builtinDir, userDir });
    const third = resolveAgent('a', { builtinDir, userDir });
    expect(third?.systemPrompt).toBe('v2');
  });

  test('returns undefined for unknown name', () => {
    expect(resolveAgent('ghost', { builtinDir, userDir })).toBeUndefined();
  });
});

// ── Skill injection ──

describe('buildSkillInjection', () => {
  function fakeSkill(over: Partial<SkillManifest>): SkillManifest {
    return {
      name: 'demo',
      description: 'demo desc',
      content: 'short body',
      skillDir: '/tmp',
      ...over,
    };
  }

  test('empty skill list → empty string', () => {
    expect(buildSkillInjection([])).toBe('');
  });

  test('emits compact <skill> block per skill', () => {
    const out = buildSkillInjection(['alpha'], {
      load: () => fakeSkill({ name: 'alpha', description: 'a desc', content: 'a body' }),
    });
    expect(out).toContain('<skill name="alpha">');
    expect(out).toContain('a desc');
    expect(out).toContain('a body');
    expect(out).toContain('</skill>');
  });

  test('truncates body to SKILL_SNIPPET_BYTES and marks it', () => {
    const long = 'X'.repeat(SKILL_SNIPPET_BYTES + 200);
    const out = buildSkillInjection(['big'], {
      load: () => fakeSkill({ name: 'big', content: long }),
    });
    // Snippet bytes (or fewer after trim) are present, full length is not.
    expect(out).toContain('…[truncated]');
    const xCount = (out.match(/X/g) || []).length;
    expect(xCount).toBeLessThanOrEqual(SKILL_SNIPPET_BYTES);
    expect(xCount).toBeGreaterThan(0);
  });

  test('honours custom snippetBytes', () => {
    const out = buildSkillInjection(['s'], {
      load: () => fakeSkill({ name: 's', content: 'YYYYYYYYYY' }),  // 10 chars
      snippetBytes: 4,
    });
    const yCount = (out.match(/Y/g) || []).length;
    expect(yCount).toBe(4);
    expect(out).toContain('…[truncated]');
  });

  test('missing skill emits a self-closing tag with missing="true"', () => {
    const out = buildSkillInjection(['ghost'], {
      load: () => null,
    });
    expect(out).toBe('<skill name="ghost" missing="true" />');
  });
});

describe('applySkillsToDefinition', () => {
  function fakeSkill(name: string, body: string): SkillManifest {
    return { name, description: '', content: body, skillDir: '/tmp' };
  }

  test('no skills → returns the same definition', () => {
    const def: AgentDefinition = { name: 'a', systemPrompt: 'orig' };
    expect(applySkillsToDefinition(def)).toBe(def);
  });

  test('skills append a `## Skills` section to the system prompt', () => {
    const def: AgentDefinition = {
      name: 'a',
      systemPrompt: 'orig',
      skills: ['demo'],
    };
    const out = applySkillsToDefinition(def, {
      load: (n) => fakeSkill(n, 'demo body'),
    });
    expect(out).not.toBe(def);
    expect(out.systemPrompt.startsWith('orig\n\n## Skills\n\n')).toBe(true);
    expect(out.systemPrompt).toContain('<skill name="demo">');
    expect(out.systemPrompt).toContain('demo body');
  });
});
