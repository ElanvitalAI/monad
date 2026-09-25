// ── PX-5 P5: agent-team routes dogfood ──
//
// Verifies the agent-team manifest parses and carries 5 routes that
// match the 5 PFC builtin agent definitions shipped in the same
// plugin. The full activate/dispatch lifecycle is covered elsewhere
// (plugin-host.test.ts handles ownedRouteDisposers via the same
// pattern as ownedHookDisposers); here we just assert the new
// declarative surface round-trips.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('PX-5 P5 — agent-team contributes.routes[] dogfood', () => {
  test('manifest declares 5 routes matching the 5 PFC builtin agents', () => {
    const manifest = loadAgentTeamManifest();
    const routes = manifest.contributes.routes ?? [];
    expect(routes.length).toBe(5);
    const ids = routes.map(r => r.id);
    expect(ids.sort()).toEqual(['critic', 'executor', 'explore', 'plan', 'research']);
  });

  test('every route targets an agent (kind=agent)', () => {
    const manifest = loadAgentTeamManifest();
    for (const r of manifest.contributes.routes ?? []) {
      expect(r.target.kind).toBe('agent');
    }
  });

  test('primary id matches target.id (1:1 with agent name)', () => {
    const manifest = loadAgentTeamManifest();
    for (const r of manifest.contributes.routes ?? []) {
      expect(r.target.id).toBe(r.id);
    }
  });

  test('aliases provide natural-language alternatives', () => {
    const manifest = loadAgentTeamManifest();
    const byId = new Map(
      (manifest.contributes.routes ?? []).map(r => [r.id, r.aliases ?? []]),
    );
    expect(byId.get('explore')).toContain('search');
    expect(byId.get('plan')).toContain('design');
    expect(byId.get('research')).toContain('investigate');
    expect(byId.get('critic')).toContain('review');
    expect(byId.get('executor')).toContain('implement');
  });
});
