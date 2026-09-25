// Cascade-zyu W1 U0 (2026-05-12) — User Intent Logger fabric tests.
//
// Covers the U0 contract surface:
//   1. logger.emit() returns a canonical UserIntentEvent with the
//      universal header filled (event_id / ts / monad_id / surface).
//   2. utterance value defaults to sha256 content hash (PLAN §5).
//   3. utterance with logFullContent=true keeps the raw string.
//   4. key-blocklist sweep redacts api-key / authorization values
//      regardless of layer.
//   5. JSONL sink writes one daily-rotated line per emit, valid JSON.
//   6. setEnabled(false) makes emit a no-op (no sink call).
//   7. Custom sinks receive the same redacted event.
//   8. isUserIntentEventInput rejects malformed shapes.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UserIntentLogger,
  _resetUserIntentLogger,
  isUserIntentEventInput,
  setUserIntentJsonlDirOverride,
  userIntentJsonlPath,
  type UserIntentEvent,
  type UserIntentSink,
} from '../src/user-intent/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'user-intent-test-'));
  setUserIntentJsonlDirOverride(tmpDir);
});

afterEach(() => {
  setUserIntentJsonlDirOverride(null);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('UserIntentLogger.emit — universal header', () => {
  test('fills event_id / ts / surface / monad_id (best-effort)', () => {
    const logger = new UserIntentLogger();
    const ev = logger.emit({
      surface: 'pwa',
      intent: { layer: 'gesture', kind: 'pwa.gesture.swipe_right' },
    });
    expect(ev).not.toBeNull();
    expect(ev!.schema_version).toBe(1);
    expect(ev!.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ev!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ev!.surface).toBe('pwa');
    expect(ev!.intent.kind).toBe('pwa.gesture.swipe_right');
    // monad_id is best-effort — may be empty when identity write fails
    // in CI sandboxes but the field always exists.
    expect(typeof ev!.monad_id).toBe('string');
  });

  test('honors caller overrides for session/user/device', () => {
    const logger = new UserIntentLogger();
    const ev = logger.emit({
      surface: 'ios',
      intent: { layer: 'ambient', kind: 'ios.ambient.region_enter' },
      session_id: 's-1',
      user_id: 'u-1',
      device_id: 'iphone-15',
    });
    expect(ev!.session_id).toBe('s-1');
    expect(ev!.user_id).toBe('u-1');
    expect(ev!.device_id).toBe('iphone-15');
  });
});

describe('UserIntentLogger.emit — redaction', () => {
  test('utterance value defaults to sha256 content_hash', () => {
    const logger = new UserIntentLogger();
    const ev = logger.emit({
      surface: 'discord',
      intent: {
        layer: 'utterance',
        kind: 'discord.utterance.dm_text',
        value: 'plaintext message that should be hashed',
      },
    });
    const value = ev!.intent.value as { content_hash: string; length: number };
    expect(typeof value.content_hash).toBe('string');
    expect(value.content_hash).toHaveLength(64);
    expect(value.length).toBe('plaintext message that should be hashed'.length);
    expect(JSON.stringify(ev)).not.toContain('plaintext message');
  });

  test('logFullContent=true keeps the raw utterance', () => {
    const logger = new UserIntentLogger({ logFullContent: true });
    const ev = logger.emit({
      surface: 'discord',
      intent: {
        layer: 'utterance',
        kind: 'discord.utterance.dm_text',
        value: 'plaintext message',
      },
    });
    expect(ev!.intent.value).toBe('plaintext message');
  });

  test('non-utterance layers pass value through verbatim', () => {
    const logger = new UserIntentLogger();
    const ev = logger.emit({
      surface: 'pwa',
      intent: {
        layer: 'selection',
        kind: 'pwa.selection.task_chip_tap',
        value: 'approve',
      },
    });
    expect(ev!.intent.value).toBe('approve');
  });

  test('key-blocklist sweep masks api-key / authorization', () => {
    const logger = new UserIntentLogger();
    const ev = logger.emit({
      surface: 'pwa',
      intent: {
        layer: 'system',
        kind: 'pwa.system.diag',
        value: {
          authorization: 'Bearer 0123456789ABCDEF',
          api_key: 'sk-12345',
          plain: 'visible',
        },
      },
    });
    const v = ev!.intent.value as Record<string, unknown>;
    expect(v.authorization).not.toBe('Bearer 0123456789ABCDEF');
    expect(v.api_key).not.toBe('sk-12345');
    expect(v.plain).toBe('visible');
  });

  test('motion.raw_signal is stripped pre-sink', () => {
    const logger = new UserIntentLogger();
    const ev = logger.emit({
      surface: 'watch',
      intent: {
        layer: 'gesture',
        kind: 'watch.gesture.wrist_flip',
        motion: { kind: 'wrist_flip', magnitude: 0.8, raw_signal: { x: 1, y: 2 } },
      },
    });
    expect(ev!.intent.motion?.kind).toBe('wrist_flip');
    expect(ev!.intent.motion?.magnitude).toBe(0.8);
    // raw_signal must be dropped before any sink sees the event.
    expect((ev!.intent.motion as unknown as Record<string, unknown>).raw_signal).toBeUndefined();
  });
});

describe('UserIntentLogger.emit — JSONL sink', () => {
  test('writes one valid JSON line to the daily file', () => {
    const logger = new UserIntentLogger();
    const ev = logger.emit({
      surface: 'tui',
      intent: { layer: 'gesture', kind: 'tui.gesture.key_enter' },
    });
    const path = userIntentJsonlPath(ev!.ts);
    expect(path.startsWith(tmpDir)).toBe(true);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as UserIntentEvent;
    expect(parsed.event_id).toBe(ev!.event_id);
    expect(parsed.intent.kind).toBe('tui.gesture.key_enter');
  });

  test('multiple emits append to the same daily file', () => {
    const logger = new UserIntentLogger();
    for (let i = 0; i < 3; i++) {
      logger.emit({
        surface: 'tui',
        intent: { layer: 'gesture', kind: `tui.gesture.key_${i}` },
      });
    }
    const files = readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    const lines = readFileSync(join(tmpDir, files[0]!), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
  });
});

describe('UserIntentLogger — sink fan-out + gating', () => {
  test('setEnabled(false) makes emit a no-op', () => {
    const logger = new UserIntentLogger();
    logger.setEnabled(false);
    const ev = logger.emit({
      surface: 'tui',
      intent: { layer: 'gesture', kind: 'tui.gesture.key_a' },
    });
    expect(ev).toBeNull();
    expect(readdirSync(tmpDir)).toHaveLength(0);
  });

  test('custom sinks receive the redacted event', () => {
    const logger = new UserIntentLogger();
    const received: UserIntentEvent[] = [];
    const customSink: UserIntentSink = {
      name: 'capture',
      write: (ev) => { received.push(ev); },
    };
    logger.addSink(customSink);
    const ev = logger.emit({
      surface: 'discord',
      intent: {
        layer: 'utterance',
        kind: 'discord.utterance.dm_text',
        value: 'secret content',
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.event_id).toBe(ev!.event_id);
    // Custom sink sees the same redacted shape as JSONL.
    expect(received[0]!.intent.value).toEqual(ev!.intent.value);
    expect(JSON.stringify(received[0])).not.toContain('secret content');
  });

  test('sink errors do not break emit', () => {
    const logger = new UserIntentLogger();
    logger.addSink({
      name: 'throws',
      write: () => { throw new Error('boom'); },
    });
    const ev = logger.emit({
      surface: 'tui',
      intent: { layer: 'gesture', kind: 'tui.gesture.key_x' },
    });
    expect(ev).not.toBeNull();
  });

  test('removeSink + setSinks (test seam)', () => {
    const logger = new UserIntentLogger();
    expect(logger.listSinks()).toContain('jsonl');
    logger.removeSink('jsonl');
    expect(logger.listSinks()).not.toContain('jsonl');
    logger.setSinks([{ name: 'only', write: () => {} }]);
    expect(logger.listSinks()).toEqual(['only']);
  });
});

describe('isUserIntentEventInput', () => {
  test('accepts a minimal valid input', () => {
    expect(isUserIntentEventInput({
      surface: 'pwa',
      intent: { layer: 'gesture', kind: 'pwa.gesture.tap' },
    })).toBe(true);
  });

  test.each([
    ['missing surface', { intent: { layer: 'gesture', kind: 'pwa.gesture.tap' } }],
    ['bad surface', { surface: 'web', intent: { layer: 'gesture', kind: 'web.gesture.tap' } }],
    ['missing intent', { surface: 'pwa' }],
    ['missing layer', { surface: 'pwa', intent: { kind: 'pwa.gesture.tap' } }],
    ['empty kind', { surface: 'pwa', intent: { layer: 'gesture', kind: '' } }],
    ['null', null],
    ['number', 42],
  ])('rejects %s', (_label, value) => {
    expect(isUserIntentEventInput(value)).toBe(false);
  });
});

describe('_resetUserIntentLogger (test seam)', () => {
  test('produces a fresh singleton with custom options', () => {
    const logger = _resetUserIntentLogger({ logFullContent: true });
    const ev = logger.emit({
      surface: 'discord',
      intent: {
        layer: 'utterance',
        kind: 'discord.utterance.dm_text',
        value: 'visible',
      },
    });
    expect(ev!.intent.value).toBe('visible');
    _resetUserIntentLogger();
  });
});
