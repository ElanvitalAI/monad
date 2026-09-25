// Tests for plugin-contributed agent materialisation (PFC PX-1).
// Exercises contributes.agents[] inline + bodyPath paths.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPluginContributedAgents } from '../src/agent/plugin-agents.js';

let tmp: string;

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'plugin-agents-')); });
afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

function writePluginManifest(pluginDir: string, contributes: Record<string, unknown>): void {
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: pluginDir.split('/').pop(),
      version: '0.1.0',
      main: './plugin.ts',
      contributes,
      capabilities: [],
    }),
  );
}

describe('loadPluginContributedAgents', () => {
  test('no plugins dir → empty, no errors', () => {
    const r = loadPluginContributedAgents(join(tmp, 'nope'));
    expect(r.defs).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });

  test('plugin without agents contribution → empty', () => {
    writePluginManifest(join(tmp, 'plugins', 'other'), {});
    const r = loadPluginContributedAgents(tmp);
    expect(r.defs).toHaveLength(0);
  });

  test('bodyPath entry materialised via parseAgentFile', () => {
    const plugDir = join(tmp, 'plugins', 'agent-team');
    mkdirSync(join(plugDir, 'agents'), { recursive: true });
    writeFileSync(
      join(plugDir, 'agents', 'explore.md'),
      [
        '---',
        'name: explore',
        'description: Codebase scout',
        'model: haiku',
        'tools: [Read, Glob]',
        'omitClaudeMd: true',
        '---',
        'Explore body.',
      ].join('\n'),
    );
    writePluginManifest(plugDir, {
      agents: [{ bodyPath: './agents/explore.md' }],
    });
    const r = loadPluginContributedAgents(tmp);
    expect(r.defs).toHaveLength(1);
    const d = r.defs[0];
    expect(d.name).toBe('explore');
    expect(d.source).toBe('plugin-builtin');
    expect(d.description).toBe('Codebase scout');
    expect(d.model).toBe('haiku');
    expect(d.tools).toEqual(['Read', 'Glob']);
    expect(d.omitInheritedContext).toBe(true);
    expect(d.systemPrompt).toBe('Explore body.');
  });

  test('inline entry materialised — manifest id wins over fm absence', () => {
    const plugDir = join(tmp, 'plugins', 'agent-team');
    writePluginManifest(plugDir, {
      agents: [
        {
          id: 'plan',
          name: 'Plan',
          description: 'Design implementation',
          systemPrompt: 'You are Plan.',
          model: 'sonnet',
          tools: ['Read'],
          permissionMode: 'plan',
        },
      ],
    });
    const r = loadPluginContributedAgents(tmp);
    expect(r.defs).toHaveLength(1);
    expect(r.defs[0].name).toBe('Plan');
    expect(r.defs[0].model).toBe('sonnet');
    expect(r.defs[0].permissionMode).toBe('plan');
    expect(r.defs[0].tools).toEqual(['Read']);
    expect(r.defs[0].source).toBe('plugin-builtin');
  });

  test('inline entry gives omitInheritedContext precedence over omitClaudeMd', () => {
    const plugDir = join(tmp, 'plugins', 'agent-team');
    writePluginManifest(plugDir, {
      agents: [{
        id: 'context-precedence',
        systemPrompt: 'You are a slim agent.',
        omitClaudeMd: true,
        omitInheritedContext: false,
      }],
    });
    const r = loadPluginContributedAgents(tmp);
    expect(r.defs).toHaveLength(1);
    expect(r.defs[0].omitInheritedContext).toBe(false);
    expect('omitClaudeMd' in r.defs[0]).toBe(false);
  });

  test('manifest id/description override wins over bodyPath frontmatter', () => {
    const plugDir = join(tmp, 'plugins', 'agent-team');
    mkdirSync(join(plugDir, 'agents'), { recursive: true });
    writeFileSync(
      join(plugDir, 'agents', 'a.md'),
      '---\nname: original\ndescription: original-desc\n---\nbody',
    );
    writePluginManifest(plugDir, {
      agents: [{ id: 'override-name', description: 'override-desc', bodyPath: './agents/a.md' }],
    });
    const r = loadPluginContributedAgents(tmp);
    expect(r.defs).toHaveLength(1);
    // manifest id wins
    expect(r.defs[0].name).toBe('override-name');
    expect(r.defs[0].description).toBe('override-desc');
  });

  test('missing bodyPath → error, not thrown', () => {
    const plugDir = join(tmp, 'plugins', 'agent-team');
    writePluginManifest(plugDir, {
      agents: [{ bodyPath: './missing.md' }],
    });
    const r = loadPluginContributedAgents(tmp);
    expect(r.defs).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('bodyPath not found');
  });
});
