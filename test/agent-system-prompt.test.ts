// Tests for composeSystemPrompt + CrewAI-aware parseAgentFile (PFC PX-1).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeSystemPrompt,
  parseAgentFile,
  parseAgentFrontmatter,
} from '../src/agent/loader.js';
import type { AgentDefinition } from '../src/agent/types.js';

describe('parseAgentFrontmatter — extended literal coercion (PX-1)', () => {
  test('boolean + integer literals parsed natively', () => {
    const md = [
      '---',
      'name: x',
      'omitClaudeMd: true',
      'background: false',
      'maxTurns: 30',
      '---',
      'body',
    ].join('\n');
    const { fm } = parseAgentFrontmatter(md);
    expect(fm.omitClaudeMd).toBe(true);
    expect(fm.background).toBe(false);
    expect(fm.maxTurns).toBe(30);
  });

  test('string values that look like bool/int are also coerced (no ambiguity in agent frontmatter)', () => {
    const { fm } = parseAgentFrontmatter('---\nmodel: 42\n---\n');
    expect(fm.model).toBe(42);
  });
});

describe('parseAgentFile — CrewAI 3-tuple + PFC fields', () => {
  let tmp: string;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'agent-def-')); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('role/goal/backstory + model/tools/permissionMode populated', () => {
    const p = join(tmp, 'explore.md');
    writeFileSync(p, [
      '---',
      'name: Explore',
      'description: Scout',
      'role: 코드베이스 정찰자',
      'goal: 빠른 검색',
      'backstory: 25년차 고고학자',
      'model: haiku',
      'tools: [Read, Glob, Grep]',
      'disallowedTools: Write, Edit',
      'permissionMode: read-only',
      'effort: 3',
      'maxTurns: 30',
      'omitClaudeMd: true',
      'isolation: worktree',
      '---',
      'BODY',
    ].join('\n'));
    const def = parseAgentFile(p, undefined, 'plugin-builtin');
    expect(def).not.toBeNull();
    expect(def!.role).toBe('코드베이스 정찰자');
    expect(def!.goal).toBe('빠른 검색');
    expect(def!.backstory).toBe('25년차 고고학자');
    expect(def!.model).toBe('haiku');
    expect(def!.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(def!.disallowedTools).toEqual(['Write', 'Edit']);
    expect(def!.permissionMode).toBe('read-only');
    expect(def!.effort).toBe(3);
    expect(def!.maxTurns).toBe(30);
    expect(def!.omitInheritedContext).toBe(true);
    expect(def!.isolation).toBe('worktree');
    expect(def!.source).toBe('plugin-builtin');
    expect(def!.sourcePath).toBe(p);
  });

  test('new omitInheritedContext key wins when both keys are supplied', () => {
    const p = join(tmp, 'context-precedence.md');
    writeFileSync(p, '---\nname: precedence\nomitClaudeMd: true\nomitInheritedContext: false\n---\nbody');
    const def = parseAgentFile(p)!;
    expect(def.omitInheritedContext).toBe(false);
    expect('omitClaudeMd' in def).toBe(false);
  });

  test('effort enum "expert" accepted; out-of-range number dropped', () => {
    const p1 = join(tmp, 'e1.md');
    const p2 = join(tmp, 'e2.md');
    writeFileSync(p1, '---\nname: e1\neffort: expert\n---\nbody');
    writeFileSync(p2, '---\nname: e2\neffort: 9\n---\nbody');
    expect(parseAgentFile(p1)!.effort).toBe('expert');
    expect(parseAgentFile(p2)!.effort).toBeUndefined();
  });

  test('invalid permissionMode dropped (non-enum)', () => {
    const p = join(tmp, 'p.md');
    writeFileSync(p, '---\nname: p\npermissionMode: nuclear\n---\nbody');
    expect(parseAgentFile(p)!.permissionMode).toBeUndefined();
  });

  test('legacy agent without new fields still loads (non-breaking)', () => {
    const p = join(tmp, 'legacy.md');
    writeFileSync(p, '---\nname: legacy\nmodel: sonnet\ntools: [Bash]\n---\nlegacy body');
    const def = parseAgentFile(p);
    expect(def).not.toBeNull();
    expect(def!.name).toBe('legacy');
    expect(def!.tools).toEqual(['Bash']);
    expect(def!.role).toBeUndefined();
    expect(def!.permissionMode).toBeUndefined();
  });
});

describe('composeSystemPrompt', () => {
  const baseDef: AgentDefinition = {
    name: 'x',
    systemPrompt: 'BODY CONTENT.',
  };

  test('body-only def → composer returns body verbatim', () => {
    expect(composeSystemPrompt(baseDef)).toBe('BODY CONTENT.');
  });

  test('role/goal/backstory prepended with separator', () => {
    const def: AgentDefinition = {
      ...baseDef,
      role: 'R',
      goal: 'G',
      backstory: 'B',
    };
    const out = composeSystemPrompt(def);
    expect(out.startsWith('[ROLE] R\n[GOAL] G\n[BACKSTORY] B')).toBe(true);
    expect(out).toContain('---');
    expect(out.endsWith('BODY CONTENT.')).toBe(true);
  });

  test('partial tuple (role only) still emits header', () => {
    const def: AgentDefinition = { ...baseDef, role: 'R' };
    const out = composeSystemPrompt(def);
    expect(out).toContain('[ROLE] R');
    expect(out).toContain('---');
    expect(out).not.toContain('[GOAL]');
  });

  test('memoryPrompt appended', () => {
    const out = composeSystemPrompt(baseDef, { memoryPrompt: 'MEM' });
    expect(out.endsWith('MEM')).toBe(true);
  });

  test('whitespace-only memoryPrompt ignored', () => {
    const out = composeSystemPrompt(baseDef, { memoryPrompt: '   \n  ' });
    expect(out).toBe('BODY CONTENT.');
  });
});

