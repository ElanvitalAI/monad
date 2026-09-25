// PR-Δ22 (Sprint 16 · 2026-04-30 · F2-sub) — sub-prompt Back tests.
//
// Δ16 introduced step-level Back (← rewinds to the prior step). Δ22
// extends Back to sub-prompts WITHIN a step: typing `back` / `b` /
// `←` at any sub-prompt of an opt-in step throws SubPromptBackError;
// the step's mini-state-machine catches it and rewinds subIdx by one.
// If subIdx is already 0 (back at the first sub-prompt), the
// orchestrator re-throws WizardBackError so the runOnboarding step
// loop rewinds to the prior step — preserving the Δ16 contract for
// the step-boundary case.
//
// Tests drive the Telegram step (the canonical sub-prompt example —
// 3 sub-prompts: token / users / home) via runOnboarding with
// telegramDeps.validateToken=false so we don't hit the live /getMe
// endpoint and any token shape passes.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnboarding, scriptedIO } from '../src/onboarding';
import { resetUserConfig } from '../src/user-config';
import {
  SubPromptBackError,
  isSubBackRequest,
  askValidated,
} from '../src/onboarding/validators';

let root: string;
let cfgPath: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'onboarding-subback-'));
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

describe('Δ22 · sub-prompt Back · validators primitives', () => {
  test('isSubBackRequest recognizes back / b / ← (case-insensitive)', () => {
    expect(isSubBackRequest('back')).toBe(true);
    expect(isSubBackRequest('Back')).toBe(true);
    expect(isSubBackRequest('BACK')).toBe(true);
    expect(isSubBackRequest('b')).toBe(true);
    expect(isSubBackRequest('B')).toBe(true);
    expect(isSubBackRequest('←')).toBe(true);
    // Non-back inputs.
    expect(isSubBackRequest('x')).toBe(false);
    expect(isSubBackRequest('back-with-suffix')).toBe(false);
    expect(isSubBackRequest('')).toBe(false);
  });

  test('askValidated throws SubPromptBackError when allowSubBack is on', async () => {
    const io = scriptedIO(['back']);
    await expect(
      askValidated(io, 'X: ', () => null, { allowSubBack: true }),
    ).rejects.toBeInstanceOf(SubPromptBackError);
  });

  test('askValidated treats `back` as input when allowSubBack is off (default)', async () => {
    const io = scriptedIO(['back']);
    const result = await askValidated(io, 'X: ', () => null);
    expect(result).toBe('back');
  });
});

// ── PR-Δ22b (Sprint 18 · 2026-04-30) — Discord step sub-back ──
//
// Δ22 shipped sub-back for Telegram only. Δ22b extends the same
// pattern to askDiscord (3 sub-prompts: token / users / home).
// askControlPlane intentionally out of scope (the chooseFrom-based
// askYesNo doesn't accept literal `back` input — separate follow-up).

describe('Δ22b · sub-prompt Back · Discord step end-to-end', () => {
  // Steps 1-4 prefix: LLM=auto · skill=1 · obsidian default · telegram skip
  const PREFIX_BEFORE_DC = ['10', '1', '', 'n'] as const;

  test('back at sub 1 (users) rewinds to sub 0 (token) — token re-prompted', async () => {
    const io = scriptedIO([
      ...PREFIX_BEFORE_DC,
      'y',                  // discord: enable
      'DC_TOK_1',           // sub 0 token (validate=false → any input passes)
      'back',               // sub 1 users → SubPromptBackError → rewind to sub 0
      'DC_TOK_2',           // sub 0 retry — replaces DC_TOK_1
      '',                   // sub 1 users (blank · empty allowlist)
      '',                   // sub 2 home blank
      '1',                  // M1-5 voice-ai: Smart defaults
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      discordDeps: { validateToken: false },
    });
    expect(cfg.discord.enabled).toBe(true);
    expect(cfg.discord.botToken).toBe('DC_TOK_2');
    expect(cfg.discord.allowedUsers).toEqual([]);
  });

  test('back at sub 2 (home) rewinds to sub 1 (users) — users re-prompted', async () => {
    const io = scriptedIO([
      ...PREFIX_BEFORE_DC,
      'y',
      'DC_TOK',
      '111111111111111111',                       // sub 1 users (single 18-digit snowflake)
      'back',                                     // sub 2 home → rewind to sub 1
      '222222222222222222,333333333333333333',   // sub 1 retry — replaces
      '',                                          // sub 2 home blank
      '1',
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      discordDeps: { validateToken: false },
    });
    expect(cfg.discord.botToken).toBe('DC_TOK');
    expect(cfg.discord.allowedUsers).toEqual([
      '222222222222222222',
      '333333333333333333',
    ]);
  });

  test('back at sub 0 (token) escapes the step — runOnboarding rewinds to Step 4 (Telegram)', async () => {
    // sub 0 back → SubPromptBackError caught → subIdx===0 → re-throw
    // WizardBackError → runOnboarding rewinds to step 4 (Telegram).
    // Telegram re-prompts (we answer n to skip again); then Step 5
    // discord runs again. We capture the telegram re-visit by setting
    // a fresh non-default state on the second visit.
    const io = scriptedIO([
      ...PREFIX_BEFORE_DC,
      'y',                            // step 5 (discord) enable
      'back',                         // sub 0 token → step-escape to Step 4
      'y',                            // Step 4 telegram re-visit · enable now
      'TELEGRAM_TOK',                 // tg sub 0 token
      '',                              // tg sub 1 users blank
      '',                              // tg sub 2 home blank
      'y',                            // Step 5 discord re-visit · enable
      'NEW_DC_TOKEN',                 // sub 0 token
      '',                              // sub 1 users blank
      '',                              // sub 2 home blank
      '1',
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      telegramDeps: { validateToken: false },
      discordDeps: { validateToken: false },
    });
    expect(cfg.discord.botToken).toBe('NEW_DC_TOKEN');
    expect(cfg.telegram.enabled).toBe(true);
    expect(cfg.telegram.botToken).toBe('TELEGRAM_TOK');
  });
});

describe('Δ22 · sub-prompt Back · Telegram step end-to-end', () => {
  // Steps 1-3 prefix (LLM=auto · skill=1 · obsidian default).
  const PREFIX_BEFORE_TG = ['10', '1', ''] as const;

  test('back at sub 1 (users) rewinds to sub 0 (token) — token re-prompted', async () => {
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'y',                  // telegram: enable
      'TOK1abc',            // sub 0 token (validate=false → any input passes)
      'back',               // sub 1 users → SubPromptBackError → rewind to sub 0
      'TOK2def',            // sub 0 retry — replaces TOK1
      '',                   // sub 1 users (blank · public)
      '',                   // sub 2 home (blank)
      'n',                  // discord skip
      '1',                  // M1-5 voice-ai: Smart defaults
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      telegramDeps: { validateToken: false },
    });
    expect(cfg.telegram.enabled).toBe(true);
    expect(cfg.telegram.botToken).toBe('TOK2def');   // re-prompted token wins
    expect(cfg.telegram.allowedUsers).toEqual([]);
  });

  test('back at sub 2 (home) rewinds to sub 1 (users) — users re-prompted', async () => {
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,
      'y',
      'TOK_X',
      '111,222',            // sub 1 users
      'back',               // sub 2 home → rewind to sub 1
      '999',                // sub 1 retry — replaces 111,222
      '',                   // sub 2 home blank
      'n',
      '1',
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      telegramDeps: { validateToken: false },
    });
    expect(cfg.telegram.botToken).toBe('TOK_X');
    expect(cfg.telegram.allowedUsers).toEqual([999]);   // last entry wins
  });

  test('back at sub 0 (token) escapes the step — runOnboarding rewinds to Step 3', async () => {
    // sub 0 back → SubPromptBackError caught → subIdx===0 → re-throw
    // WizardBackError → runOnboarding rewinds to step 3 (Obsidian).
    // Obsidian re-prompts; user supplies a fresh path; then Step 4
    // telegram runs again. We capture the obsidian re-visit by
    // setting a non-default path on the second visit.
    const io = scriptedIO([
      ...PREFIX_BEFORE_TG,           // step 1-3
      'y',                            // step 4 enable
      'back',                         // sub 0 token → step-escape to Step 3
      '/tmp',                         // Step 3 obsidian re-visit · fresh path
      'y',                            // Step 4 enable again
      'NEW_TOKEN_X',                  // sub 0 token
      '',                             // sub 1 users blank
      '',                             // sub 2 home blank
      'n',
      '1',
    ]);
    const cfg = await runOnboarding({
      io, path: cfgPath,
      telegramDeps: { validateToken: false },
    });
    expect(cfg.telegram.botToken).toBe('NEW_TOKEN_X');
    expect(cfg.obsidian.vault).toBe('/tmp');
  });
});
