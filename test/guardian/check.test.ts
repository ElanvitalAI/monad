import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  runGuardian,
  isGuardianEnabled,
  __resetGuardianForTests,
  summarizeArgs,
} from '../../src/guardian/check.js';
import {
  setGuardianAuditSinkForTesting,
  type GuardianAuditEvent,
} from '../../src/guardian/audit-sink.js';
import type { GuardianContext } from '../../src/guardian/types.js';

const baseCtx = (): GuardianContext => ({
  toolId: 'guardian-test-tool',
  surface: 'skill',
});

const origEnabled = process.env['HARNESS_GUARDIAN_ENABLED'];
const origDisabled = process.env['HARNESS_GUARDIAN_DISABLED'];

let audit: GuardianAuditEvent[] = [];

beforeEach(() => {
  __resetGuardianForTests();
  audit = [];
  setGuardianAuditSinkForTesting((ev) => { audit.push(ev); });
});
afterEach(() => {
  __resetGuardianForTests();
  setGuardianAuditSinkForTesting(null);
  if (origEnabled === undefined) delete process.env['HARNESS_GUARDIAN_ENABLED'];
  else process.env['HARNESS_GUARDIAN_ENABLED'] = origEnabled;
  if (origDisabled === undefined) delete process.env['HARNESS_GUARDIAN_DISABLED'];
  else process.env['HARNESS_GUARDIAN_DISABLED'] = origDisabled;
});

describe('isGuardianEnabled', () => {
  test('default-off when env unset', () => {
    delete process.env['HARNESS_GUARDIAN_ENABLED'];
    delete process.env['HARNESS_GUARDIAN_DISABLED'];
    expect(isGuardianEnabled()).toBe(false);
  });
  test('on when HARNESS_GUARDIAN_ENABLED=1', () => {
    process.env['HARNESS_GUARDIAN_ENABLED'] = '1';
    delete process.env['HARNESS_GUARDIAN_DISABLED'];
    expect(isGuardianEnabled()).toBe(true);
  });
  test('HARNESS_GUARDIAN_DISABLED=1 wins over enabled', () => {
    process.env['HARNESS_GUARDIAN_ENABLED'] = '1';
    process.env['HARNESS_GUARDIAN_DISABLED'] = '1';
    expect(isGuardianEnabled()).toBe(false);
  });
});

describe('runGuardian · plugin-capability policy', () => {
  test('no plugin ctx → allow (native tool bypass)', () => {
    const v = runGuardian({ kind: 'plugin-capability', require: 'write' }, baseCtx());
    expect(v.decision).toBe('allow');
    expect(audit[0]?.decision).toBe('allow');
    expect(audit[0]?.policy).toBeNull();
  });

  test('builtin plugin writing file → allow', () => {
    const ctx: GuardianContext = {
      ...baseCtx(),
      plugin: {
        pluginId: 'p1',
        source: 'builtin',
        capabilities: [],
      },
      argsSummary: { file_path: '/tmp/x' },
    };
    const v = runGuardian({ kind: 'plugin-capability', require: 'write' }, ctx);
    expect(v.decision).toBe('allow');
  });

  test('workspace plugin without trust + fs:write capability → deny', () => {
    const ctx: GuardianContext = {
      ...baseCtx(),
      plugin: {
        pluginId: 'p2',
        source: 'workspace',
        capabilities: [],
        workspaceTrusted: false,
      },
      argsSummary: { path: '/tmp/y' },
    };
    const v = runGuardian({ kind: 'plugin-capability', require: 'write' }, ctx);
    expect(v.decision).toBe('deny');
    expect(v.reasons[0]).toMatch(/not trusted/);
    expect(audit[0]?.decision).toBe('deny');
    expect(audit[0]?.policy).toBe('plugin-capability');
  });
});

describe('runGuardian · trust-store policy', () => {
  test('no plugin ctx → allow', () => {
    const v = runGuardian({ kind: 'trust-store' }, baseCtx());
    expect(v.decision).toBe('allow');
  });

  test('builtin source → allow (bypass store)', () => {
    const v = runGuardian({ kind: 'trust-store' }, {
      ...baseCtx(),
      plugin: { pluginId: 'p1', source: 'builtin', capabilities: [] },
    });
    expect(v.decision).toBe('allow');
  });
});

describe('runGuardian · forward-compat slots', () => {
  test('hitl-delivery short-circuits to allow with one-shot warn', () => {
    const v1 = runGuardian({ kind: 'hitl-delivery' }, baseCtx());
    expect(v1.decision).toBe('allow');
    expect(v1.reasons[0]).toMatch(/not implemented/);
    const v2 = runGuardian({ kind: 'hitl-delivery' }, baseCtx());
    expect(v2.decision).toBe('allow');
  });

  test('mutating-default short-circuits to allow', () => {
    const v = runGuardian({ kind: 'mutating-default' }, baseCtx());
    expect(v.decision).toBe('allow');
  });
});

describe('summarizeArgs', () => {
  test('strings over 200 chars are truncated', () => {
    const long = 'x'.repeat(300);
    const s = summarizeArgs({ content: long });
    expect(typeof s['content']).toBe('string');
    expect((s['content'] as string).length).toBeLessThan(long.length);
    expect(s['content']).toMatch(/…$/);
  });
  test('objects and arrays are replaced with presence markers', () => {
    const s = summarizeArgs({ o: { a: 1 }, a: [1, 2, 3] });
    expect(s['o']).toBe('<object>');
    expect(s['a']).toBe('<array:3>');
  });
  test('numbers, booleans, null pass through', () => {
    const s = summarizeArgs({ n: 1, b: true, z: null });
    expect(s['n']).toBe(1);
    expect(s['b']).toBe(true);
    expect(s['z']).toBeNull();
  });
});
