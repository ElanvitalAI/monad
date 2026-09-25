// Arc H follow-up — intent-miss telemetry.
//
// Verifies:
//   • env off → recordIntentMiss is a no-op (no counts accumulate)
//   • no lastActive snapshot → no-op (fail safe on cold startup)
//   • scope 'always' / 'coding' → never miss
//   • scope in active set → hit (no miss)
//   • scope not in active set → miss (total + byTool increments)
//   • reset clears counts + cache
//   • getIntentMissCounts returns a fresh snapshot (mutation safe)
//
// See 내부 문서 `PLAN-harness-arc-h-follow-up`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  recordIntentMiss,
  getIntentMissCounts,
  resetIntentMissCounts,
  setLastActiveScopes,
  getLastActiveScopes,
  __resetIntentMissForTests,
} from '../src/tool-hints/intent-miss.js';

const ENV_FLAG = 'HARNESS_TOOL_DISCIPLINE_ENABLED';
const origEnabled = process.env[ENV_FLAG];

beforeEach(() => {
  __resetIntentMissForTests();
  delete process.env[ENV_FLAG];
});
afterEach(() => {
  __resetIntentMissForTests();
  if (origEnabled === undefined) delete process.env[ENV_FLAG];
  else process.env[ENV_FLAG] = origEnabled;
});

describe('recordIntentMiss — env gate', () => {
  test('env off: no-op even when scope not active', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    expect(getIntentMissCounts()).toEqual({});
  });

  test('env=0 treated as off', () => {
    process.env[ENV_FLAG] = '0';
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    expect(getIntentMissCounts()).toEqual({});
  });
});

describe('recordIntentMiss — env on · fail safe', () => {
  beforeEach(() => { process.env[ENV_FLAG] = '1'; });

  test('no lastActive snapshot → no-op', () => {
    // intentionally skip setLastActiveScopes
    expect(getLastActiveScopes()).toBeNull();
    recordIntentMiss('iphone_notify', 'ops-fleet');
    expect(getIntentMissCounts()).toEqual({});
  });

  test("scope 'always' never misses", () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('some_tool', 'always');
    expect(getIntentMissCounts()).toEqual({});
  });

  test("scope 'coding' never misses", () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('read', 'coding');
    expect(getIntentMissCounts()).toEqual({});
  });
});

describe('recordIntentMiss — env on · core behavior', () => {
  beforeEach(() => { process.env[ENV_FLAG] = '1'; });

  test('scope in active set → hit, no miss recorded', () => {
    setLastActiveScopes(new Set(['coding', 'ops-fleet']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    expect(getIntentMissCounts()).toEqual({});
  });

  test('scope not in active set → miss recorded, byTool tracks', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    const counts = getIntentMissCounts();
    expect(counts['ops-fleet']).toEqual({ total: 1, byTool: { iphone_notify: 1 } });
  });

  test('repeat same tool increments byTool', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    recordIntentMiss('iphone_notify', 'ops-fleet');
    recordIntentMiss('iphone_notify', 'ops-fleet');
    const counts = getIntentMissCounts();
    expect(counts['ops-fleet']!.total).toBe(3);
    expect(counts['ops-fleet']!.byTool['iphone_notify']).toBe(3);
  });

  test('different tools same scope accumulate', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    recordIntentMiss('budget_status', 'ops-fleet');
    recordIntentMiss('iphone_notify', 'ops-fleet');
    const c = getIntentMissCounts()['ops-fleet']!;
    expect(c.total).toBe(3);
    expect(c.byTool['iphone_notify']).toBe(2);
    expect(c.byTool['budget_status']).toBe(1);
  });

  test('different scopes isolated', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    recordIntentMiss('window_create', 'ops-ui');
    recordIntentMiss('browser_open', 'browse');
    const c = getIntentMissCounts();
    expect(c['ops-fleet']!.total).toBe(1);
    expect(c['ops-ui']!.total).toBe(1);
    expect(c['browse']!.total).toBe(1);
  });
});

describe('reset + snapshot isolation', () => {
  beforeEach(() => { process.env[ENV_FLAG] = '1'; });

  test('resetIntentMissCounts clears counts but preserves lastActive', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    expect(Object.keys(getIntentMissCounts()).length).toBe(1);
    resetIntentMissCounts();
    expect(getIntentMissCounts()).toEqual({});
    expect(getLastActiveScopes()).not.toBeNull();
  });

  test('__resetIntentMissForTests clears both counts AND lastActive', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    __resetIntentMissForTests();
    expect(getIntentMissCounts()).toEqual({});
    expect(getLastActiveScopes()).toBeNull();
  });

  test('getIntentMissCounts returns a fresh copy — mutating does not leak', () => {
    setLastActiveScopes(new Set(['coding']));
    recordIntentMiss('iphone_notify', 'ops-fleet');
    const snapshot = getIntentMissCounts();
    snapshot['ops-fleet']!.total = 999;
    snapshot['ops-fleet']!.byTool['bogus'] = 42;
    const fresh = getIntentMissCounts();
    expect(fresh['ops-fleet']!.total).toBe(1);
    expect(fresh['ops-fleet']!.byTool['bogus']).toBeUndefined();
  });
});
