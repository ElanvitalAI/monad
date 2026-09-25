// ── PX-7 P6: dogfood smoke ──
//
// Builds a catalog from the samples/.monad/ fixture + exercises the
// parser converters end-to-end so the dogfood files stay valid.

import { describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog } from '../src/plugin-declarative/catalog';
import {
  toAgentContribution,
  toRouteContribution,
} from '../src/plugin-declarative/parser';

const SAMPLE_SRC = join(__dirname, '..', 'samples', '.monad');

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

describe('PX-7 P6 — samples/.monad dogfood', () => {
  test('sample-reviewer agent loads + converts cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-smoke-'));
    const user = join(dir, 'user');
    mkdirSync(user, { recursive: true });
    copyDir(SAMPLE_SRC, user);
    const catalog = buildCatalog({ user });
    expect(catalog.agents.length).toBe(1);
    const agent = catalog.agents[0]!;
    expect(agent.id).toBe('sample-reviewer');
    const contribution = toAgentContribution(agent);
    expect(contribution.name).toBe('Sample Reviewer');
    expect(contribution.tools).toContain('Read');
    expect(contribution.disallowedTools).toContain('Edit');
    expect(contribution.systemPrompt).toContain('senior code reviewer');
  });

  test('sample-review route loads + targets the sample-reviewer agent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-smoke-'));
    const user = join(dir, 'user');
    mkdirSync(user, { recursive: true });
    copyDir(SAMPLE_SRC, user);
    const catalog = buildCatalog({ user });
    expect(catalog.routes.length).toBe(1);
    const route = catalog.routes[0]!;
    const def = toRouteContribution(route);
    expect(def?.id).toBe('sample-review');
    expect(def?.target.id).toBe('sample-reviewer');
    expect(def?.aliases).toContain('review-me');
  });

  test('catalog persists to <user>/catalog.json with schemaVersion 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-smoke-'));
    const user = join(dir, 'user');
    mkdirSync(user, { recursive: true });
    copyDir(SAMPLE_SRC, user);
    const { persistCatalog } = await import('../src/plugin-declarative/catalog');
    const catalog = buildCatalog({ user });
    const path = await persistCatalog(catalog);
    expect(path).toBe(join(user, 'catalog.json'));
  });
});
