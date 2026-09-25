// NEXUS · Edit-in-PWA tests (Phase N-3 cleanup PR β')

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  EDIT_IN_PWA_DEFAULT_TTL_MS,
  NonceStore,
  buildEditInPwaUrl,
  copyToClipboard,
  loadOrCreateSigningKey,
  signEditInPwaToken,
  signingKeyPath,
  verifyEditInPwaToken,
} from '../src/nexus/api/edit-in-pwa-core.js';
import {
  handleEditInPwaConsume,
  handleEditInPwaPost,
  type EditInPwaCtx,
} from '../src/nexus/api/edit-in-pwa.js';
import { reloadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { makeStubRunCli } from '../src/nexus/config/secrets/cli-helper.js';

let tmpRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'monad-nexus-beta-prime-'));
  prevEnv = process.env.MONAD_NEXUS_DIR;
  process.env.MONAD_NEXUS_DIR = tmpRoot;
  reloadAllBuiltins();
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeCtx(overrides: Partial<EditInPwaCtx> = {}): EditInPwaCtx {
  return {
    signingKey: 'deadbeef'.repeat(8),
    nonceStore: new NonceStore(),
    audience: '127.0.0.1:31415',
    nexusOrigin: 'http://127.0.0.1:31415',
    ...overrides,
  };
}

describe('loadOrCreateSigningKey · persistence', () => {
  test('first call creates the key file (0o600)', () => {
    const key = loadOrCreateSigningKey();
    expect(key.length).toBeGreaterThanOrEqual(64);
    expect(existsSync(signingKeyPath())).toBe(true);
    const env = JSON.parse(readFileSync(signingKeyPath(), 'utf-8'));
    expect(env.secretHex).toBe(key);
    expect(typeof env.createdAt).toBe('string');
  });

  test('second call returns the same key (idempotent)', () => {
    const k1 = loadOrCreateSigningKey();
    const k2 = loadOrCreateSigningKey();
    expect(k1).toBe(k2);
  });

  test('corrupt file → fresh key + overwrite', () => {
    loadOrCreateSigningKey();
    // Corrupt
    require('node:fs').writeFileSync(signingKeyPath(), 'oops not json', { mode: 0o600 });
    const k = loadOrCreateSigningKey();
    expect(k.length).toBeGreaterThanOrEqual(64);
    expect(existsSync(signingKeyPath())).toBe(true);
  });
});

describe('signEditInPwaToken · structure', () => {
  test('payload contains aud / switchId / iat / exp / nonce', () => {
    const out = signEditInPwaToken({
      secret: 'deadbeef'.repeat(8),
      audience: '127.0.0.1:31415',
      switchId: 'global.debug.enabled',
      now: 1_000_000,
    });
    expect(out.payload.aud).toBe('127.0.0.1:31415');
    expect(out.payload.switchId).toBe('global.debug.enabled');
    expect(out.payload.iat).toBe(1_000_000);
    expect(out.payload.exp).toBe(1_000_000 + EDIT_IN_PWA_DEFAULT_TTL_MS);
    expect(out.payload.nonce.length).toBeGreaterThanOrEqual(16);
    expect(out.encoded.split('.').length).toBe(2);
  });

  test('different secrets produce different signatures', () => {
    const a = signEditInPwaToken({ secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', nonce: 'n' });
    const b = signEditInPwaToken({ secret: 'bb'.repeat(32), audience: 'x:1', switchId: 's', nonce: 'n' });
    expect(a.encoded).not.toBe(b.encoded);
  });

  test('nonce override produces deterministic encoding (test seam)', () => {
    const a = signEditInPwaToken({ secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', nonce: 'fixed', now: 1 });
    const b = signEditInPwaToken({ secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', nonce: 'fixed', now: 1 });
    expect(a.encoded).toBe(b.encoded);
  });
});

describe('verifyEditInPwaToken · acceptance', () => {
  test('valid signature + audience + not expired → valid:true', () => {
    const signed = signEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', now: 1000,
    });
    const out = verifyEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', encoded: signed.encoded, now: 2000,
    });
    expect(out.valid).toBe(true);
    if (out.valid) expect(out.payload.switchId).toBe('s');
  });

  test('tampered payload → bad-signature', () => {
    const signed = signEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', now: 1000, nonce: 'n',
    });
    const sig = signed.encoded.split('.')[1];
    const tamperedPayload = Buffer.from('{"aud":"x:1","switchId":"DIFFERENT","exp":99999999999,"iat":1,"nonce":"n"}').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const out = verifyEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', encoded: `${tamperedPayload}.${sig}`, now: 2000,
    });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('bad-signature');
  });

  test('mismatched secret → bad-signature', () => {
    const signed = signEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', now: 1000,
    });
    const out = verifyEditInPwaToken({
      secret: 'bb'.repeat(32), audience: 'x:1', encoded: signed.encoded, now: 2000,
    });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('bad-signature');
  });

  test('expired → expired', () => {
    const signed = signEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', ttlMs: 1, now: 1000,
    });
    const out = verifyEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', encoded: signed.encoded, now: 9999999,
    });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('expired');
  });

  test('audience mismatch → audience-mismatch', () => {
    const signed = signEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', switchId: 's', now: 1000,
    });
    const out = verifyEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'y:2', encoded: signed.encoded, now: 2000,
    });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('audience-mismatch');
  });

  test('malformed encoding → malformed', () => {
    const out = verifyEditInPwaToken({
      secret: 'aa'.repeat(32), audience: 'x:1', encoded: 'not-a-token', now: 1000,
    });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('malformed');
  });
});

describe('NonceStore · single-use', () => {
  test('first consume returns true · second returns false', () => {
    const store = new NonceStore();
    expect(store.consume('a')).toBe(true);
    expect(store.consume('a')).toBe(false);
    expect(store.size()).toBe(1);
  });

  test('clear() resets the set', () => {
    const store = new NonceStore();
    store.consume('a');
    store.clear();
    expect(store.consume('a')).toBe(true);
  });
});

describe('buildEditInPwaUrl · shape', () => {
  test('default: nexus origin + /settings/edit + token + switchId', () => {
    const url = buildEditInPwaUrl({
      nexusOrigin: 'http://127.0.0.1:31415',
      token: 'tok',
      switchId: 'global.debug.enabled',
    });
    expect(url).toBe('http://127.0.0.1:31415/settings/edit?token=tok&switchId=global.debug.enabled');
  });

  test('pwaOrigin override (PWA on different host)', () => {
    const url = buildEditInPwaUrl({
      nexusOrigin: 'http://127.0.0.1:31415',
      pwaOrigin: 'http://pwa.local:5000',
      token: 'tok',
      switchId: 's',
    });
    expect(url.startsWith('http://pwa.local:5000/settings/edit?')).toBe(true);
  });
});

describe('copyToClipboard · platform dispatch', () => {
  test('darwin → pbcopy', async () => {
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      pbcopy: (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; },
    });
    const out = await copyToClipboard('hello', { runCli: stub, platformOverride: 'darwin' });
    expect(out.ok).toBe(true);
    expect(out.via).toBe('pbcopy');
    expect(calls).toEqual([['pbcopy']]);
  });

  test('linux → wl-copy first, fall back to xclip / xsel', async () => {
    const stub = makeStubRunCli({
      'wl-copy': () => ({ exitCode: 1, stdout: '', stderr: 'no wayland' }),
      xclip: () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });
    const out = await copyToClipboard('hello', { runCli: stub, platformOverride: 'linux' });
    expect(out.ok).toBe(true);
    expect(out.via).toBe('xclip');
  });

  test('no clipboard tool → ok:false', async () => {
    const stub = makeStubRunCli({
      'wl-copy': () => ({ exitCode: 127, stdout: '', stderr: 'not found' }),
      xclip: () => ({ exitCode: 127, stdout: '', stderr: 'not found' }),
      xsel: () => ({ exitCode: 127, stdout: '', stderr: 'not found' }),
    });
    const out = await copyToClipboard('hello', { runCli: stub, platformOverride: 'linux' });
    expect(out.ok).toBe(false);
    expect(out.via).toBe('none');
  });
});

describe('handleEditInPwaPost · /v1/nexus/edit-in-pwa', () => {
  test('valid switchId → 201 with token / url / expiresAt', async () => {
    const ctx = makeCtx();
    const req = new Request('http://x/v1/nexus/edit-in-pwa', {
      method: 'POST',
      body: JSON.stringify({ switchId: 'global.debug.enabled' }),
    });
    const res = await handleEditInPwaPost(req, ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.url).toContain('/settings/edit');
    expect(body.url).toContain('switchId=global.debug.enabled');
    expect(typeof body.expiresAt).toBe('number');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  test('unknown switchId → 404', async () => {
    const ctx = makeCtx();
    const req = new Request('http://x/v1/nexus/edit-in-pwa', {
      method: 'POST',
      body: JSON.stringify({ switchId: 'global.does-not-exist' }),
    });
    const res = await handleEditInPwaPost(req, ctx);
    expect(res.status).toBe(404);
  });

  test('missing switchId → 400', async () => {
    const ctx = makeCtx();
    const req = new Request('http://x/v1/nexus/edit-in-pwa', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handleEditInPwaPost(req, ctx);
    expect(res.status).toBe(400);
  });

  test('malformed JSON → 400', async () => {
    const ctx = makeCtx();
    const req = new Request('http://x/v1/nexus/edit-in-pwa', {
      method: 'POST',
      body: 'not-json{',
    });
    const res = await handleEditInPwaPost(req, ctx);
    expect(res.status).toBe(400);
  });
});

describe('handleEditInPwaConsume · /v1/nexus/edit-in-pwa/consume', () => {
  test('first consume of a valid token → 200 valid:true', async () => {
    const ctx = makeCtx();
    const signed = signEditInPwaToken({
      secret: ctx.signingKey,
      audience: ctx.audience,
      switchId: 'global.debug.enabled',
    });
    const req = new Request('http://x/v1/nexus/edit-in-pwa/consume', {
      method: 'POST',
      body: JSON.stringify({ token: signed.encoded }),
    });
    const res = await handleEditInPwaConsume(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.switchId).toBe('global.debug.enabled');
  });

  test('replay (same token consumed twice) → 410 valid:false reason:replay', async () => {
    const ctx = makeCtx();
    const signed = signEditInPwaToken({
      secret: ctx.signingKey,
      audience: ctx.audience,
      switchId: 'global.debug.enabled',
    });
    const make = () => new Request('http://x/v1/nexus/edit-in-pwa/consume', {
      method: 'POST',
      body: JSON.stringify({ token: signed.encoded }),
    });
    await handleEditInPwaConsume(make(), ctx);
    const res = await handleEditInPwaConsume(make(), ctx);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('replay');
  });

  test('bad signature → 400 valid:false', async () => {
    const ctx = makeCtx();
    const req = new Request('http://x/v1/nexus/edit-in-pwa/consume', {
      method: 'POST',
      body: JSON.stringify({ token: 'aaaa.bbbb' }),
    });
    const res = await handleEditInPwaConsume(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  test('audience mismatch → 400 valid:false reason:audience-mismatch', async () => {
    const ctx = makeCtx({ audience: '127.0.0.1:31415' });
    const otherSigned = signEditInPwaToken({
      secret: ctx.signingKey,
      audience: '0.0.0.0:99',
      switchId: 'global.debug.enabled',
    });
    const req = new Request('http://x/v1/nexus/edit-in-pwa/consume', {
      method: 'POST',
      body: JSON.stringify({ token: otherSigned.encoded }),
    });
    const res = await handleEditInPwaConsume(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('audience-mismatch');
  });
});
