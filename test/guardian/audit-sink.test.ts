import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendGuardianAudit,
  setGuardianAuditRootForTesting,
  setGuardianAuditSinkForTesting,
  type GuardianAuditEvent,
} from '../../src/guardian/audit-sink.js';

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'guardian-audit-test-'));
  setGuardianAuditRootForTesting(tempRoot);
});
afterEach(() => {
  setGuardianAuditRootForTesting(null);
  setGuardianAuditSinkForTesting(null);
  rmSync(tempRoot, { recursive: true, force: true });
});

const baseEvent = (): GuardianAuditEvent => ({
  ts: new Date().toISOString(),
  toolId: 't1',
  surface: 'skill',
  decision: 'allow',
  reasons: [],
  policy: null,
});

describe('appendGuardianAudit', () => {
  test('appends NDJSON line to today-file under audit root', () => {
    appendGuardianAudit(baseEvent());
    const files = readdirSync(tempRoot).filter(f => f.startsWith('guardian-'));
    expect(files.length).toBe(1);
    const body = readFileSync(join(tempRoot, files[0]!), 'utf-8');
    expect(body.trim().endsWith('}')).toBe(true);
    const parsed = JSON.parse(body.trim());
    expect(parsed.toolId).toBe('t1');
    expect(parsed.decision).toBe('allow');
  });

  test('multiple events produce multiple lines', () => {
    appendGuardianAudit({ ...baseEvent(), decision: 'allow' });
    appendGuardianAudit({ ...baseEvent(), decision: 'deny', reasons: ['nope'], policy: 'trust-store' });
    const files = readdirSync(tempRoot).filter(f => f.startsWith('guardian-'));
    const body = readFileSync(join(tempRoot, files[0]!), 'utf-8');
    const lines = body.trim().split('\n');
    expect(lines.length).toBe(2);
    const parsed = lines.map(l => JSON.parse(l));
    expect(parsed[0].decision).toBe('allow');
    expect(parsed[1].decision).toBe('deny');
    expect(parsed[1].policy).toBe('trust-store');
  });

  test('test-sink injection captures events and bypasses disk', () => {
    const captured: GuardianAuditEvent[] = [];
    setGuardianAuditSinkForTesting((ev) => { captured.push(ev); });
    appendGuardianAudit({ ...baseEvent(), toolId: 'injected' });
    expect(captured.length).toBe(1);
    expect(captured[0]!.toolId).toBe('injected');
    const files = readdirSync(tempRoot);
    expect(files.length).toBe(0);
  });
});
