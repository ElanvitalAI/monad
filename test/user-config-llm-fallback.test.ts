// ── User-config LLM fallback substrate (2026-05-13) ────────────────────
//
// `~/.monad/llm-fallback.json` 이 read-only 보조 fallback file. primary
// `~/.monad/config.json` 의 `llm` section 이 sparse-wipe 되어도 daemon
// boot 가 통과하도록 cascade.
//
// 본 test 가 검증:
//   1. fallback 파일 부재 시 → 기존 동작 (default LLM_DEFAULTS)
//   2. primary llm 비어있고 fallback 존재 → fallback 값 채택
//   3. primary llm 정상 → fallback 무시
//   4. fallback 도 sparse (provider=auto) → 채택 안 함 · default

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir';
import { buildUserConfig, llmFallbackPath, readLlmFallback } from '../src/user-config';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'user-config-llm-fallback-'));
  setMonadConfigDir(root);
});

afterEach(() => {
  resetMonadConfigDir();
  rmSync(root, { recursive: true, force: true });
});

function writePrimary(obj: Record<string, unknown>): void {
  writeFileSync(join(root, 'config.json'), JSON.stringify(obj), 'utf-8');
}

function writeFallback(obj: Record<string, unknown>): void {
  writeFileSync(join(root, 'llm-fallback.json'), JSON.stringify(obj), 'utf-8');
}

describe('LLM fallback substrate', () => {
  test('fallback 경로가 config.json sibling', () => {
    const fb = llmFallbackPath();
    expect(fb.endsWith('llm-fallback.json')).toBe(true);
    expect(fb).toContain(root);
  });

  test('fallback 파일 부재 시 readLlmFallback → null', () => {
    expect(readLlmFallback()).toBeNull();
  });

  test('fallback 파일 정상 시 readLlmFallback → object', () => {
    writeFallback({ provider: 'local', baseUrl: 'http://localhost:1234/v1' });
    const fb = readLlmFallback();
    expect(fb).not.toBeNull();
    expect((fb as Record<string, unknown>).provider).toBe('local');
  });

  test('primary llm 비어있고 fallback 존재 → fallback 채택', () => {
    writePrimary({ version: 1, global: {}, tabs: {} }); // sparse · no llm
    writeFallback({
      provider: 'local',
      baseUrl: 'http://localhost:1234/v1',
      model: 'gemma',
    });
    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('local');
    expect(cfg.llm.baseUrl).toBe('http://localhost:1234/v1');
    expect(cfg.llm.model).toBe('gemma');
  });

  test('primary llm 정상 → fallback 무시 (primary 가 우선)', () => {
    writePrimary({
      version: 1,
      global: {},
      tabs: {},
      llm: { provider: 'anthropic', model: 'claude-opus' },
    });
    writeFallback({ provider: 'local', baseUrl: 'http://localhost:1234/v1' });
    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('anthropic');
    expect(cfg.llm.model).toBe('claude-opus');
    expect(cfg.llm.baseUrl).toBeUndefined();
  });

  test('primary llm 비어있고 fallback 도 sparse (provider=auto) → 채택 안 함 · default', () => {
    writePrimary({ version: 1, global: {}, tabs: {} });
    writeFallback({ provider: 'auto' });
    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('auto');
  });

  test('primary llm.provider = "auto" (= sparse) + fallback 정상 → fallback 채택', () => {
    writePrimary({
      version: 1,
      global: {},
      tabs: {},
      llm: { provider: 'auto' },
    });
    writeFallback({ provider: 'local', baseUrl: 'http://localhost:1234/v1' });
    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('local');
    expect(cfg.llm.baseUrl).toBe('http://localhost:1234/v1');
  });

  test('primary llm.provider = "none" (= sparse) + fallback 정상 → fallback 채택', () => {
    writePrimary({
      version: 1,
      global: {},
      tabs: {},
      llm: { provider: 'none' },
    });
    writeFallback({ provider: 'anthropic', apiKey: 'sk-test' });
    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('anthropic');
    expect(cfg.llm.apiKey).toBe('sk-test');
  });
});
