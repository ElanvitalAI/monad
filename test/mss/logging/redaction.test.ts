// ── Redaction tests (MSS M2.3) ──
//
// Direct coverage of `redactLogRecord`. Integration with the `DebugLog`
// singleton (flag-gated wire-up) is exercised in `debug-log.test.ts`;
// this file pins the pure-function semantics.

import { describe, expect, test } from 'bun:test';

import { REDACT_KEY_BLOCKLIST, redactLogRecord } from '../../../src/mss/logging/redaction.ts';
import type { LogRecord } from '../../../src/mss/logging/record.ts';

function mkRec(data: unknown, overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: '2026-04-25T00:00:00.000Z',
    category: 'test',
    event: 'ev',
    data,
    ...overrides,
  };
}

describe('redactLogRecord · basic masking', () => {
  test('masks top-level authorization value (head/tail for long strings)', () => {
    const rec = mkRec({ authorization: 'Bearer sk-abc1234567xyz' });
    const out = redactLogRecord(rec);
    const d = out.data as Record<string, string>;
    expect(d.authorization).not.toBe('Bearer sk-abc1234567xyz');
    expect(d.authorization.startsWith('Bear')).toBe(true);
    expect(d.authorization.endsWith('7xyz')).toBe(true);
    expect(d.authorization).toContain('…');
  });

  test('short values use <redacted> placeholder', () => {
    const rec = mkRec({ cookie: 'tiny' });
    const out = redactLogRecord(rec);
    expect((out.data as Record<string, string>).cookie).toBe('<redacted>');
  });

  test('recurses into nested objects', () => {
    const rec = mkRec({
      headers: {
        authorization: 'Bearer very-long-secret-token-here',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    const out = redactLogRecord(rec);
    const d = out.data as { headers: Record<string, string>; method: string };
    expect(d.headers.authorization).not.toBe('Bearer very-long-secret-token-here');
    expect(d.headers.authorization).toContain('…');
    expect(d.headers['content-type']).toBe('application/json');
    expect(d.method).toBe('POST');
  });

  test('redacts inside arrays', () => {
    const rec = mkRec({
      reqs: [
        { api_key: 'k1-abcdefghijklmn' },
        { api_key: 'k2-zyxwvutsrqponm' },
      ],
    });
    const out = redactLogRecord(rec);
    const d = out.data as { reqs: Array<{ api_key: string }> };
    expect(d.reqs[0].api_key).not.toBe('k1-abcdefghijklmn');
    expect(d.reqs[1].api_key).not.toBe('k2-zyxwvutsrqponm');
    expect(d.reqs[0].api_key).toContain('…');
  });
});

describe('redactLogRecord · non-mutation', () => {
  test('original record is unchanged', () => {
    const payload = { authorization: 'Bearer verysecrettoken-xyz' };
    const rec = mkRec(payload);
    redactLogRecord(rec);
    expect(payload.authorization).toBe('Bearer verysecrettoken-xyz');
    expect(rec.data).toBe(payload);
  });

  test('non-blocklist values pass through untouched by reference where possible', () => {
    const rec = mkRec({ userId: 'u-123', count: 7, flag: true, when: null });
    const out = redactLogRecord(rec);
    expect(out.data).toEqual({ userId: 'u-123', count: 7, flag: true, when: null });
  });
});

describe('redactLogRecord · robustness', () => {
  test('circular references short-circuit', () => {
    const obj: Record<string, unknown> = { safe: 1 };
    obj.self = obj;
    const rec = mkRec(obj);
    expect(() => redactLogRecord(rec)).not.toThrow();
    const out = redactLogRecord(rec);
    expect((out.data as Record<string, unknown>).self).toBe('<circular>');
  });

  test('case-insensitive key match (Authorization ≡ authorization)', () => {
    const rec = mkRec({ Authorization: 'Bearer very-long-secret-token' });
    const out = redactLogRecord(rec);
    expect((out.data as Record<string, string>).Authorization).not.toBe('Bearer very-long-secret-token');
  });

  test('missing data field returns record unchanged', () => {
    const rec: LogRecord = { ts: '2026-04-25T00:00:00.000Z', category: 'c', event: 'e' };
    expect(redactLogRecord(rec)).toBe(rec);
  });

  test('scalar data (string/number) returns record unchanged', () => {
    const recStr = mkRec('hello');
    expect(redactLogRecord(recStr)).toBe(recStr);
    const recNum = mkRec(42);
    expect(redactLogRecord(recNum)).toBe(recNum);
  });
});

describe('redactLogRecord · options', () => {
  test('custom keyBlocklist override takes effect', () => {
    const rec = mkRec({ sessionToken: 'session-token-abcdefgh', authorization: 'safe-now' });
    const out = redactLogRecord(rec, { keyBlocklist: ['sessiontoken'] });
    const d = out.data as Record<string, string>;
    expect(d.sessionToken).toContain('…');
    expect(d.authorization).toBe('safe-now');
  });

  test('custom mask function replaces default', () => {
    const rec = mkRec({ password: 'superSecret12345' });
    const out = redactLogRecord(rec, { mask: () => 'XXX' });
    expect((out.data as Record<string, string>).password).toBe('XXX');
  });

  test('default blocklist covers the documented secret key set', () => {
    const expected = [
      'authorization',
      'api-key', 'api_key', 'apikey',
      'cookie', 'set-cookie',
      'access_token', 'accesstoken',
      'refresh_token', 'refreshtoken',
      'password', 'secret', 'private_key',
    ];
    for (const k of expected) expect(REDACT_KEY_BLOCKLIST).toContain(k);
  });
});

// LF6 dogfood 회귀(2026-07-13) — 맨몸 'token' 등 누락으로 ingest 프로브의
// {token:"…"} 가 원문 통과했던 구멍(실측). 블록리스트 보강 고정.
describe('REDACT_KEY_BLOCKLIST — LF6 보강', () => {
  test('맨몸 token/bearer/bot_token/credentials 마스킹 · 비밀 아닌 키는 보존', () => {
    const rec = redactLogRecord({
      ts: 't', category: 'c', event: 'e',
      data: { token: 'secret-abcdef-123456', bearer: 'Bearer xyz1234567890', bot_token: '12:ab', credentials: 'u:p', count: 3 },
    });
    const d = rec.data as Record<string, string | number>;
    expect(d.token).toBe('secr…3456');
    expect(String(d.bearer)).toContain('…');
    expect(d.bot_token).toBe('<redacted>');
    expect(d.credentials).toBe('<redacted>');
    expect(d.count).toBe(3);
  });
});
