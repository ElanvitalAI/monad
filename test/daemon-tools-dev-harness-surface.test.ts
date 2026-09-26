import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toolSurface } from '../src/boot/daemon-tools/index.js';
import { resetElanousConfigDir, setElanousConfigDir } from '../src/elanous-config-dir.js';
import { resetUserConfig } from '../src/user-config.js';

let configDir: string;

function writeConfig(modelSurface?: boolean): void {
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(modelSurface === undefined ? {} : { tools: { runDevHarness: { modelSurface } } }),
  );
  resetUserConfig();
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'daemon-tools-dev-harness-'));
  setElanousConfigDir(configDir);
  resetUserConfig();
});

afterEach(() => {
  resetUserConfig();
  resetElanousConfigDir();
  rmSync(configDir, { recursive: true, force: true });
});

describe('daemon webterm RunDevHarness model surface', () => {
  test('omits RunDevHarness by default and restores it with explicit opt-in', () => {
    writeConfig();
    expect(toolSurface('webterm').specs.map(spec => spec.name)).not.toContain('RunDevHarness');

    writeConfig(true);
    expect(toolSurface('webterm').specs.map(spec => spec.name)).toContain('RunDevHarness');
  });
});
