// NEXUS · /v1/nexus/chat-backend-detection (PWA mirror track PR 1)
//
// Endpoint shape lock — PWA SettingsPanel (PR 2-3) consumes this JSON
// to render the chat-backend Quick Setup card without duplicating the
// detection / probe logic.
//
// 3 baseline scenarios:
//   - clean machine (no OAuth · no env)         → backend='none'
//   - codex OAuth present                        → backend='codex'
//   - GEMINI_API_KEY env (no OAuth · no openai)  → backend='gemini'
//
// Plus shape invariants: env / token values are NEVER echoed (g.1 jsdoc
// policy preserved end-to-end · only `detected: boolean` per path).

import { describe, test, expect } from 'bun:test';
import {
  buildChatBackendDetectionBody,
  handleChatBackendDetection,
} from '../src/nexus/api/chat-backend-detection.js';
import type { QuickSetupRenderOpts } from '../src/nexus/chat/quick-setup.js';

function callBody(opts: QuickSetupRenderOpts) {
  return buildChatBackendDetectionBody(opts);
}

describe('chat-backend-detection — body shape', () => {
  test('clean machine (no OAuth, no env) → none', () => {
    const body = callBody({
      envSource: {},
      tokenLookup: () => null,
    });
    expect(body.detection.backend).toBe('none');
    expect(body.detection.source).toBe('');
    expect(body.entries).toHaveLength(3);
    expect(body.entries.map((e) => e.provider)).toEqual([
      'codex',
      'claude-code',
      'gemini',
    ]);
    // every path detected=false on a clean machine
    for (const e of body.entries) {
      for (const p of e.paths) {
        expect(p.detected).toBe(false);
      }
    }
  });

  test('codex OAuth present → backend=codex (priority 1)', () => {
    const body = callBody({
      envSource: {},
      tokenLookup: (provider) => provider === 'openai-codex' ? { token: 'x' } : null,
    });
    expect(body.detection.backend).toBe('codex');
    expect(body.detection.source).toBe('openai-codex OAuth');
    const codex = body.entries.find((e) => e.provider === 'codex')!;
    const oauth = codex.paths.find((p) => p.tag === 'OAuth')!;
    expect(oauth.detected).toBe(true);
  });

  test('GEMINI_API_KEY env (no OAuth · no openai) → backend=gemini', () => {
    const body = callBody({
      envSource: { GEMINI_API_KEY: 'AI...' },
      tokenLookup: () => null,
    });
    expect(body.detection.backend).toBe('gemini');
    expect(body.detection.source).toBe('GEMINI_API_KEY env');
    const gemini = body.entries.find((e) => e.provider === 'gemini')!;
    const apiKey = gemini.paths.find((p) => p.tag === 'GEMINI_API_KEY')!;
    expect(apiKey.detected).toBe(true);
  });

  test('OPENAI_API_KEY env wins over ANTHROPIC + GEMINI (priority 2)', () => {
    const body = callBody({
      envSource: {
        OPENAI_API_KEY: 'sk-...',
        ANTHROPIC_API_KEY: 'sk-ant-...',
        GEMINI_API_KEY: 'AI...',
      },
      tokenLookup: () => null,
    });
    expect(body.detection.backend).toBe('codex');
    expect(body.detection.source).toBe('OPENAI_API_KEY env');
    // All three should still be marked detected (the card renders ✓
    // for every credential path, not only the wired one).
    const codex = body.entries.find((e) => e.provider === 'codex')!;
    expect(codex.paths.find((p) => p.tag === 'OPENAI_API_KEY')!.detected).toBe(true);
    const claude = body.entries.find((e) => e.provider === 'claude-code')!;
    expect(claude.paths.find((p) => p.tag === 'ANTHROPIC_API_KEY')!.detected).toBe(true);
    const gemini = body.entries.find((e) => e.provider === 'gemini')!;
    expect(gemini.paths.find((p) => p.tag === 'GEMINI_API_KEY')!.detected).toBe(true);
  });

  test('shape invariant — paths carry only {tag, hint, detected} (no env values)', () => {
    const body = callBody({
      envSource: { OPENAI_API_KEY: 'sk-secret-leak-guard' },
      tokenLookup: () => null,
    });
    const json = JSON.stringify(body);
    // The token value MUST NOT appear in the response (g.1 policy).
    expect(json).not.toContain('sk-secret-leak-guard');
    for (const e of body.entries) {
      for (const p of e.paths) {
        expect(typeof p.tag).toBe('string');
        expect(typeof p.hint).toBe('string');
        expect(typeof p.detected).toBe('boolean');
        // No leaked value field.
        expect(Object.keys(p).sort()).toEqual(['detected', 'hint', 'tag']);
      }
    }
  });
});

describe('chat-backend-detection — handler', () => {
  test('returns 200 + JSON content-type + parseable body', async () => {
    const res = handleChatBackendDetection({
      envSource: {},
      tokenLookup: () => null,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json() as { detection: { backend: string }; entries: unknown[] };
    expect(json.detection.backend).toBe('none');
    expect(Array.isArray(json.entries)).toBe(true);
    expect(json.entries).toHaveLength(3);
  });

  test('no DI deps → still produces a body (production default path)', async () => {
    // We can't pin process.env / loadTokens deterministically here without
    // mutating the host, so we just assert the shape is well-formed.
    const res = handleChatBackendDetection();
    expect(res.status).toBe(200);
    const json = await res.json() as { detection: { backend: string }; entries: unknown[] };
    expect(['none', 'codex', 'claude-code', 'gemini']).toContain(json.detection.backend);
    expect(json.entries).toHaveLength(3);
  });
});
