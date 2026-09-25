import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChatSystemPrompt } from '../src/prompt-library/registry.js';

describe('resolveChatSystemPrompt', () => {
  test('anthropic model gets the anthropic variant', () => {
    const r = resolveChatSystemPrompt({
      model: 'claude-opus-4-1',
      config: { taskVariant: 'default' },
    });
    expect(r.variant).toBe('claude');
    expect(r.text).toContain('TodoWrite-style planning discipline');
  });

  test('gpt model gets the gpt variant', () => {
    const r = resolveChatSystemPrompt({
      model: 'gpt-4.1',
      config: { taskVariant: 'default' },
    });
    expect(r.variant).toBe('gpt');
    expect(r.text).toContain('smallest correct change');
    expect(r.text).toContain('parallel');
  });

  test('codex model gets the codex variant', () => {
    const r = resolveChatSystemPrompt({
      model: 'gpt-5.4',
      config: { taskVariant: 'default' },
    });
    expect(r.variant).toBe('codex');
    expect(r.text).toContain('Provider variant: codex');
    expect(r.text).toContain('Use dashboard state only to orient once');
    expect(r.text).toContain('Treat skill hints as execution guidance');
    expect(r.text).toContain('Treat debug lines and HUD noise as observational context');
    expect(r.text).toContain('narrow quickly: use one broad search');
    expect(r.text).toContain('WebSearch for fast provider-backed lookup');
    expect(r.text).toContain('Never re-call a read-only state tool');
    expect(r.text).toContain('action-oriented');
  });

  test('override path fully replaces builtin variant text', () => {
    const root = mkdtempSync(join(tmpdir(), 'prompt-override-'));
    try {
      const path = join(root, 'override.md');
      writeFileSync(path, 'OVERRIDE PROMPT\n');
      const r = resolveChatSystemPrompt({
        model: 'claude-opus-4-1',
        config: { overridePath: path, taskVariant: 'default' },
      });
      expect(r.source).toBe('override');
      expect(r.text).toBe('OVERRIDE PROMPT\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('forced builtin variant can route codex-family models to the gpt prompt', () => {
    const r = resolveChatSystemPrompt({
      model: 'gpt-5.4',
      config: { taskVariant: 'default', forceBuiltinVariant: 'gpt' },
    });
    expect(r.variant).toBe('gpt');
    expect(r.text).toContain('Provider variant: gpt');
    expect(r.text).not.toContain('Provider variant: codex');
  });
});
