import { describe, expect, test } from 'bun:test';
import { isInstalledPackagePath } from './installed-package.js';
import { installedCopyRoot } from './leader.js';

describe('installed package paths — 설치기(monadagent) ⊕ npm(@elanvitalai/monad)', () => {
  test('both layouts are installed copies; a checkout is not', () => {
    expect(isInstalledPackagePath('/u/.local/share/monad/current/node_modules/monadagent/bin/monad.mjs')).toBe(true);
    expect(isInstalledPackagePath('/opt/homebrew/lib/node_modules/@elanvitalai/monad/bin/monad.mjs')).toBe(true);
    expect(isInstalledPackagePath('/u/.bun/install/global/node_modules/@elanvitalai/monad')).toBe(true);
    expect(isInstalledPackagePath('/u/source/monad/bin/monad.mjs')).toBe(false);
    expect(isInstalledPackagePath('/x/node_modules/@elanvitalai/monadic/bin/a.mjs')).toBe(false);
  });
  test('installedCopyRoot finds the npm-scoped root', () => {
    expect(installedCopyRoot('/tmp/np/lib/node_modules/@elanvitalai/monad/bin/monad.mjs')).toBe('/tmp/np/lib/node_modules/@elanvitalai/monad');
  });
});
