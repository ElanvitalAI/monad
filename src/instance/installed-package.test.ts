import { describe, expect, test } from 'bun:test';
import { isInstalledPackagePath } from './installed-package.js';
import { installedCopyRoot } from './leader.js';

describe('installed package paths — 설치기(elanous) ⊕ npm(@elanvitalai/elanous)', () => {
  test('both layouts are installed copies; a checkout is not', () => {
    expect(isInstalledPackagePath('/u/.local/share/elanous/current/node_modules/elanous/bin/elanous.mjs')).toBe(true);
    expect(isInstalledPackagePath('/opt/homebrew/lib/node_modules/@elanvitalai/elanous/bin/elanous.mjs')).toBe(true);
    expect(isInstalledPackagePath('/u/.bun/install/global/node_modules/@elanvitalai/elanous')).toBe(true);
    expect(isInstalledPackagePath('/u/source/elanous/bin/elanous.mjs')).toBe(false);
    expect(isInstalledPackagePath('/x/node_modules/@elanvitalai/elanousic/bin/a.mjs')).toBe(false);
  });
  test('installedCopyRoot finds the npm-scoped root', () => {
    expect(installedCopyRoot('/tmp/np/lib/node_modules/@elanvitalai/elanous/bin/elanous.mjs')).toBe('/tmp/np/lib/node_modules/@elanvitalai/elanous');
  });
});
