// RFC #2161 Phase 3 — verify GET /v1/registry/catalog wire shape.

import { describe, expect, it } from 'bun:test';
import { handleRegistryCatalog } from '../src/nexus/api/registry-catalog.js';
import type { CatalogResponse } from '../src/nexus/api/registry-catalog.js';

describe('handleRegistryCatalog (GET /v1/registry/catalog)', () => {
  it('returns 200 + catalog snapshot', async () => {
    const resp = handleRegistryCatalog();
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as CatalogResponse;
    expect(typeof body.catalogVersion).toBe('number');
    expect(Array.isArray(body.providers)).toBe(true);
    expect(Array.isArray(body.models)).toBe(true);
    expect(Array.isArray(body.patterns)).toBe(true);
    expect(typeof body.manifest.fileCount).toBe('number');
    expect(typeof body.manifest.loadedAt).toBe('string');
  });

  it('exposes the 5 builtin providers (anthropic / openai / gemini / grok / local)', async () => {
    const body = (await handleRegistryCatalog().json()) as CatalogResponse;
    const ids = new Set(body.providers.map((p) => p.id));
    expect(ids.has('anthropic')).toBe(true);
    expect(ids.has('openai')).toBe(true);
    expect(ids.has('gemini')).toBe(true);
    expect(ids.has('grok')).toBe(true);
    expect(ids.has('local')).toBe(true);
  });

  it('returns providers sorted by id (deterministic dropdown order)', async () => {
    const body = (await handleRegistryCatalog().json()) as CatalogResponse;
    const ids = body.providers.map((p) => p.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('every provider has the canonical capability matrix surface', async () => {
    const body = (await handleRegistryCatalog().json()) as CatalogResponse;
    for (const p of body.providers) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.displayName).toBe('string');
      expect(typeof p.builtIn).toBe('boolean');
      expect(Array.isArray(p.aliases)).toBe(true);
      expect(Array.isArray(p.modelPrefixes)).toBe(true);
      expect(typeof p.capabilities).toBe('object');
      // 14 boolean flags expected in PROVIDER_CAPABILITIES_NONE template.
      const flagCount = Object.keys(p.capabilities).length;
      expect(flagCount).toBe(14);
    }
  });

  it('includes the catalog seed models from omni-crawl (claude-opus-4-7 etc.)', async () => {
    const body = (await handleRegistryCatalog().json()) as CatalogResponse;
    const ids = new Set(body.models.map((m) => m.id));
    // Seed sanity check — at least one signature model per major provider.
    const expected = ['claude-opus-4-7', 'gpt-5.5', 'gemini-3.1-pro-preview', 'grok-4.3'];
    for (const id of expected) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('content-type is application/json', () => {
    const resp = handleRegistryCatalog();
    expect(resp.headers.get('content-type')).toContain('application/json');
  });
});
