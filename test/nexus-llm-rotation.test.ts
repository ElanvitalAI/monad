// ── NEXUS /v1/llm/rotation handlers (iOS Phase 1.5 · 2026-05-13) ──
//
// PR1 of the iOS chat basics cascade — model chip tap-to-cycle wire.
// `~/.elanous/config.json` の `llm.rotation` 가 SoT · top-level `llm.provider/
// model` 가 active. handleLlmRotationGet 가 list+active 반환 · handleLlmRotationNext
// 가 rotateNextProvider 호출 + saveUserConfig + reloadUserConfig.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setElanousConfigDir, resetElanousConfigDir } from '../src/elanous-config-dir';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexus-llm-rotation-'));
  setElanousConfigDir(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetElanousConfigDir();
});

function configPath(): string {
  return join(root, 'config.json');
}

function seedConfig(content: unknown): void {
  writeFileSync(configPath(), JSON.stringify(content, null, 2));
}

async function freshHandlers(): Promise<typeof import('../src/nexus/api/llm-rotation')> {
  // Invalidate the root user-config singleton cache between tests by
  // calling reloadUserConfig — the fresh getUserConfig path inside the
  // handler then re-reads the on-disk content.
  const { reloadUserConfig } = await import('../src/user-config');
  reloadUserConfig();
  return await import('../src/nexus/api/llm-rotation');
}

describe('GET /v1/llm/rotation', () => {
  test('empty rotation returns entries:[] · activeIndex:-1', async () => {
    seedConfig({
      llm: { provider: 'anthropic', model: 'claude-opus-4-6' },
    });
    const { handleLlmRotationGet } = await freshHandlers();
    const res = handleLlmRotationGet(new Request('http://localhost/v1/llm/rotation'));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      entries: unknown[];
      activeIndex: number;
      activeProvider: string;
      activeModel: string;
    };
    expect(body.entries).toEqual([]);
    expect(body.activeIndex).toBe(-1);
    expect(body.activeProvider).toBe('anthropic');
    expect(body.activeModel).toBe('claude-opus-4-6');
  });

  test('populated rotation surfaces entries + active matches', async () => {
    seedConfig({
      llm: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        rotation: [
          { provider: 'anthropic', model: 'claude-opus-4-6', label: 'opus' },
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'grok', model: 'grok-4-1-fast', apiKey: 'sk-test' },
        ],
      },
    });
    const { handleLlmRotationGet } = await freshHandlers();
    const res = handleLlmRotationGet(new Request('http://localhost/v1/llm/rotation'));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      entries: Array<{ index: number; provider: string; model: string; label: string; hasApiKey: boolean }>;
      activeIndex: number;
      activeProvider: string;
      activeModel: string;
    };
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0]).toMatchObject({ index: 0, provider: 'anthropic', label: 'opus', hasApiKey: false });
    expect(body.entries[1]).toMatchObject({ index: 1, provider: 'openai', model: 'gpt-4o' });
    expect(body.entries[2]).toMatchObject({ index: 2, provider: 'grok', hasApiKey: true });
    expect(body.activeIndex).toBe(0);
    expect(body.activeProvider).toBe('anthropic');
    expect(body.activeModel).toBe('claude-opus-4-6');
  });

  test('rejects non-GET / non-OPTIONS method', async () => {
    seedConfig({ llm: { provider: 'anthropic' } });
    const { handleLlmRotationGet } = await freshHandlers();
    const res = handleLlmRotationGet(new Request('http://localhost/v1/llm/rotation', { method: 'POST' }));
    expect(res.status).toBe(405);
  });
});

describe('POST /v1/llm/rotation/next', () => {
  test('advances activeIndex from 0 → 1 + persists to disk', async () => {
    seedConfig({
      llm: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        rotation: [
          { provider: 'anthropic', model: 'claude-opus-4-6', label: 'opus' },
          { provider: 'openai', model: 'gpt-4o', label: 'gpt4o' },
          { provider: 'grok', model: 'grok-4-1-fast', label: 'grok' },
        ],
      },
    });
    const { handleLlmRotationNext } = await freshHandlers();
    const res = handleLlmRotationNext(new Request('http://localhost/v1/llm/rotation/next', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { activeIndex: number; activeProvider: string; activeModel: string };
    expect(body.activeIndex).toBe(1);
    expect(body.activeProvider).toBe('openai');
    expect(body.activeModel).toBe('gpt-4o');

    // On-disk file must reflect the new active top-level llm.{provider,model}.
    const persisted = JSON.parse(readFileSync(configPath(), 'utf8')) as {
      llm: { provider: string; model: string; rotation: unknown[] };
    };
    expect(persisted.llm.provider).toBe('openai');
    expect(persisted.llm.model).toBe('gpt-4o');
    expect(persisted.llm.rotation).toHaveLength(3);
  });

  test('wraps from last entry back to index 0', async () => {
    seedConfig({
      llm: {
        provider: 'grok',
        model: 'grok-4-1-fast',
        rotation: [
          { provider: 'anthropic', model: 'claude-opus-4-6' },
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'grok', model: 'grok-4-1-fast' },
        ],
      },
    });
    const { handleLlmRotationNext } = await freshHandlers();
    const res = handleLlmRotationNext(new Request('http://localhost/v1/llm/rotation/next', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { activeIndex: number; activeProvider: string };
    expect(body.activeIndex).toBe(0);
    expect(body.activeProvider).toBe('anthropic');
  });

  test('empty rotation returns 409 no-rotation-configured', async () => {
    seedConfig({ llm: { provider: 'anthropic', model: 'claude-opus-4-6' } });
    const { handleLlmRotationNext } = await freshHandlers();
    const res = handleLlmRotationNext(new Request('http://localhost/v1/llm/rotation/next', { method: 'POST' }));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-rotation-configured');
  });

  test('rejects non-POST method', async () => {
    seedConfig({ llm: { provider: 'anthropic' } });
    const { handleLlmRotationNext } = await freshHandlers();
    const res = handleLlmRotationNext(new Request('http://localhost/v1/llm/rotation/next', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  test('preserves Path A unknown keys (passthrough regression guard)', async () => {
    // Sibling guard for feedback_nexus_user_config_passthrough — the
    // rotation save path uses root saveUserConfig which routes through
    // raw-rest preservation. Discord/Telegram/Obsidian survive.
    seedConfig({
      llm: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        rotation: [
          { provider: 'anthropic', model: 'claude-opus-4-6' },
          { provider: 'openai', model: 'gpt-4o' },
        ],
      },
      obsidian: { vault: '/some/vault' },
      discord: { enabled: true, botToken: 'tok' },
      telegram: { enabled: false },
    });
    const { handleLlmRotationNext } = await freshHandlers();
    const res = handleLlmRotationNext(new Request('http://localhost/v1/llm/rotation/next', { method: 'POST' }));
    expect(res.status).toBe(200);
    const persisted = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
    const obs = persisted.obsidian as { vault: string };
    expect(obs.vault).toBe('/some/vault');
    const dc = persisted.discord as { enabled: boolean };
    expect(dc.enabled).toBe(true);
  });
});
