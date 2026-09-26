import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexLoginSuccessMessage } from '../src/index.js';
import { codexFreshLoginAuthLabel } from '../src/codex/setup.js';
import { authStorePath } from '../src/oauth/store.js';

const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const originalHome = process.env.HOME;

afterEach(() => {
  if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe('Codex fresh-login token path messages', () => {
  test.each([
    ['without XDG_CONFIG_HOME', undefined, '.elanous/auth.json'],
    ['with XDG_CONFIG_HOME', 'xdg-config', 'xdg-config/elanous/auth.json'],
  ])('%s reports authStorePath()', async (_name, xdgDir, expectedSuffix) => {
    const root = mkdtempSync(join(tmpdir(), 'cli-login-message-env-'));
    try {
      process.env.HOME = root;
      if (xdgDir === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = join(root, xdgDir);

      const expected = authStorePath();
      expect(expected).toEndWith(expectedSuffix);
      expect(codexLoginSuccessMessage()).toContain(`Tokens at ${expected}`);
      expect(codexFreshLoginAuthLabel()).toContain(`tokens at ${expected}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
