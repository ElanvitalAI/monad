// SAM S0 seeds — minimal infrastructure for Session Artifact
// Management (`내부 문서 `PLAN-session-artifact-management``).
//
// Three additions:
//   (1) `SerializedMessage.turn_id?` auto-populated by `appendMessage`
//   (2) `SessionMeta.retiredAt?: string | null` — placeholder field
//   (3) `LogSource.platform?` populated via `process.platform` in
//       `enrichDebugRecord` so cross-device logs disambiguate
//
// Seeds are deliberately inert (no state machine, no consumers). The
// tests here pin the wire shape so future SAM phases can grow on top
// without a migration.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSession,
  appendMessage,
  loadSession,
} from '../src/session/index.js';
import type { SerializedMessage, SessionMeta } from '../src/session/index.js';
import { asTurnUri } from '../src/mss/uri/builder.js';

let root: string;
let prevXdgState: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sam-s0-'));
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(root, '_state');
});

afterEach(() => {
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('SAM S0 — turn_id auto-population', () => {
  test('appendMessage assigns a ULID-shaped turn_id when caller omits it', () => {
    const s = createSession({ provider: 'test', model: 'test' }, root);
    const ts = new Date().toISOString();
    appendMessage(s.id, { role: 'user', content: 'hello', ts }, root);

    const loaded = loadSession(s.id, root);
    expect(loaded).not.toBeNull();
    const msg = loaded!.messages[0];
    expect(typeof msg.turn_id).toBe('string');
    // ULID = 26 char Crockford base32
    expect(msg.turn_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('caller-supplied turn_id is preserved (migration / backfill path)', () => {
    const s = createSession({ provider: 'test', model: 'test' }, root);
    const supplied = asTurnUri('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const msg: SerializedMessage = {
      role: 'user',
      content: 'with id',
      ts: new Date().toISOString(),
      turn_id: supplied,
    };
    appendMessage(s.id, msg, root);

    const loaded = loadSession(s.id, root);
    expect(loaded!.messages[0].turn_id).toBe(supplied);
  });

  test('each append gets a distinct turn_id', () => {
    const s = createSession({ provider: 'test', model: 'test' }, root);
    const ts = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      appendMessage(s.id, { role: 'user', content: `m${i}`, ts }, root);
    }
    const loaded = loadSession(s.id, root);
    const ids = loaded!.messages.map((m) => m.turn_id);
    expect(new Set(ids).size).toBe(5);
  });

  test('persisted JSONL line carries turn_id', () => {
    const s = createSession({ provider: 'test', model: 'test' }, root);
    appendMessage(s.id, { role: 'user', content: 'persist me', ts: new Date().toISOString() }, root);

    const sessionFile = join(root, `${s.id}.jsonl`);
    const raw = readFileSync(sessionFile, 'utf-8').trim();
    const parsed = JSON.parse(raw);
    expect(typeof parsed.turn_id).toBe('string');
    expect(parsed.turn_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('SAM S0 — SessionMeta.retiredAt placeholder', () => {
  test('new sessions start without a retiredAt marker', () => {
    const s: SessionMeta = createSession({ provider: 'test', model: 'test' }, root);
    // Field is optional — may be undefined or explicitly null per
    // DD-SAM-2. What matters is that createSession does not set it.
    expect(s.retiredAt == null).toBe(true);
  });

  test('field type accepts both null and ISO-8601 string', () => {
    // Compile-time proof via assignment; runtime assertion just pins
    // the interface through a round-trip.
    const s = createSession({ provider: 'test', model: 'test' }, root);
    const marked: SessionMeta = { ...s, retiredAt: new Date().toISOString() };
    expect(typeof marked.retiredAt).toBe('string');
    const cleared: SessionMeta = { ...s, retiredAt: null };
    expect(cleared.retiredAt).toBeNull();
  });
});
