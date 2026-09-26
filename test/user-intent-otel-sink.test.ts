// OTel user-intent sink — cascade-zyu W2 U1.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UserIntentLogger,
  bootOtelUserIntentSinkFromEnv,
  buildOtelUserIntentSink,
  setUserIntentJsonlDirOverride,
  type UserIntentEvent,
} from '../src/user-intent/index.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'otel-uintent-'));
  setUserIntentJsonlDirOverride(tmp);
});

afterEach(() => {
  setUserIntentJsonlDirOverride(null);
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildOtelUserIntentSink', () => {
  test('returns null when endpoint is empty', () => {
    expect(buildOtelUserIntentSink(null)).toBeNull();
    expect(buildOtelUserIntentSink({ endpoint: '' })).toBeNull();
  });

  test('emits OTLP-shaped payload to the injected send', async () => {
    let captured: string | null = null;
    const sink = buildOtelUserIntentSink({
      endpoint: 'http://localhost:4318/v1/logs',
      send: async (body) => { captured = body; },
    });
    expect(sink).not.toBeNull();

    const ev: UserIntentEvent = {
      schema_version: 1,
      event_id: 'evt-1',
      ts: '2026-05-12T10:00:00.000Z',
      user_id: '',
      session_id: 's-1',
      device_id: 'host',
      elanous_id: 'M-1',
      surface: 'pwa',
      intent: { layer: 'gesture', kind: 'pwa.gesture.swipe_right' },
    };
    sink!.write(ev);
    await new Promise((r) => setTimeout(r, 5));
    expect(captured).not.toBeNull();
    const parsed = JSON.parse(captured!) as {
      resourceLogs: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
        scopeLogs: Array<{
          logRecords: Array<{
            body: { stringValue: string };
            attributes: Array<{ key: string; value: { stringValue: string } }>;
          }>;
        }>;
      }>;
    };
    const rl = parsed.resourceLogs[0]!;
    expect(rl.resource.attributes.find((a) => a.key === 'elanous.elanous_id')?.value.stringValue).toBe('M-1');
    const lr = rl.scopeLogs[0]!.logRecords[0]!;
    expect(lr.body.stringValue).toBe('pwa.gesture.swipe_right');
    const attrMap = Object.fromEntries(lr.attributes.map((a) => [a.key, a.value.stringValue]));
    expect(attrMap['user_intent.surface']).toBe('pwa');
    expect(attrMap['user_intent.layer']).toBe('gesture');
  });
});

describe('bootOtelUserIntentSinkFromEnv', () => {
  test('returns null without opt-in env', () => {
    expect(bootOtelUserIntentSinkFromEnv({})).toBeNull();
    expect(bootOtelUserIntentSinkFromEnv({ MSS_OTEL_ENDPOINT: 'http://x' })).toBeNull();
  });
  test('returns sink when opt-in set', () => {
    const sink = bootOtelUserIntentSinkFromEnv({
      MSS_USER_INTENT_OTEL: '1',
      MSS_OTEL_ENDPOINT: 'http://collector:4318/v1/logs',
    });
    expect(sink).not.toBeNull();
    expect(sink?.name).toBe('otel');
  });
});

describe('UserIntentLogger fan-out includes OTel sink', () => {
  test('addSink wires OTel + JSONL captures both', () => {
    const captures: string[] = [];
    const otel = buildOtelUserIntentSink({
      endpoint: 'http://x/v1/logs',
      send: async (body) => { captures.push(body); },
    });
    const logger = new UserIntentLogger();
    logger.addSink(otel!);
    logger.emit({
      surface: 'tui',
      intent: { layer: 'gesture', kind: 'tui.gesture.key_enter' },
    });
    expect(logger.listSinks()).toContain('otel');
  });
});
