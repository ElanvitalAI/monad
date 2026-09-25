// Validates the mss-instrument-agent plugin scaffold (PLAN §11.5 · M0).
//
// Reads the on-disk plugin.json + agent body straight from the repo so a
// typo in either file breaks CI. Tests cover manifest parse + agent
// frontmatter shape + CLAUDE.md rule reference wiring (critical-junction
// anchor must survive future edits).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePluginManifest } from '../../src/plugins/core/manifest.js';
import { parseAgentFrontmatter } from '../../src/agent/loader.js';

const PLUGIN_DIR = join(import.meta.dir, '..', '..', 'plugins', 'mss-instrument-agent');

describe('mss-instrument-agent scaffold', () => {
  test('plugin.json parses with exactly one bodyPath-based agent', () => {
    const raw = JSON.parse(readFileSync(join(PLUGIN_DIR, 'plugin.json'), 'utf8'));
    const manifest = parsePluginManifest(raw);
    expect(manifest.id).toBe('mss-instrument-agent');
    expect(manifest.contributes.agents).toHaveLength(1);
    const a = manifest.contributes.agents![0];
    expect(a.bodyPath).toBe('./agents/mss-instrument-reviewer.md');
  });

  test('agent body frontmatter declares read-only tool surface', () => {
    const body = readFileSync(join(PLUGIN_DIR, 'agents', 'mss-instrument-reviewer.md'), 'utf8');
    const { fm } = parseAgentFrontmatter(body);
    expect(fm.name).toBe('mss-instrument-reviewer');
    expect(fm.model).toBe('haiku');
    expect(fm.permissionMode).toBe('plan');
    // Read-only tools only
    expect(fm.tools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']));
    // Must explicitly disallow edit/write/shell
    expect(fm.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash']));
  });

  test('agent body references the 8-track category map from PLAN §11.5.2', () => {
    const body = readFileSync(join(PLUGIN_DIR, 'agents', 'mss-instrument-reviewer.md'), 'utf8');
    // sample a handful of prefixes — if the table drifts, the test catches it
    for (const prefix of ['pfc.*', 'idx.*', 'axon.*', 'kgs.*', 'iul.*', 'mss.*']) {
      expect(body).toContain(prefix);
    }
  });

  test('agent body cites CLAUDE.md critical-junction rule', () => {
    const body = readFileSync(join(PLUGIN_DIR, 'agents', 'mss-instrument-reviewer.md'), 'utf8');
    expect(body.toLowerCase()).toContain('critical junction');
    // proposal contract — parent applies edits, agent never edits
    expect(body).toContain('never edit');
  });

  test('agent body cap = 10 turns (budget discipline)', () => {
    const body = readFileSync(join(PLUGIN_DIR, 'agents', 'mss-instrument-reviewer.md'), 'utf8');
    const { fm } = parseAgentFrontmatter(body);
    expect(fm.maxTurns).toBe(10);
  });
});
