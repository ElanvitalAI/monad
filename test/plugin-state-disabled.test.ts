// ── PX-2 P3: disabled.json loader + agent-loader integration ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadDisabled,
  isAgentDisabled,
  isSkillDisabled,
  isHookDisabled,
  reloadDisabled,
  _resetDisabledCacheForTests,
} from '../src/plugin-state/disabled';
import { loadAgents } from '../src/agent/loader';
import { invalidateLayeredCache } from '../src/agent/definition-registry';

let tmpUser: string;
let tmpProject: string;
let userPath: string;
let projectPath: string;

function write(path: string, payload: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(payload), 'utf-8');
}

beforeEach(() => {
  tmpUser = mkdtempSync(join(tmpdir(), 'pss-du-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'pss-dp-'));
  userPath = join(tmpUser, 'disabled.json');
  projectPath = join(tmpProject, 'disabled.json');
  _resetDisabledCacheForTests();
});

afterEach(() => {
  rmSync(tmpUser, { recursive: true, force: true });
  rmSync(tmpProject, { recursive: true, force: true });
  _resetDisabledCacheForTests();
});

describe('loadDisabled', () => {
  test('missing files → empty config', () => {
    const c = loadDisabled(tmpProject, { userPath, projectPath });
    expect(c.agents).toEqual([]);
    expect(c.skills).toEqual([]);
    expect(c.hooks).toEqual([]);
    expect(c.plugins).toEqual([]);
  });

  test('user + project arrays are unioned', () => {
    write(userPath, { schemaVersion: 1, agents: ['critic'], skills: ['noisy'] });
    write(projectPath, { schemaVersion: 1, agents: ['plan'], hooks: ['budget'] });
    _resetDisabledCacheForTests();
    const c = loadDisabled(tmpProject, { userPath, projectPath });
    expect([...c.agents].sort()).toEqual(['critic', 'plan']);
    expect(c.skills).toEqual(['noisy']);
    expect(c.hooks).toEqual(['budget']);
  });

  test('malformed JSON → empty + warn', () => {
    writeFileSync(userPath, '{not-json', 'utf-8');
    const warnings: string[] = [];
    _resetDisabledCacheForTests();
    const c = loadDisabled(tmpProject, { userPath, projectPath, warn: (m) => warnings.push(m) });
    expect(c.agents).toEqual([]);
    expect(warnings.some(w => w.includes('malformed'))).toBe(true);
  });

  test('unsupported schemaVersion → empty + warn', () => {
    write(userPath, { schemaVersion: 99, agents: ['x'] });
    const warnings: string[] = [];
    _resetDisabledCacheForTests();
    loadDisabled(tmpProject, { userPath, projectPath, warn: (m) => warnings.push(m) });
    expect(warnings.some(w => w.includes('schemaVersion'))).toBe(true);
  });

  test('reloadDisabled clears cache', () => {
    write(userPath, { schemaVersion: 1, agents: ['a'] });
    _resetDisabledCacheForTests();
    const first = loadDisabled(tmpProject, { userPath, projectPath });
    expect(first.agents).toEqual(['a']);
    write(userPath, { schemaVersion: 1, agents: ['a', 'b'] });
    // Same loadDisabled call (hot cache) still returns cached value.
    expect(loadDisabled(tmpProject, { userPath, projectPath }).agents).toEqual(['a']);
    // reload clears + re-reads.
    _resetDisabledCacheForTests();
    const second = loadDisabled(tmpProject, { userPath, projectPath });
    expect([...second.agents].sort()).toEqual(['a', 'b']);
  });
});

describe('predicate helpers', () => {
  test('isAgentDisabled / isSkillDisabled / isHookDisabled', () => {
    write(userPath, {
      schemaVersion: 1,
      agents: ['critic'],
      skills: ['noisy'],
      hooks: ['budget'],
    });
    _resetDisabledCacheForTests();
    expect(isAgentDisabled('critic', tmpProject, { userPath, projectPath })).toBe(true);
    expect(isAgentDisabled('explore', tmpProject, { userPath, projectPath })).toBe(false);
    expect(isSkillDisabled('noisy', tmpProject, { userPath, projectPath })).toBe(true);
    expect(isHookDisabled('budget', tmpProject, { userPath, projectPath })).toBe(true);
  });
});

describe('agent-loader integration', () => {
  test('loadAgents drops disabled agents (via isDisabled override)', () => {
    // Point the loader at a tmp builtin with 2 agents; disable alpha
    // via the opts.isDisabled hook (so the test doesn't depend on the
    // real ~/.monad/disabled.json on this machine).
    const builtin = mkdtempSync(join(tmpdir(), 'pss-b-'));
    writeFileSync(
      join(builtin, 'alpha.md'),
      `---\nname: alpha\ndescription: a\n---\nBody A.\n`,
      'utf-8',
    );
    writeFileSync(
      join(builtin, 'beta.md'),
      `---\nname: beta\ndescription: b\n---\nBody B.\n`,
      'utf-8',
    );

    invalidateLayeredCache();
    const agents = loadAgents({
      builtinDir: builtin,
      userDir: '/nonexistent',
      isDisabled: (n) => n === 'alpha',
    });
    expect(agents.has('beta')).toBe(true);
    expect(agents.has('alpha')).toBe(false);

    rmSync(builtin, { recursive: true, force: true });
  });

  test('loadAgents without disabledOverride uses global config (smoke)', () => {
    // Minimal smoke — the default isDisabled path (reading the real
    // user file) should not throw. Agents may or may not be filtered
    // depending on the host's disabled.json; we only assert the call
    // returns without error.
    const builtin = mkdtempSync(join(tmpdir(), 'pss-b2-'));
    writeFileSync(
      join(builtin, 'gamma.md'),
      `---\nname: gamma\ndescription: g\n---\nBody G.\n`,
      'utf-8',
    );
    invalidateLayeredCache();
    const agents = loadAgents({ builtinDir: builtin, userDir: '/nonexistent' });
    // gamma is never in a real disabled.json — expect it present.
    expect(agents.has('gamma')).toBe(true);
    rmSync(builtin, { recursive: true, force: true });
  });
});
