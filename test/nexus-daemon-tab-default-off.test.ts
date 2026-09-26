// T5.F — daemon 탭 default-OFF (NEXUS SSoT · v6 hard landing 마무리).

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';

import { shouldRegisterDaemon } from '../src/nexus/index.js';

const ORIGINAL_ENV = process.env.ELANOUS_REGISTER_DAEMON;

beforeEach(() => {
  delete process.env.ELANOUS_REGISTER_DAEMON;
});

afterEach(() => {
  if (ORIGINAL_ENV !== undefined) process.env.ELANOUS_REGISTER_DAEMON = ORIGINAL_ENV;
  else delete process.env.ELANOUS_REGISTER_DAEMON;
});

describe('T5.F · shouldRegisterDaemon', () => {
  test('default (no opts, no env) → false (production default-OFF)', () => {
    expect(shouldRegisterDaemon({})).toBe(false);
  });

  test('opts.registerDaemonTab=true → true (test override)', () => {
    expect(shouldRegisterDaemon({ registerDaemonTab: true })).toBe(true);
  });

  test('opts.registerDaemonTab=false → false (explicit opt-out)', () => {
    expect(shouldRegisterDaemon({ registerDaemonTab: false })).toBe(false);
  });

  test('ELANOUS_REGISTER_DAEMON=1 → true', () => {
    process.env.ELANOUS_REGISTER_DAEMON = '1';
    expect(shouldRegisterDaemon({})).toBe(true);
  });

  test('ELANOUS_REGISTER_DAEMON=true → true', () => {
    process.env.ELANOUS_REGISTER_DAEMON = 'true';
    expect(shouldRegisterDaemon({})).toBe(true);
  });

  test('ELANOUS_REGISTER_DAEMON=on → true', () => {
    process.env.ELANOUS_REGISTER_DAEMON = 'on';
    expect(shouldRegisterDaemon({})).toBe(true);
  });

  test('ELANOUS_REGISTER_DAEMON=0 → false', () => {
    process.env.ELANOUS_REGISTER_DAEMON = '0';
    expect(shouldRegisterDaemon({})).toBe(false);
  });

  test('detachForTesting=true → still false (NEXUS default-OFF policy)', () => {
    expect(shouldRegisterDaemon({ detachForTesting: true })).toBe(false);
  });

  test('opts override beats env (registerDaemonTab=false + env=1 → false)', () => {
    process.env.ELANOUS_REGISTER_DAEMON = '1';
    expect(shouldRegisterDaemon({ registerDaemonTab: false })).toBe(false);
  });
});
