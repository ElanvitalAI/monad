// ── PFC-S5 P1: model catalog ──

import { describe, test, expect } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_CATALOG,
  discoverModels,
  enabledModels,
  getCatalogPath,
  loadCatalog,
  persistCatalog,
} from '../src/intelligence-map/model-catalog';

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), 'catalog-test-'));
}

describe('PFC-S5 P1 — model catalog', () => {
  test('BUILTIN_CATALOG has expected shape', () => {
    expect(BUILTIN_CATALOG.version).toBe(1);
    expect(BUILTIN_CATALOG.models.length).toBeGreaterThanOrEqual(8);
    const ids = BUILTIN_CATALOG.models.map(m => m.id);
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some(id => id.startsWith('claude-'))).toBe(true);
    expect(ids.some(id => id.startsWith('qwen'))).toBe(true);
    expect(BUILTIN_CATALOG.models.every(m => m.tags.length > 0)).toBe(true);
  });

  test('loadCatalog returns builtin when file absent', () => {
    const home = scratchHome();
    const res = loadCatalog({ home });
    expect(res.source).toBe('builtin');
    expect(res.catalog.models.length).toBe(BUILTIN_CATALOG.models.length);
    expect(res.notices.length).toBeGreaterThan(0);
  });

  test('MONAD_MODELS_JSON env override', () => {
    const home = scratchHome();
    const custom = join(home, 'my-models.json');
    writeFileSync(custom, JSON.stringify({
      version: 1,
      updated: 1,
      models: [{
        id: 'custom-model', provider: 'other', family: 'cust', contextWindow: 1000,
        inputPerMtok: 0, outputPerMtok: 0, local: true, tags: ['test'], bestFor: [],
      }],
    }));
    const res = loadCatalog({ env: { MONAD_MODELS_JSON: custom }, home });
    expect(res.source).toBe('env');
    expect(res.catalog.models.length).toBe(1);
    expect(res.catalog.models[0]?.id).toBe('custom-model');
  });

  test('persist+load round-trip', async () => {
    const home = scratchHome();
    const path = getCatalogPath(home);
    await persistCatalog({
      version: 1,
      updated: Date.now(),
      models: [{
        id: 'x', provider: 'other', family: 'y', contextWindow: 1000,
        inputPerMtok: 1, outputPerMtok: 2, local: false, tags: [], bestFor: [],
      }],
    }, { home });
    expect(existsSync(path)).toBe(true);
    const loaded = loadCatalog({ home });
    expect(loaded.source).toBe('file');
    expect(loaded.catalog.models[0]?.id).toBe('x');
  });

  test('corrupt file falls back to builtin with notice', () => {
    const home = scratchHome();
    const path = getCatalogPath(home);
    // write garbage
    const fs = require('node:fs');
    fs.mkdirSync(path.substring(0, path.lastIndexOf('/')), { recursive: true });
    writeFileSync(path, '{not json', 'utf-8');
    const res = loadCatalog({ home });
    expect(res.source).toBe('fallback');
    expect(res.notices[0]).toMatch(/parse failed/);
    expect(res.catalog.models.length).toBe(BUILTIN_CATALOG.models.length);
  });

  test('invalid shape (version mismatch) → fallback', () => {
    const home = scratchHome();
    const path = getCatalogPath(home);
    const fs = require('node:fs');
    fs.mkdirSync(path.substring(0, path.lastIndexOf('/')), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 99, models: [] }));
    const res = loadCatalog({ home });
    expect(res.source).toBe('fallback');
  });

  test('enabledModels filter by ANTHROPIC_API_KEY presence', () => {
    const enabled = enabledModels(BUILTIN_CATALOG, { ANTHROPIC_API_KEY: 'sk-ant-xxx' });
    const anthropic = enabled.filter(m => m.provider === 'anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    const openai = enabled.filter(m => m.provider === 'openai');
    expect(openai.length).toBe(0);
  });

  test('enabledModels always includes local regardless of env', () => {
    const enabled = enabledModels(BUILTIN_CATALOG, {});
    const localOnly = enabled.filter(m => m.local);
    expect(localOnly.length).toBeGreaterThan(0);
  });

  test('discoverModels with persist:true writes file when source=builtin', async () => {
    const home = scratchHome();
    const catalog = await discoverModels({ home, persist: true });
    expect(catalog.models.length).toBe(BUILTIN_CATALOG.models.length);
    expect(existsSync(getCatalogPath(home))).toBe(true);
  });

  test('getCatalogPath honors home arg', () => {
    expect(getCatalogPath('/fake/home')).toBe('/fake/home/.monad/models.json');
  });
});
