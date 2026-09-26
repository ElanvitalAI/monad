// ── saveTokens auto-extracts ChatGPT claims for openai-codex ──
//
// L1 contract: every refresh rotation for 'openai-codex' captures a
// fresh ChatGPT claim snapshot from the JWT access token without
// callers having to thread it through. Non-Codex providers ignore
// the field. API-key tokens (no JWT) leave existing claims intact.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadTokens, saveTokens, type OAuthTokens,
} from '../src/oauth/store';
import { JWT_CLAIM_PATH } from '../src/oauth/jwt';

function makeJWT(payload: unknown): string {
  const b64url = (s: string) =>
    Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

function tokensWithClaims(claims: Record<string, unknown>): OAuthTokens {
  const access = makeJWT({ [JWT_CLAIM_PATH]: claims });
  return {
    accessToken: access,
    refreshToken: 'ref-1',
    expiresAt: Date.now() + 3600_000,
    tokenType: 'Bearer',
  };
}

let root: string;
let cfgPath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oauth-claims-'));
  cfgPath = join(root, 'elanous', 'auth.json');
  process.env.XDG_CONFIG_HOME = root;
  process.env.CODEX_HOME = join(root, 'codex-home');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CODEX_HOME;
});

describe('saveTokens auto-extracts ChatGPT claims', () => {
  test('openai-codex with JWT access token populates chatGPT', () => {
    const tokens = tokensWithClaims({
      chatgpt_account_id: 'acct-1',
      chatgpt_plan_type: 'pro',
      chatgpt_user_id: 'user-1',
    });
    saveTokens('openai-codex', tokens, { mirrorCodex: false }, cfgPath);
    const state = loadTokens('openai-codex', cfgPath);
    expect(state!.chatGPT).toEqual({
      accountId: 'acct-1',
      planType: 'pro',
      userId: 'user-1',
    });
  });

  test('opaque (non-JWT) openai-codex token leaves chatGPT undefined on first save', () => {
    const opaque: OAuthTokens = {
      accessToken: 'sk-opaque-apikey-like',
      refreshToken: 'ref-1',
      expiresAt: null,
    };
    saveTokens('openai-codex', opaque, { mirrorCodex: false }, cfgPath);
    const state = loadTokens('openai-codex', cfgPath);
    expect(state!.chatGPT).toBeUndefined();
  });

  test('second save with JWT-less token keeps prior claims (no clobbering)', () => {
    const good = tokensWithClaims({ chatgpt_account_id: 'acct-keep' });
    saveTokens('openai-codex', good, { mirrorCodex: false }, cfgPath);
    expect(loadTokens('openai-codex', cfgPath)!.chatGPT?.accountId).toBe('acct-keep');
    // Simulate an API-key path saving tokens without a JWT — must
    // not wipe the existing chatGPT claims.
    saveTokens('openai-codex', {
      accessToken: 'plain-string',
      refreshToken: 'r',
      expiresAt: null,
    }, { mirrorCodex: false }, cfgPath);
    expect(loadTokens('openai-codex', cfgPath)!.chatGPT?.accountId).toBe('acct-keep');
  });

  test('explicit null chatGPT clears prior claims', () => {
    const good = tokensWithClaims({ chatgpt_account_id: 'acct-gone' });
    saveTokens('openai-codex', good, { mirrorCodex: false }, cfgPath);
    saveTokens('openai-codex', good, { mirrorCodex: false, chatGPT: null }, cfgPath);
    expect(loadTokens('openai-codex', cfgPath)!.chatGPT).toBeUndefined();
  });

  test('explicit chatGPT override wins over JWT decode', () => {
    const tokens = tokensWithClaims({ chatgpt_account_id: 'from-jwt' });
    saveTokens('openai-codex', tokens, {
      mirrorCodex: false,
      chatGPT: { accountId: 'forced-override', planType: 'team' },
    }, cfgPath);
    const state = loadTokens('openai-codex', cfgPath);
    expect(state!.chatGPT).toEqual({ accountId: 'forced-override', planType: 'team' });
  });

  test('non-Codex provider (anthropic) never populates chatGPT even with a JWT', () => {
    const tokens = tokensWithClaims({ chatgpt_account_id: 'stray' });
    saveTokens('anthropic', tokens, {}, cfgPath);
    const state = loadTokens('anthropic', cfgPath);
    expect(state!.chatGPT).toBeUndefined();
  });

  test('refresh rotation: new JWT with different accountId replaces prior', () => {
    saveTokens('openai-codex', tokensWithClaims({ chatgpt_account_id: 'old' }),
      { mirrorCodex: false }, cfgPath);
    saveTokens('openai-codex', tokensWithClaims({ chatgpt_account_id: 'new' }),
      { mirrorCodex: false }, cfgPath);
    expect(loadTokens('openai-codex', cfgPath)!.chatGPT?.accountId).toBe('new');
  });
});
