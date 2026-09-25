// Step 5 PR δ — launchd plist generation smoke.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { generateLaunchdPlist, installLaunchdPlist, LAUNCHD_PLIST_LABEL } from '../src/auth/launchd.js';

let tmpDir = '';

beforeEach(() => {
  tmpDir = mkdtempSync(joinPath(tmpdir(), 'monad-launchd-'));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateLaunchdPlist', () => {
  test('produces XML with monad ctl serve', () => {
    const body = generateLaunchdPlist({ monadBinaryPath: '/bin/monad', port: 31413 });
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain(`<string>${LAUNCHD_PLIST_LABEL}</string>`);
    expect(body).toContain('<string>/bin/monad</string>');
    expect(body).toContain('<string>ctl</string>');
    expect(body).toContain('<string>serve</string>');
    expect(body).toContain('<string>31413</string>');
  });

  test('honors custom port + host', () => {
    const body = generateLaunchdPlist({
      monadBinaryPath: '/bin/monad',
      port: 8888,
      hostname: '0.0.0.0',
    });
    expect(body).toContain('<string>8888</string>');
    expect(body).toContain('<string>0.0.0.0</string>');
  });

  test('KeepAlive + RunAtLoad both true', () => {
    const body = generateLaunchdPlist();
    expect(body).toContain('<key>KeepAlive</key>');
    expect(body).toContain('<key>RunAtLoad</key>');
  });
});

describe('installLaunchdPlist', () => {
  test('writes the plist + returns load command', () => {
    if (process.platform !== 'darwin') {
      // Skip cleanly on non-mac CI — the install path throws by design.
      return;
    }
    const r = installLaunchdPlist({
      monadBinaryPath: '/bin/monad',
      launchAgentsDirOverride: tmpDir,
      port: 31413,
    });
    expect(r.plistPath).toBe(joinPath(tmpDir, `${LAUNCHD_PLIST_LABEL}.plist`));
    expect(existsSync(r.plistPath)).toBe(true);
    expect(r.loadCommand).toBe(`launchctl load ${r.plistPath}`);
    expect(r.unloadCommand).toBe(`launchctl unload ${r.plistPath}`);

    const fileBody = readFileSync(r.plistPath, 'utf-8');
    expect(fileBody).toBe(r.plistBody);
  });

  test.skipIf(process.platform === 'darwin')('throws on non-darwin platforms', () => {
    expect(() => installLaunchdPlist({ launchAgentsDirOverride: tmpDir })).toThrow(/macOS only/);
  });
});
