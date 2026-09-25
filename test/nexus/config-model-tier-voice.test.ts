// M2-2b (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// /v1/config/model-tier validator handles the new ttsVoice sub-tree.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  handleModelTierGet,
  handleModelTierPut,
} from '../../src/nexus/api/config-model-tier.js';
import { __resetXdgDeprecationWarningForTests, reloadUserConfig, userConfigPath } from '../../src/user-config.js';

let tmpDir: string;
const PREV_XDG = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'm2-2b-'));
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.MONAD_SUPPRESS_XDG_WARNING = '1';
  __resetXdgDeprecationWarningForTests();
  reloadUserConfig();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = PREV_XDG;
  reloadUserConfig();
});

function putRequest(body: unknown): Request {
  return new Request('http://localhost/v1/config/model-tier', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function asJson(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

describe('M2-2b · PUT /v1/config/model-tier · voice.ttsVoice', () => {
  test('writes default voice id · GET round-trips', async () => {
    const res = await handleModelTierPut(putRequest({
      modelTier: { voice: { ttsVoice: { default: '21m00Tcm4TlvDq8ikWAM' } } },
    }));
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.modelTier).toEqual({
      voice: { ttsVoice: { default: '21m00Tcm4TlvDq8ikWAM' } },
    });

    // On-disk shape.
    const raw = JSON.parse(readFileSync(userConfigPath(), 'utf-8')) as Record<string, unknown>;
    expect((raw.modelTier as Record<string, unknown>).voice).toEqual({
      ttsVoice: { default: '21m00Tcm4TlvDq8ikWAM' },
    });

    const getBody = await asJson(handleModelTierGet());
    expect(getBody.modelTier).toEqual({
      voice: { ttsVoice: { default: '21m00Tcm4TlvDq8ikWAM' } },
    });
  });

  test('multiple contexts at once', async () => {
    const res = await handleModelTierPut(putRequest({
      modelTier: {
        voice: {
          ttsVoice: {
            default: 'rachel-id',
            chat: 'adam-id',
            digest: 'yumi-id',
            alert: 'urgent-male-id',
            discord: 'bella-id',
          },
        },
      },
    }));
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect((body.modelTier as { voice: { ttsVoice: Record<string, string> } }).voice.ttsVoice).toEqual({
      default: 'rachel-id',
      chat: 'adam-id',
      digest: 'yumi-id',
      alert: 'urgent-male-id',
      discord: 'bella-id',
    });
  });

  test('rejects unknown context key', async () => {
    const res = await handleModelTierPut(putRequest({
      modelTier: { voice: { ttsVoice: { telephony: 'voice-id' } } },
    }));
    expect(res.status).toBe(400);
  });

  test('rejects empty string voice id', async () => {
    const res = await handleModelTierPut(putRequest({
      modelTier: { voice: { ttsVoice: { default: '   ' } } },
    }));
    expect(res.status).toBe(400);
  });

  test('rejects non-string voice id', async () => {
    const res = await handleModelTierPut(putRequest({
      modelTier: { voice: { ttsVoice: { default: 42 } } },
    }));
    expect(res.status).toBe(400);
  });

  test('coexists with stt + tts tier on same voice sub-tree', async () => {
    const res = await handleModelTierPut(putRequest({
      modelTier: {
        voice: {
          stt: 'best',
          tts: 'best',
          ttsVoice: { default: 'rachel-id' },
        },
      },
    }));
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect((body.modelTier as { voice: Record<string, unknown> }).voice).toEqual({
      stt: 'best',
      tts: 'best',
      ttsVoice: { default: 'rachel-id' },
    });
  });

  test('trims whitespace on accepted ids', async () => {
    const res = await handleModelTierPut(putRequest({
      modelTier: { voice: { ttsVoice: { default: '  rachel-id  ' } } },
    }));
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect((body.modelTier as { voice: { ttsVoice: { default: string } } }).voice.ttsVoice.default).toBe('rachel-id');
  });
});
