// M3-3 (Phase 3) — `POST /v1/chat/tier-intent` endpoint tests.
//
// Drives the handler directly with an injected runner (`_runner` body
// field is the test seam), sandboxed XDG_CONFIG_HOME, and a clean
// session override store per test.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleChatTierIntentPost } from '../../src/nexus/api/chat-tier-intent.js';
import {
  __resetXdgDeprecationWarningForTests,
  reloadUserConfig,
} from '../../src/user-config.js';
import {
  _resetSessionTierOverridesForTesting,
  getSessionTierOverride,
  type LlmRunner,
} from '../../src/model-tier/index.js';

let tmpDir: string;
const PREV_XDG = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'm3-3-'));
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.MONAD_SUPPRESS_XDG_WARNING = '1';
  __resetXdgDeprecationWarningForTests();
  reloadUserConfig();
  _resetSessionTierOverridesForTesting();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = PREV_XDG;
  reloadUserConfig();
});

function postRequest(body: unknown): Request {
  return new Request('http://localhost/v1/chat/tier-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fakePostRequestWithRunner(text: string, opts: {
  sessionId?: string;
  apply?: boolean;
  runner: LlmRunner;
}): Request {
  // We need to thread the runner through the JSON body — the handler
  // accepts `_runner` as a test seam. JSON can't carry functions, so
  // we cheat by reconstructing the Request with the function attached
  // out-of-band via a custom property accessor.
  const baseBody = {
    text,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    ...(opts.apply ? { apply: true } : {}),
  };
  const req = new Request('http://localhost/v1/chat/tier-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(baseBody),
  });
  // Re-implement req.json() so the handler reads back the runner too.
  const origJson = req.json.bind(req);
  (req as unknown as { json: () => Promise<unknown> }).json = async () => {
    const parsed = (await origJson()) as Record<string, unknown>;
    return { ...parsed, _runner: opts.runner };
  };
  return req;
}

async function asJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('M3-3 · POST /v1/chat/tier-intent · validation', () => {
  test('400 invalid-json', async () => {
    const req = new Request('http://localhost/v1/chat/tier-intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await handleChatTierIntentPost(req);
    expect(res.status).toBe(400);
    const body = await asJson(res);
    expect(body.error).toBe('invalid-json');
  });

  test('400 missing-text', async () => {
    const res = await handleChatTierIntentPost(postRequest({}));
    expect(res.status).toBe(400);
    expect((await asJson(res)).error).toBe('missing-text');
  });

  test('400 apply-requires-session-id', async () => {
    const res = await handleChatTierIntentPost(postRequest({ text: 'hi', apply: true }));
    expect(res.status).toBe(400);
    expect((await asJson(res)).error).toBe('apply-requires-session-id');
  });

  test('400 missing-runner-model when not using _runner seam', async () => {
    const res = await handleChatTierIntentPost(postRequest({ text: 'hi' }));
    expect(res.status).toBe(400);
    expect((await asJson(res)).error).toBe('missing-runner-model');
  });
});

describe('M3-3 · POST /v1/chat/tier-intent · detect-only', () => {
  test('apply-preset detection passes through · applied=false', async () => {
    const runner: LlmRunner = async () =>
      '{"intent":"apply-preset","preset":"medical_dictation","tierDelta":null,"rationale":"med"}';
    const res = await handleChatTierIntentPost(
      fakePostRequestWithRunner('이번 회의는 의료 용어 많아', { runner }),
    );
    expect(res.status).toBe(200);
    const body = await asJson(res) as {
      detection: { intent: string; preset?: string };
      plan: { apply: Record<string, string>; isNoop: boolean; monthlyUsdCap?: number };
      applied: boolean;
    };
    expect(body.detection.intent).toBe('apply-preset');
    expect(body.detection.preset).toBe('medical_dictation');
    expect(body.plan.isNoop).toBe(false);
    expect(body.plan.apply.stt).toBe('loaded');
    expect(body.plan.apply.llm).toBe('best');
    expect(body.plan.apply.tts).toBe('best');
    expect(body.plan.monthlyUsdCap).toBe(20);
    expect(body.applied).toBe(false);
  });

  test('runner failure → fallback intent=none · applied=false', async () => {
    const runner: LlmRunner = async () => { throw new Error('boom'); };
    const res = await handleChatTierIntentPost(
      fakePostRequestWithRunner('정확도 높여줘', { runner }),
    );
    const body = await asJson(res) as { detection: { intent: string; source: string }; applied: boolean };
    expect(body.detection.intent).toBe('none');
    expect(body.detection.source).toBe('fallback');
    expect(body.applied).toBe(false);
  });
});

describe('M3-3 · POST /v1/chat/tier-intent · apply path', () => {
  test('apply=true with valid intent installs session override', async () => {
    const runner: LlmRunner = async () =>
      '{"intent":"apply-preset","preset":"medical_dictation","tierDelta":null,"rationale":"med"}';
    const res = await handleChatTierIntentPost(
      fakePostRequestWithRunner('의료 용어 많아', {
        sessionId: 'sess-X',
        apply: true,
        runner,
      }),
    );
    const body = await asJson(res) as { applied: boolean; sessionId: string; overrideExpiresAt?: number };
    expect(body.applied).toBe(true);
    expect(body.sessionId).toBe('sess-X');
    expect(typeof body.overrideExpiresAt).toBe('number');

    const ov = getSessionTierOverride('sess-X');
    expect(ov?.stt).toBe('loaded');
    expect(ov?.llm).toBe('best');
    expect(ov?.tts).toBe('best');
    expect(ov?.monthlyUsdCap).toBe(20);
    expect(ov?.rationale).toBe('med');
  });

  test('apply=true with intent=none does not install override', async () => {
    const runner: LlmRunner = async () =>
      '{"intent":"none","preset":null,"tierDelta":null,"rationale":""}';
    const res = await handleChatTierIntentPost(
      fakePostRequestWithRunner('오늘 점심 뭐 먹지', {
        sessionId: 'sess-Y',
        apply: true,
        runner,
      }),
    );
    const body = await asJson(res) as { applied: boolean };
    expect(body.applied).toBe(false);
    expect(getSessionTierOverride('sess-Y')).toBeUndefined();
  });

  test('apply=true with increase-quality bumps every surface one tick', async () => {
    const runner: LlmRunner = async () =>
      '{"intent":"increase-quality","preset":null,"tierDelta":1,"rationale":"acc"}';
    const res = await handleChatTierIntentPost(
      fakePostRequestWithRunner('정확도 더 높여줘', {
        sessionId: 'sess-Z',
        apply: true,
        runner,
      }),
    );
    const body = await asJson(res) as { applied: boolean };
    expect(body.applied).toBe(true);
    const ov = getSessionTierOverride('sess-Z');
    // balanced + 1 → better across stt/llm/tts.
    expect(ov?.stt).toBe('better');
    expect(ov?.llm).toBe('better');
    expect(ov?.tts).toBe('better');
  });
});
