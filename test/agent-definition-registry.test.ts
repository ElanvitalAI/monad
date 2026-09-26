// Tests for agent definition-registry — 4-layer precedence + reserved-id warnings (PFC PX-1).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RESERVED_AGENT_IDS,
  loadAgentsLayered,
} from '../src/agent/definition-registry.js';

let tmp: string;

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'def-reg-')); });
afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

function writeAgent(dir: string, name: string, fm: Record<string, string> = {}, body = 'BODY'): void {
  mkdirSync(dir, { recursive: true });
  const lines = ['---', `name: ${name}`, ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', body];
  writeFileSync(join(dir, `${name}.md`), lines.join('\n'));
}

describe('loadAgentsLayered — precedence', () => {
  test('project > user > plugin-builtin > builtin', () => {
    const builtinDir = join(tmp, 'builtin');
    const pluginDir = join(tmp, 'plugins', 'agent-team');
    const userDir = join(tmp, 'user');
    const projectAgentsDir = join(tmp, '.elanous', 'agents');

    writeAgent(builtinDir, 'explore', {}, 'from builtin');
    mkdirSync(join(pluginDir, 'agents'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'agents', 'explore.md'),
      '---\nname: explore\n---\nfrom plugin-builtin',
    );
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'agent-team',
        version: '0.1.0',
        main: './plugin.ts',
        contributes: { agents: [{ bodyPath: './agents/explore.md' }] },
        capabilities: [],
      }),
    );
    writeAgent(userDir, 'explore', {}, 'from user');
    writeAgent(projectAgentsDir, 'explore', {}, 'from project');

    const { agents, report } = loadAgentsLayered({
      builtinDir,
      userDir,
      projectRoot: tmp,
      pluginsRoot: 'plugins',
    });

    expect(agents.get('explore')?.systemPrompt).toBe('from project');
    expect(agents.get('explore')?.source).toBe('project');
    expect(report.overrides.length).toBeGreaterThanOrEqual(3);
    // Last override entry should be project beating user.
    const finalOverride = report.overrides[report.overrides.length - 1];
    expect(finalOverride.winnerSource).toBe('project');
  });

  test('reserved id overridden by user emits warning', () => {
    const builtinDir = join(tmp, 'builtin');
    const userDir = join(tmp, 'user');
    writeAgent(builtinDir, 'plan', {}, 'builtin plan');
    writeAgent(userDir, 'plan', {}, 'user plan');
    const { report } = loadAgentsLayered({ builtinDir, userDir, projectRoot: tmp, skipPlugin: true });
    expect(report.warnings.some(w => w.includes("override of reserved builtin 'plan'"))).toBe(true);
  });

  test('reserved id from plugin-builtin does NOT warn', () => {
    const pluginDir = join(tmp, 'plugins', 'agent-team');
    mkdirSync(join(pluginDir, 'agents'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'agents', 'critic.md'),
      '---\nname: critic\n---\nplugin critic',
    );
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'agent-team',
        version: '0.1.0',
        main: './plugin.ts',
        contributes: { agents: [{ bodyPath: './agents/critic.md' }] },
        capabilities: [],
      }),
    );
    const { report } = loadAgentsLayered({
      builtinDir: join(tmp, 'none'),
      userDir: join(tmp, 'nouser'),
      projectRoot: tmp,
      pluginsRoot: 'plugins',
      skipProject: true,
    });
    expect(report.warnings.filter(w => w.includes('override of reserved'))).toHaveLength(0);
  });
});

describe('loadAgentsLayered — skip flags', () => {
  test('skipAll options produce empty result', () => {
    const { agents, report } = loadAgentsLayered({
      projectRoot: tmp,
      skipBuiltin: true,
      skipUser: true,
      skipProject: true,
      skipPlugin: true,
      builtinDir: join(tmp, 'bogus'),
      userDir: join(tmp, 'bogus'),
    });
    expect(agents.size).toBe(0);
    expect(report.registered).toBe(0);
  });

  test('isDisabled filters the final layered registry without changing report counts', () => {
    const builtinDir = join(tmp, 'builtin');
    writeAgent(builtinDir, 'alpha', {}, 'builtin alpha');
    writeAgent(builtinDir, 'beta', {}, 'builtin beta');

    const { agents, report } = loadAgentsLayered({
      builtinDir,
      userDir: join(tmp, 'no-user'),
      projectRoot: tmp,
      skipPlugin: true,
      skipProject: true,
      isDisabled: (name) => name === 'alpha',
    });

    expect(agents.has('alpha')).toBe(false);
    expect(agents.has('beta')).toBe(true);
    expect(report.registered).toBe(2);
  });
});

describe('RESERVED_AGENT_IDS', () => {
  test('contains the 5 PFC builtins', () => {
    expect(RESERVED_AGENT_IDS).toEqual(['explore', 'plan', 'research', 'critic', 'executor']);
    expect(Object.isFrozen(RESERVED_AGENT_IDS)).toBe(true);
  });
});
