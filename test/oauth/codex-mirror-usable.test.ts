import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../../src/debug/log';
import { saveTokens } from '../../src/oauth/store';
import { codexLoginSuccessMessage } from '../../src/index';

let root: string;
let priorCodexHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-mirror-usable-'));
  priorCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(root, 'codex-home');
});

afterEach(() => {
  if (priorCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = priorCodexHome;
  rmSync(root, { recursive: true, force: true });
});

const mirrorPath = () => join(process.env.CODEX_HOME!, 'auth.json');
const storePath = () => join(root, 'elanous-auth.json');
const idToken = (accountId: string) => {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${segment({ alg: 'none' })}.${segment({ chatgpt_account_id: accountId })}.signature`;
};
const tokens = (accessToken: string, idTokenValue?: string) => ({
  accessToken,
  refreshToken: `${accessToken}-refresh`,
  ...(idTokenValue ? { idToken: idTokenValue } : {}),
  expiresAt: null,
});

function captureMirrorLogs(run: () => void): Array<{ event: string; data: unknown }> {
  const seen: Array<{ event: string; data: unknown }> = [];
  const original = debug.log;
  (debug as { log: unknown }).log = ((category: string, event: string, data?: unknown) => {
    if (category === 'oauth.codex-mirror') seen.push({ event, data });
  }) as typeof debug.log;
  try { run(); } finally { (debug as { log: unknown }).log = original; }
  return seen;
}

describe('Codex CLI usable auth.json mirror', () => {
  test('without a base file, the device-login id_token creates the ChatGPT fields the Codex CLI requires', () => {
    const id = idToken('account-123');
    let state!: ReturnType<typeof saveTokens>;
    const seen = captureMirrorLogs(() => {
      state = saveTokens('openai-codex', tokens('first-access', id), { authMode: 'chatgpt' }, storePath());
    });

    const auth = JSON.parse(readFileSync(mirrorPath(), 'utf8'));
    expect(auth).toMatchObject({
      OPENAI_API_KEY: null,
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'first-access',
        refresh_token: 'first-access-refresh',
        id_token: id,
        account_id: 'account-123',
      },
    });
    expect(seen.map(({ event }) => event)).toContain('wrote');
    expect(state.codexMirrorResult).toBe('written');
    expect(codexLoginSuccessMessage(state.codexMirrorResult)).toContain('Mirrored to ~/.codex/auth.json.');
    expect(JSON.stringify(seen)).not.toContain('first-access');
    expect(JSON.stringify(seen)).not.toContain('first-access-refresh');
    expect(JSON.stringify(seen)).not.toContain(id);
  });

  test('with a base file, rotating tokens overlay only the existing token slots', () => {
    const base = {
      OPENAI_API_KEY: null,
      auth_mode: 'chatgpt',
      custom_top_level: 'preserved',
      tokens: {
        id_token: 'base-id-token',
        account_id: 'base-account',
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        custom_token_field: 'preserved',
      },
    };
    require('node:fs').mkdirSync(process.env.CODEX_HOME!, { recursive: true });
    writeFileSync(mirrorPath(), JSON.stringify(base));

    saveTokens('openai-codex', tokens('rotated-access'), { authMode: 'chatgpt' }, storePath());

    const auth = JSON.parse(readFileSync(mirrorPath(), 'utf8'));
    expect(auth.custom_top_level).toBe('preserved');
    expect(auth.auth_mode).toBe('chatgpt');
    expect(auth.tokens).toEqual({
      id_token: 'base-id-token',
      account_id: 'base-account',
      access_token: 'rotated-access',
      refresh_token: 'rotated-access-refresh',
      custom_token_field: 'preserved',
    });
  });

  test('without a base file or device-login fields, it does not create a CLI-rejected partial mirror, observes why, and directs the user to codex login', () => {
    let state!: ReturnType<typeof saveTokens>;
    const seen = captureMirrorLogs(() => {
      state = saveTokens('openai-codex', tokens('refresh-access'), { authMode: 'chatgpt' }, storePath());
    });

    expect(existsSync(mirrorPath())).toBe(false);
    expect(seen.map(({ event }) => event)).toContain('not-created-missing-cli-fields');
    expect(state.codexMirrorResult).toBe('not-created-missing-cli-fields');
    const message = codexLoginSuccessMessage(state.codexMirrorResult);
    expect(message).not.toContain('Mirrored to ~/.codex/auth.json.');
    expect(message).toContain('`codex login` once');
    expect(JSON.stringify(seen)).not.toContain('refresh-access');
    expect(JSON.stringify(seen)).not.toContain('refresh-access-refresh');
  });
});
