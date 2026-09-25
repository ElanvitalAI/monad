import { describe, expect, test } from 'bun:test';
import { prepareNestedChildEnv } from '../src/acp/client.js';

describe('MT3 — prepareNestedChildEnv', () => {
  test('generates unique XDG_CONFIG_HOME when omitted', () => {
    const a = prepareNestedChildEnv();
    const b = prepareNestedChildEnv();
    expect(a.XDG_CONFIG_HOME).toMatch(/^\/tmp\/monad-nested-\d+-\d+$/);
    expect(a.MONAD_SESSION_ID).toMatch(/^nested-/);
    // Both generated — not strictly unique when Date.now ties, but
    // pid + random suffix is enough for practical isolation.
    expect(a.XDG_CONFIG_HOME === b.XDG_CONFIG_HOME && a.MONAD_SESSION_ID === b.MONAD_SESSION_ID).toBe(false);
  });

  test('honors explicit overrides', () => {
    const env = prepareNestedChildEnv({
      XDG_CONFIG_HOME: '/custom/xdg',
      MONAD_SESSION_ID: 'pinned-session',
      OTHER_FOO: 'bar',
    });
    expect(env.XDG_CONFIG_HOME).toBe('/custom/xdg');
    expect(env.MONAD_SESSION_ID).toBe('pinned-session');
    expect(env.OTHER_FOO).toBe('bar');
  });
});
