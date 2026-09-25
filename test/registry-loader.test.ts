// RFC #2161 Phase 1 — registry loader (Layer A static catalog).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCatalog, reloadCatalog, __resetCatalogForTests,
} from '../src/registry/loader';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

const prevTestHome = process.env.MONAD_TEST_HOME;
const prevBuiltin = process.env.MONAD_BUILTIN_CATALOG_DIR;

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cat-loader-'));
  process.env.MONAD_TEST_HOME = tmpHome;
  setMonadConfigDir(join(tmpHome, '.monad'));
  delete process.env.MONAD_BUILTIN_CATALOG_DIR;       // use repo's catalog/
  __resetCatalogForTests();
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  resetMonadConfigDir();
  if (prevTestHome === undefined) delete process.env.MONAD_TEST_HOME;
  else process.env.MONAD_TEST_HOME = prevTestHome;
  if (prevBuiltin === undefined) delete process.env.MONAD_BUILTIN_CATALOG_DIR;
  else process.env.MONAD_BUILTIN_CATALOG_DIR = prevBuiltin;
  __resetCatalogForTests();
});

describe('getCatalog · builtin tier', () => {
  test('loads all 5 builtin providers', () => {
    const cat = getCatalog();
    expect(cat.providers.has('anthropic')).toBe(true);
    expect(cat.providers.has('openai')).toBe(true);
    expect(cat.providers.has('grok')).toBe(true);
    expect(cat.providers.has('gemini')).toBe(true);
    expect(cat.providers.has('local')).toBe(true);
  });

  test('anthropic provider has aliases / modelPrefixes / apiKeyEnv parsed', () => {
    const cat = getCatalog();
    const p = cat.providers.get('anthropic');
    expect(p).toBeDefined();
    expect(p!.aliases).toContain('claude');
    expect(p!.modelPrefixes).toContain('claude-');
    expect(p!.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
    expect(p!.toolCallingFormat).toBe('native-anthropic');
    expect(p!.builtIn).toBe(true);
  });

  test('local provider has multiHostFanout=true and openai-compat tool format', () => {
    const cat = getCatalog();
    const p = cat.providers.get('local');
    expect(p).toBeDefined();
    expect(p!.capabilities.multiHostFanout).toBe(true);
    expect(p!.toolCallingFormat).toBe('native-openai');
    expect(p!.builtIn).toBe(false);
  });

  test('catalog has the currently-shipping models (sanity)', () => {
    const cat = getCatalog();
    expect(cat.models.has('claude-opus-4-7')).toBe(true);
    expect(cat.models.has('claude-sonnet-4-6')).toBe(true);
    expect(cat.models.has('claude-haiku-4-5')).toBe(true);
    expect(cat.models.has('gpt-5.5')).toBe(true);
    expect(cat.models.has('grok-4.3')).toBe(true);
    expect(cat.models.has('gemini-3.1-pro-preview')).toBe(true);
  });

  test('claude-opus-4-7 has accurate pricing + 1M context', () => {
    const cat = getCatalog();
    const m = cat.models.get('claude-opus-4-7');
    expect(m).toBeDefined();
    expect(m!.contextSize).toBe(1_000_000);
    expect(m!.outputMaxTokens).toBe(128_000);
    expect(m!.pricing?.inputPerMTok).toBe(5.0);
    expect(m!.pricing?.outputPerMTok).toBe(25.0);
    expect(m!.familyShortcut).toBe('opus');
  });

  test('_patterns.yaml registers prefix fallback per provider', () => {
    const cat = getCatalog();
    expect(cat.patterns.has('anthropic')).toBe(true);
    expect(cat.patterns.has('local')).toBe(true);
    const local = cat.patterns.get('local');
    expect(local).toBeDefined();
    const prefixes = local!.prefixes.map((p) => p.prefix);
    expect(prefixes).toContain('gemma-');
    expect(prefixes).toContain('qwen-');
    expect(prefixes).toContain('llama-');
  });

  test('manifest reports source dirs and file count', () => {
    const cat = getCatalog();
    expect(cat.manifest.builtinSource).toContain('catalog');
    expect(cat.manifest.fileCount).toBeGreaterThan(15);
    expect(cat.manifest.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('reloadCatalog · cache invalidation', () => {
  test('reloadCatalog returns a fresh snapshot', () => {
    const before = getCatalog();
    const after = reloadCatalog();
    expect(after).not.toBe(before);
    expect(after.providers.size).toBe(before.providers.size);
  });
});

describe('global tier overlay', () => {
  test('global provider yaml extends aliases (union per RFC §6.4)', () => {
    // Seed a global tier override for anthropic — adds an alias.
    const globalProvDir = join(tmpHome, '.monad', 'catalog', 'providers');
    mkdirSync(globalProvDir, { recursive: true });
    writeFileSync(
      join(globalProvDir, 'anthropic.yaml'),
      [
        'id: anthropic',
        'aliases: [team-claude]',
        'modelPrefixes: [my-claude-]',
      ].join('\n'),
      'utf-8',
    );
    __resetCatalogForTests();

    const cat = getCatalog();
    const p = cat.providers.get('anthropic')!;
    // Builtin alias preserved.
    expect(p.aliases).toContain('claude');
    // Global alias added.
    expect(p.aliases).toContain('team-claude');
    // modelPrefixes union.
    expect(p.modelPrefixes).toContain('claude-');
    expect(p.modelPrefixes).toContain('my-claude-');
  });

  test('global model.yaml overrides builtin (replace semantics)', () => {
    const globalModelDir = join(tmpHome, '.monad', 'catalog', 'models', 'anthropic');
    mkdirSync(globalModelDir, { recursive: true });
    writeFileSync(
      join(globalModelDir, 'claude-opus-4-7.yaml'),
      [
        'id: claude-opus-4-7',
        'provider: anthropic',
        'displayName: My Custom Opus',
        'contextSize: 2000000',
      ].join('\n'),
      'utf-8',
    );
    __resetCatalogForTests();

    const cat = getCatalog();
    const m = cat.models.get('claude-opus-4-7')!;
    expect(m.displayName).toBe('My Custom Opus');
    expect(m.contextSize).toBe(2_000_000);
  });

  test('global _patterns.yaml extends prefix list (per provider)', () => {
    const globalLocalDir = join(tmpHome, '.monad', 'catalog', 'models', 'local');
    mkdirSync(globalLocalDir, { recursive: true });
    writeFileSync(
      join(globalLocalDir, '_patterns.yaml'),
      [
        'provider: local',
        'prefixes:',
        '  - prefix: my-finetune-',
        '    fallback:',
        '      provider: local',
        '      family: custom',
        '      tokenizer: unknown',
        '      kind: chat',
      ].join('\n'),
      'utf-8',
    );
    __resetCatalogForTests();

    const cat = getCatalog();
    const local = cat.patterns.get('local')!;
    const prefixes = local.prefixes.map((p) => p.prefix);
    expect(prefixes).toContain('gemma-');           // builtin preserved
    expect(prefixes).toContain('my-finetune-');     // global appended
  });
});

describe('malformed input', () => {
  test('malformed yaml is skipped (loader keeps going)', () => {
    const globalProvDir = join(tmpHome, '.monad', 'catalog', 'providers');
    mkdirSync(globalProvDir, { recursive: true });
    writeFileSync(join(globalProvDir, 'broken.yaml'), '{ this is not yaml: [', 'utf-8');
    __resetCatalogForTests();
    expect(() => getCatalog()).not.toThrow();
    const cat = getCatalog();
    // Builtins still load.
    expect(cat.providers.has('anthropic')).toBe(true);
  });

  test('global yaml without id is dropped gracefully', () => {
    const globalProvDir = join(tmpHome, '.monad', 'catalog', 'providers');
    mkdirSync(globalProvDir, { recursive: true });
    writeFileSync(join(globalProvDir, 'noid.yaml'), 'displayName: Anonymous\n', 'utf-8');
    __resetCatalogForTests();
    expect(() => getCatalog()).not.toThrow();
  });
});
