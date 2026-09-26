import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { PluginHost, USER_DIR, type HostHooks } from './host.js';

const tempDirs: string[] = [];

const hooks: HostHooks = {
  log: () => {},
  hudSet: () => {},
  requestRender: () => {},
  focusPane: () => {},
};

const MINIMAL_PLUGIN = `export default { name: 'mine', version: '1', description: '', initialState: () => ({}), panes: {} };`;

function createDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Layout measured 2026-09-04 under ~/.claude/plugins. */
function writeClaudeManagedLayout(userDir: string): void {
  mkdirSync(join(userDir, 'cache'), { recursive: true });
  mkdirSync(join(userDir, 'data'), { recursive: true });
  mkdirSync(join(userDir, 'marketplaces'), { recursive: true });
  writeFileSync(join(userDir, 'blocklist.json'), '{}');
  writeFileSync(join(userDir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {} }));
  writeFileSync(join(userDir, 'known_marketplaces.json'), '{}');
  writeFileSync(join(userDir, 'plugin-catalog-cache.json'), '{}');
  // Claude installs packages under cache/<marketplace>/<plugin>/<revision>/,
  // not as immediate <name>/plugin.ts children. A nested entry must not be adopted.
  const nested = join(userDir, 'cache', 'claude-plugins-official', 'nested-pkg', '1.0.0');
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(nested, 'plugin.ts'),
    `export default { name: 'nested-pkg', version: '1', description: '', initialState: () => ({}), panes: {} };`,
  );
}

function writeMinePlugin(userDir: string): void {
  const mineDir = join(userDir, 'mine');
  mkdirSync(mineDir, { recursive: true });
  writeFileSync(join(mineDir, 'plugin.ts'), MINIMAL_PLUGIN);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('PluginHost user-dir contract vs Claude package management', () => {
  test('USER_DIR stays at ~/.claude/plugins and the header names that same path', () => {
    expect(USER_DIR).toBe(join(homedir(), '.claude', 'plugins'));
    const src = readFileSync(join(import.meta.dir, 'host.ts'), 'utf8');
    const header = src.split('\n').slice(0, 20).join('\n');
    expect(header).toContain('~/.claude/plugins');
    expect(header).toContain('src/plugins/adapters/claude-package.ts');
    expect(header).toMatch(/package-management directory/);
    expect(header).toContain('<name>/plugin.ts');
    expect(header).toMatch(/currently finds no Claude-managed/);
  });

  test('discover() finds seven repository built-ins including botlab', async () => {
    const userDir = createDir('elanous-host-user-empty-');
    const host = new PluginHost(hooks, null, { userDir });
    await host.discover();
    const builtins = host.list().filter((entry) => entry.source === 'builtin');
    expect(builtins).toHaveLength(7);
    expect(builtins.some((entry) => entry.manifest.id === 'botlab')).toBe(true);
    expect(host.list().filter((entry) => entry.source === 'user')).toHaveLength(0);
  });

  test('Claude management dirs are not adopted as plugins when injected as userDir', async () => {
    const userDir = createDir('elanous-host-claude-layout-');
    writeClaudeManagedLayout(userDir);
    const host = new PluginHost(hooks, null, { userDir });
    await host.discover();

    const names = host.list().map((entry) => entry.manifest.id);
    expect(names).not.toContain('cache');
    expect(names).not.toContain('data');
    expect(names).not.toContain('marketplaces');
    expect(names).not.toContain('nested-pkg');
    expect(host.list().filter((entry) => entry.source === 'user')).toHaveLength(0);
    expect(host.list().filter((entry) => entry.source === 'builtin')).toHaveLength(7);
  });

  test('a sibling mine/plugin.ts following the Elanous convention is discovered', async () => {
    const userDir = createDir('elanous-host-claude-layout-mine-');
    writeClaudeManagedLayout(userDir);
    writeMinePlugin(userDir);
    const host = new PluginHost(hooks, null, { userDir });
    await host.discover();

    const names = host.list().map((entry) => entry.manifest.id);
    expect(names).not.toContain('cache');
    expect(names).not.toContain('data');
    expect(names).not.toContain('marketplaces');
    expect(names).toContain('mine');
    const userPlugins = host.list().filter((entry) => entry.source === 'user');
    expect(userPlugins.map((entry) => entry.manifest.id)).toEqual(['mine']);
    expect(host.list().filter((entry) => entry.source === 'builtin')).toHaveLength(7);
  });
});
