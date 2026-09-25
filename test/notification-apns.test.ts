// Phase 0.5 · APNs transport tests.
// Cover the signing path + transport orchestration without touching the
// network. Real `node:http2` connect is replaced by a fake satisfying
// the `Http2SessionLike` surface declared in `src/notification-apns.ts`.

import { describe, expect, test } from 'bun:test';
import { createPrivateKey, generateKeyPairSync, createPublicKey } from 'node:crypto';
import {
  createApnsTransport,
  derToJoseEs256,
  signApnsJwt,
  type Http2SessionLike,
  type Http2StreamLike,
} from '../src/notification-apns.js';

function generateEcKeyPemPair(): { privateKeyPem: string; publicKeyPem: string } {
  // P-256 = prime256v1 = secp256r1 = Apple's .p8 curve.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }) as string,
  };
}

function base64urlDecode(s: string): Buffer {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

describe('derToJoseEs256', () => {
  test('strips ASN.1 sign byte (DER r,s 33-byte → JOSE 32-byte)', () => {
    // SEQUENCE { INTEGER 33-byte r , INTEGER 33-byte s }
    // 0x30 0x46 (70 bytes total content)
    //   0x02 0x21 [0x00 ...32 r bytes...]
    //   0x02 0x21 [0x00 ...32 s bytes...]
    const r33 = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(32, 0xaa)]);
    const s33 = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(32, 0xbb)]);
    const der = Buffer.concat([
      Buffer.from([0x30, 0x46, 0x02, 0x21]), r33,
      Buffer.from([0x02, 0x21]), s33,
    ]);
    const jose = derToJoseEs256(der);
    expect(jose.length).toBe(64);
    expect(jose.subarray(0, 32).every((b) => b === 0xaa)).toBe(true);
    expect(jose.subarray(32).every((b) => b === 0xbb)).toBe(true);
  });

  test('left-pads short r (DER 30-byte → JOSE 32-byte)', () => {
    const r30 = Buffer.alloc(30, 0xcd);
    const s32 = Buffer.alloc(32, 0xef);
    const der = Buffer.concat([
      Buffer.from([0x30, 0x40, 0x02, 0x1e]), r30,
      Buffer.from([0x02, 0x20]), s32,
    ]);
    const jose = derToJoseEs256(der);
    expect(jose.length).toBe(64);
    expect(jose[0]).toBe(0);
    expect(jose[1]).toBe(0);
    expect(jose[2]).toBe(0xcd);
  });
});

describe('signApnsJwt', () => {
  test('produces a 3-part JWT (header.payload.signature)', () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const jwt = signApnsJwt({
      keyId: 'KID1234567',
      teamId: 'TID1234567',
      privateKey: createPrivateKey(privateKeyPem),
      iat: 1_700_000_000,
    });
    const parts = jwt.split('.');
    expect(parts.length).toBe(3);
  });

  test('header includes kid + alg=ES256, payload includes iss + iat', () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const jwt = signApnsJwt({
      keyId: 'ABCDEFGHIJ',
      teamId: 'TEAM999999',
      privateKey: createPrivateKey(privateKeyPem),
      iat: 1_700_001_234,
    });
    const [h, p] = jwt.split('.');
    const header  = JSON.parse(base64urlDecode(h!).toString('utf8'));
    const payload = JSON.parse(base64urlDecode(p!).toString('utf8'));
    expect(header).toEqual({ alg: 'ES256', kid: 'ABCDEFGHIJ', typ: 'JWT' });
    expect(payload).toEqual({ iss: 'TEAM999999', iat: 1_700_001_234 });
  });

  test('signature is 64-byte JOSE (r||s)', () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const jwt = signApnsJwt({
      keyId: 'K', teamId: 'T',
      privateKey: createPrivateKey(privateKeyPem),
      iat: 1,
    });
    const sig = base64urlDecode(jwt.split('.')[2]!);
    expect(sig.length).toBe(64);
  });
});

describe('createApnsTransport · happy path', () => {
  // Helper fake satisfying Http2SessionLike. Captures the last request
  // headers + body so tests can assert what was sent.
  function fakeSession(opts: {
    status: number;
    responseBody?: string;
  }): { session: Http2SessionLike; captured: { headers: Record<string, unknown>; body: string }[] } {
    const captured: { headers: Record<string, unknown>; body: string }[] = [];
    const session: Http2SessionLike = {
      destroyed: false,
      request(headers) {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {
          response: [], data: [], end: [], error: [],
        };
        const stream = {
          end(body?: string | Buffer) {
            captured.push({ headers, body: typeof body === 'string' ? body : (body?.toString('utf8') ?? '') });
            // Synthesize response + end. The transport reads :status from
            // the response headers + accumulates data, then resolves on
            // 'end'. We fire them on next-microtask so the listeners
            // (registered after request()) actually attach.
            queueMicrotask(() => {
              listeners.response.forEach((fn) => fn({ ':status': String(opts.status) }));
              if (opts.responseBody) {
                listeners.data.forEach((fn) => fn(opts.responseBody!));
              }
              listeners.end.forEach((fn) => fn());
            });
            return undefined as never;
          },
          on(event: string, listener: (...args: unknown[]) => void) {
            (listeners[event] ?? []).push(listener);
            return stream;
          },
          setEncoding() { /* noop */ },
        } as unknown as Http2StreamLike;
        return stream;
      },
    };
    return { session, captured };
  }

  test('200 OK → ok: true · correct path + headers', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const { session, captured } = fakeSession({ status: 200 });
    const transport = createApnsTransport({
      keyId: 'KID',
      teamId: 'TID',
      bundleId: 'com.monad.app',
      keyPem: privateKeyPem,
      http2Connect: () => session,
      now: () => 1_700_000_000_000,
    });
    const res = await transport.send('deadbeef', {
      aps: { alert: { title: 'hi', body: 'b' }, 'interruption-level': 'active' },
    });
    expect(res.ok).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0]!.headers[':path']).toBe('/3/device/deadbeef');
    expect(captured[0]!.headers[':method']).toBe('POST');
    expect(captured[0]!.headers['apns-topic']).toBe('com.monad.app');
    expect(captured[0]!.headers['apns-push-type']).toBe('alert');
    expect(captured[0]!.headers['apns-priority']).toBe(10);
    expect(String(captured[0]!.headers.authorization)).toMatch(/^bearer /);
  });

  test('passive interruption → apns-priority 5', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const { session, captured } = fakeSession({ status: 200 });
    const transport = createApnsTransport({
      keyId: 'K', teamId: 'T', bundleId: 'b',
      keyPem: privateKeyPem,
      http2Connect: () => session,
    });
    await transport.send('abcd1234', {
      aps: { alert: { title: 'h' }, 'interruption-level': 'passive' },
    });
    expect(captured[0]!.headers['apns-priority']).toBe(5);
  });

  test('sandbox environment routes to api.sandbox.push.apple.com', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const captured: string[] = [];
    createApnsTransport({
      keyId: 'K', teamId: 'T', bundleId: 'b',
      keyPem: privateKeyPem,
      environment: 'sandbox',
      http2Connect: (host) => {
        captured.push(host);
        return fakeSession({ status: 200 }).session;
      },
    }).send('abcd', { aps: { alert: { title: 'h' } } });
    // Wait one microtask so connect() runs.
    await new Promise<void>((r) => queueMicrotask(r));
    expect(captured[0]).toBe('api.sandbox.push.apple.com');
  });

  test('JWT cached across sends within refresh window', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const { session, captured } = fakeSession({ status: 200 });
    let t = 1_700_000_000_000;
    const transport = createApnsTransport({
      keyId: 'K', teamId: 'T', bundleId: 'b',
      keyPem: privateKeyPem,
      http2Connect: () => session,
      now: () => t,
    });
    await transport.send('abcd', { aps: { alert: { title: 'h1' } } });
    t += 5 * 60 * 1000;  // +5 min · same JWT expected
    await transport.send('abcd', { aps: { alert: { title: 'h2' } } });
    const jwt1 = captured[0]!.headers.authorization;
    const jwt2 = captured[1]!.headers.authorization;
    expect(jwt1).toBe(jwt2);
  });

  test('JWT refreshed past 50-minute mark', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const { session, captured } = fakeSession({ status: 200 });
    let t = 1_700_000_000_000;
    const transport = createApnsTransport({
      keyId: 'K', teamId: 'T', bundleId: 'b',
      keyPem: privateKeyPem,
      http2Connect: () => session,
      now: () => t,
    });
    await transport.send('abcd', { aps: { alert: { title: 'h1' } } });
    t += 51 * 60 * 1000;  // +51 min · refresh expected
    await transport.send('abcd', { aps: { alert: { title: 'h2' } } });
    expect(captured[0]!.headers.authorization).not.toBe(captured[1]!.headers.authorization);
  });
});

describe('createApnsTransport · error paths', () => {
  function failingSession(status: number, body: string): Http2SessionLike {
    return {
      destroyed: false,
      request() {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {
          response: [], data: [], end: [], error: [],
        };
        const stream = {
          end() {
            queueMicrotask(() => {
              listeners.response.forEach((fn) => fn({ ':status': String(status) }));
              listeners.data.forEach((fn) => fn(body));
              listeners.end.forEach((fn) => fn());
            });
            return undefined as never;
          },
          on(event: string, listener: (...args: unknown[]) => void) {
            (listeners[event] ?? []).push(listener);
            return stream;
          },
          setEncoding() { /* noop */ },
        } as unknown as Http2StreamLike;
        return stream;
      },
    };
  }

  test('non-hex device token → invalid shape (no network)', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const transport = createApnsTransport({
      keyId: 'K', teamId: 'T', bundleId: 'b',
      keyPem: privateKeyPem,
      http2Connect: () => failingSession(200, ''),
    });
    const res = await transport.send('not!hex!', { aps: { alert: { title: 'h' } } });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('invalid device token shape');
  });

  test('410 Gone → ok: false with status reason', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const transport = createApnsTransport({
      keyId: 'K', teamId: 'T', bundleId: 'b',
      keyPem: privateKeyPem,
      http2Connect: () => failingSession(410, '{"reason":"Unregistered"}'),
    });
    const res = await transport.send('abcd', { aps: { alert: { title: 'h' } } });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('apns-410');
    expect(res.reason).toContain('Unregistered');
  });

  test('stream error → ok: false with surface message', async () => {
    const { privateKeyPem } = generateEcKeyPemPair();
    const erroringSession: Http2SessionLike = {
      destroyed: false,
      request() {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {
          response: [], data: [], end: [], error: [],
        };
        const stream = {
          end() {
            queueMicrotask(() => {
              listeners.error.forEach((fn) => fn(new Error('econnreset')));
            });
            return undefined as never;
          },
          on(event: string, listener: (...args: unknown[]) => void) {
            (listeners[event] ?? []).push(listener);
            return stream;
          },
          setEncoding() { /* noop */ },
        } as unknown as Http2StreamLike;
        return stream;
      },
    };
    const transport = createApnsTransport({
      keyId: 'K', teamId: 'T', bundleId: 'b',
      keyPem: privateKeyPem,
      http2Connect: () => erroringSession,
    });
    const res = await transport.send('abcd', { aps: { alert: { title: 'h' } } });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('apns-stream-error');
    expect(res.reason).toContain('econnreset');
  });
});

describe('signApnsJwt · signature verifies', () => {
  test('public key verifies the signed JWT', () => {
    const { privateKeyPem, publicKeyPem } = generateEcKeyPemPair();
    const jwt = signApnsJwt({
      keyId: 'KID',
      teamId: 'TID',
      privateKey: createPrivateKey(privateKeyPem),
      iat: 1_700_000_000,
    });
    const [h, p, s] = jwt.split('.');
    const signingInput = Buffer.from(`${h}.${p}`, 'utf8');
    const joseSig = base64urlDecode(s!);
    // Re-encode JOSE sig as DER to feed Node's verify.
    const r = joseSig.subarray(0, 32);
    const sBytes = joseSig.subarray(32);
    function trimLeadingZeros(buf: Buffer): Buffer {
      let i = 0;
      while (i < buf.length - 1 && buf[i] === 0) i += 1;
      const tail = buf.subarray(i);
      // Re-add sign byte if high bit set (preserve unsigned).
      return (tail[0]! & 0x80) ? Buffer.concat([Buffer.from([0x00]), tail]) : tail;
    }
    const rT = trimLeadingZeros(r);
    const sT = trimLeadingZeros(sBytes);
    const der = Buffer.concat([
      Buffer.from([0x30, 2 + rT.length + 2 + sT.length]),
      Buffer.from([0x02, rT.length]), rT,
      Buffer.from([0x02, sT.length]), sT,
    ]);
    const verify = createPublicKey(publicKeyPem);
    const { createVerify } = require('node:crypto') as typeof import('node:crypto');
    const ok = createVerify('SHA256').update(signingInput).verify(verify, der);
    expect(ok).toBe(true);
  });
});
