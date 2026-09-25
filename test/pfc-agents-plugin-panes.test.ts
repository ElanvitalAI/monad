// ── PFC-S2 P4: agent-team plugin contributes.panes[] dogfood ──
//
// The panes schema + host wiring predate this session (see
// plugin-manifest.test.ts + plugin-host.test.ts). This file just
// verifies the agent-team manifest correctly carries the new
// team-mailbox pane entry and that it round-trips through the parser.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePluginManifest } from '../src/plugins/core/manifest';

const AGENT_TEAM_MANIFEST_PATH = join(
  __dirname,
  '..',
  'plugins',
  'agent-team',
  'plugin.json',
);

function loadAgentTeamManifest() {
  const raw = JSON.parse(readFileSync(AGENT_TEAM_MANIFEST_PATH, 'utf-8'));
  return parsePluginManifest(raw);
}

describe('PFC-S2 P4 — agent-team contributes.panes[] dogfood', () => {
  test('manifest parses and exposes a team-mailbox pane', () => {
    const manifest = loadAgentTeamManifest();
    const panes = manifest.contributes.panes ?? [];
    expect(panes.length).toBe(1);
    expect(panes[0]).toMatchObject({
      id: 'team-mailbox',
      widget: 'markdown',
      title: 'Mailbox',
    });
  });

  test('pane carries a config.text hint about the mailbox layout', () => {
    const manifest = loadAgentTeamManifest();
    const cfg = manifest.contributes.panes?.[0]?.config ?? {};
    expect(cfg).toHaveProperty('text');
    expect(String(cfg.text)).toContain('Team Mailbox');
    expect(String(cfg.text)).toContain('team-mailbox');
  });

  test('bumped version + preserved agents[] entries', () => {
    const manifest = loadAgentTeamManifest();
    // PFC-S2 bumped to 0.3.0 (panes), PX-5 bumped again to 0.4.0 (routes).
    expect(manifest.version).toBe('0.4.0');
    expect(manifest.contributes.agents?.length).toBe(5);
  });
});
