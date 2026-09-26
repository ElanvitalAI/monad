// PR-Δ20 (Sprint 15 · 2026-04-29 · F9) — async API validate retry tests.
//
// Δ14 introduced silent retry for shape-only token validation. Δ20
// extends the same retry budget to the async API probe (`/getMe` for
// Telegram, `/users/@me` for Discord) — a typo'd token that passes
// shape but fails the live API call now retries silently up to 3
// times instead of saving the broken token after a single shot.
//
// Tests drive Steps 1-5 with the standard PREFIX (`['7','1','','n']`
// for steps 1-3 + telegram/discord enable on the relevant step) and
// inspect the IO output + saved config to verify:
//
//   1. silent retry success — first attempt API-fails, second succeeds,
//      no error visible to user beyond a `!` line, success line printed
//   2. max-attempts exhausted — all 3 fail, last token saved, no
//      success line, "continuing — re-run" message printed
//   3. shape vs API error — invalid shape doesn't reach fetch, valid
//      shape does (assertion: fetch call count === 1 after one shape
//      reject + one valid token)
//   4. validate=false short-circuit — no fetch call, no error/success
//      line (existing CI contract preserved)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnboarding, scriptedIO } from '../src/onboarding';
import { resetUserConfig } from '../src/user-config';

let root: string;
let cfgPath: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'onboarding-async-'));
  cfgPath = join(root, 'config.json');
  resetUserConfig();
  savedEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
  savedEnv.CODEX_HOME = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = root;
  process.env.CODEX_HOME = join(root, 'codex-home');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetUserConfig();
  if (savedEnv.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedEnv.XDG_CONFIG_HOME;
  if (savedEnv.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = savedEnv.CODEX_HOME;
});

// Steps 1 (LLM=auto) · 2 (skill preset 1) · 3 (obsidian default) — keeps
// the focus on the Telegram/Discord steps that follow. PREFIX_BEFORE_TG
// stops after Step 3; tests append per-step inputs from there.
const PREFIX_BEFORE_TG = ['10', '1', ''] as const;

// Fake Telegram /getMe response shapes used by mock fetchImpl below.
function tgFailResp(description: string): { json: () => Promise<unknown> } {
  return { json: async () => ({ ok: false, description, error_code: 401 }) };
}
function tgOkResp(username: string, id = 42): { json: () => Promise<unknown> } {
  return { json: async () => ({ ok: true, result: { id, username, first_name: username } }) };
}
function discordFailResp(): { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> } {
  return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ message: 'invalid token' }) };
}
function discordOkResp(username: string, id = '7777'): { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> } {
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ id, username, discriminator: '0' }) };
}

const VALID_TG_TOKEN_A = '111:Abcdefghijklmnopqrstuvwx';   // shape OK · 24 chars after :
const VALID_TG_TOKEN_B = '222:Bbcdefghijklmnopqrstuvwx';
const VALID_TG_TOKEN_C = '333:Cbcdefghijklmnopqrstuvwx';
const SHAPE_BAD_TG = 'short';                                // fails regex

const VALID_DISCORD_TOKEN_A = 'a'.repeat(50);                // shape OK · long + no whitespace
const VALID_DISCORD_TOKEN_B = 'b'.repeat(50);
const VALID_DISCORD_TOKEN_C = 'c'.repeat(50);
const SHAPE_BAD_DISCORD = 'with space here ' + 'x'.repeat(40);

describe('onboarding wizard · Δ20 async API validate retry · Telegram', () => {
  test('silent retry success — 1st token API-fails, 2nd passes', async () => {
    let callCount = 0;
    const fetchImpl = (async (url: string) => {
      callCount++;
      if (url.includes(VALID_TG_TOKEN_A)) return tgFailResp('Unauthorized') as any;
      if (url.includes(VALID_TG_TOKEN_B)) return tgOkResp('mybot') as any;
      throw new Error(`unexpected token in url: ${url}`);
    }) as unknown as typeof fetch;
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'y',                       // telegram: enable
      VALID_TG_TOKEN_A,          // bot token attempt 1 — API fails
      VALID_TG_TOKEN_B,          // bot token attempt 2 — API passes
      '',                        // allowed users blank
      '',                        // home channel blank
      'n',                       // discord: skip
      '1',                  // M1-5 voice-ai: Smart defaults
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      telegramDeps: { fetchImpl },
    });
    expect(cfg.telegram.enabled).toBe(true);
    expect(cfg.telegram.botToken).toBe(VALID_TG_TOKEN_B);
    expect(callCount).toBe(2);
    const out = io.outputs.join('\n');
    expect(out).toMatch(/Connected as @mybot/);
    expect(out).toMatch(/getMe failed/);             // attempt 1 error line
    expect(out).not.toMatch(/continuing — re-run/);  // success path · no fallback message
  });

  test('max-attempts exhausted — all 3 API-fail, last saved, no success line', async () => {
    let callCount = 0;
    const fetchImpl = (async () => { callCount++; return tgFailResp('Unauthorized') as any; }) as unknown as typeof fetch;
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'y',
      VALID_TG_TOKEN_A,
      VALID_TG_TOKEN_B,
      VALID_TG_TOKEN_C,
      '',
      '',
      'n',
      '1',
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      telegramDeps: { fetchImpl },
    });
    expect(cfg.telegram.enabled).toBe(true);
    expect(cfg.telegram.botToken).toBe(VALID_TG_TOKEN_C);   // last attempt saved
    expect(callCount).toBe(3);                              // each attempt hit fetch
    const out = io.outputs.join('\n');
    expect(out).not.toMatch(/Connected as @/);              // no success line
    expect(out).toMatch(/continuing — re-run `elanous setup telegram`/);
    expect(out).toMatch(/max attempts reached/);
  });

  test('shape error skips fetch — only valid-shape inputs reach API', async () => {
    let callCount = 0;
    const fetchImpl = (async () => { callCount++; return tgOkResp('mybot') as any; }) as unknown as typeof fetch;
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'y',
      SHAPE_BAD_TG,              // shape error · no fetch call
      VALID_TG_TOKEN_A,          // shape OK · fetch called once · API success
      '',
      '',
      'n',
      '1',
    ]);
    await runOnboarding({ io, path: cfgPath, telegramDeps: { fetchImpl } });
    expect(callCount).toBe(1);                              // shape-bad never reached API
    const out = io.outputs.join('\n');
    expect(out).toMatch(/@BotFather/);                      // shape error message
    expect(out).toMatch(/Connected as @mybot/);
  });

  test('validate=false skips API probe entirely', async () => {
    let callCount = 0;
    const fetchImpl = (async () => { callCount++; return tgFailResp('should-not-be-called') as any; }) as unknown as typeof fetch;
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'y',
      'any-token-no-shape-check',
      '',
      '',
      'n',
      '1',
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      telegramDeps: { fetchImpl, validateToken: false },
    });
    expect(cfg.telegram.enabled).toBe(true);
    expect(cfg.telegram.botToken).toBe('any-token-no-shape-check');
    expect(callCount).toBe(0);                              // probe skipped
    const out = io.outputs.join('\n');
    expect(out).not.toMatch(/Connected as/);
    expect(out).not.toMatch(/continuing — re-run/);
  });
});

describe('onboarding wizard · Δ20 async API validate retry · Discord', () => {
  test('silent retry success — 1st token API-fails, 2nd passes', async () => {
    let callCount = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      callCount++;
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      if (auth.includes(VALID_DISCORD_TOKEN_A)) return discordFailResp() as any;
      if (auth.includes(VALID_DISCORD_TOKEN_B)) return discordOkResp('discordbot') as any;
      throw new Error(`unexpected auth header: ${auth}`);
    }) as unknown as typeof fetch;
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'n',                       // telegram: skip
      'y',                       // discord: enable
      VALID_DISCORD_TOKEN_A,     // attempt 1 — API fails
      VALID_DISCORD_TOKEN_B,     // attempt 2 — API passes
      '',                        // allowed users blank
      '',                        // home channel blank
      '1',                  // M1-5 voice-ai: Smart defaults
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      discordDeps: { fetchImpl },
    });
    expect(cfg.discord.enabled).toBe(true);
    expect(cfg.discord.botToken).toBe(VALID_DISCORD_TOKEN_B);
    expect(callCount).toBe(2);
    const out = io.outputs.join('\n');
    expect(out).toMatch(/Connected as discordbot \(id 7777\)/);
    expect(out).toMatch(/users\/@me failed/);
    expect(out).not.toMatch(/continuing — re-run/);
  });

  test('max-attempts exhausted — last token saved, no success line', async () => {
    let callCount = 0;
    const fetchImpl = (async () => { callCount++; return discordFailResp() as any; }) as unknown as typeof fetch;
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'n',
      'y',
      VALID_DISCORD_TOKEN_A,
      VALID_DISCORD_TOKEN_B,
      VALID_DISCORD_TOKEN_C,
      '',
      '',
      '1',
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      discordDeps: { fetchImpl },
    });
    expect(cfg.discord.enabled).toBe(true);
    expect(cfg.discord.botToken).toBe(VALID_DISCORD_TOKEN_C);
    expect(callCount).toBe(3);
    const out = io.outputs.join('\n');
    expect(out).not.toMatch(/Connected as/);
    expect(out).toMatch(/continuing — re-run `elanous setup discord`/);
  });

  test('shape error skips fetch', async () => {
    let callCount = 0;
    const fetchImpl = (async () => { callCount++; return discordOkResp('dbot') as any; }) as unknown as typeof fetch;
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'n',
      'y',
      SHAPE_BAD_DISCORD,
      VALID_DISCORD_TOKEN_A,
      '',
      '',
      '1',
    ]);
    await runOnboarding({ io, path: cfgPath, discordDeps: { fetchImpl } });
    expect(callCount).toBe(1);
    const out = io.outputs.join('\n');
    expect(out).toMatch(/right/);     // shape error includes "right"
    expect(out).toMatch(/Connected as dbot/);
  });
});
