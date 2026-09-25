// MVP M1.5 A.2 — path-guard tests.
//
// Validate the safety primitives shared by Read + Grep:
//   - resolveSafe accepts paths within cwd
//   - rejects ../escape attempts
//   - rejects absolute paths to other roots
//   - rejects sensitive deny-list patterns
//   - rejects symlinks pointing outside cwd
//   - isBinary catches NUL bytes + high non-printable density

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  isBinary,
  resolveSafe,
  SENSITIVE_PATTERNS,
} from '../src/boot/daemon-tools/path-guard.js';
import { ToolSafetyError } from '../src/boot/daemon-tools/types.js';

let cwd: string;
let outsideRoot: string;

beforeEach(() => {
  cwd = mkdtempSync(joinPath(tmpdir(), 'monad-pg-cwd-'));
  outsideRoot = mkdtempSync(joinPath(tmpdir(), 'monad-pg-outside-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

describe('resolveSafe — happy paths', () => {
  test('accepts a relative path inside cwd', () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'hi');
    // Compare via realpath so platform symlinks (macOS /var/folders →
    // /private/var/folders) don't desync the assertion.
    expect(resolveSafe('a.txt', cwd)).toBe(realpathSync(joinPath(cwd, 'a.txt')));
  });

  test('accepts a nested relative path', () => {
    mkdirSync(joinPath(cwd, 'sub'));
    writeFileSync(joinPath(cwd, 'sub', 'b.txt'), 'hi');
    expect(resolveSafe('sub/b.txt', cwd)).toBe(realpathSync(joinPath(cwd, 'sub', 'b.txt')));
  });

  test('accepts the cwd itself', () => {
    expect(resolveSafe('.', cwd)).toBe(realpathSync(cwd));
  });
});

describe('resolveSafe — path-traversal rejection', () => {
  test('rejects ../escape', () => {
    expect(() => resolveSafe('../escape', cwd)).toThrow(ToolSafetyError);
  });

  test('rejects absolute path outside cwd', () => {
    expect(() => resolveSafe(joinPath(outsideRoot, 'x'), cwd)).toThrow(ToolSafetyError);
  });

  test('rejects empty path', () => {
    expect(() => resolveSafe('', cwd)).toThrow(ToolSafetyError);
  });

  test('rejects symlink pointing outside cwd', () => {
    const target = joinPath(outsideRoot, 'secret.txt');
    writeFileSync(target, 'shh');
    const link = joinPath(cwd, 'link.txt');
    symlinkSync(target, link);
    expect(() => resolveSafe('link.txt', cwd)).toThrow(ToolSafetyError);
  });
});

describe('resolveSafe — sensitive deny-list', () => {
  test('rejects .ssh/ paths', () => {
    mkdirSync(joinPath(cwd, '.ssh'));
    writeFileSync(joinPath(cwd, '.ssh', 'id_rsa'), 'fake');
    expect(() => resolveSafe('.ssh/id_rsa', cwd)).toThrow(ToolSafetyError);
  });

  test('rejects .env', () => {
    writeFileSync(joinPath(cwd, '.env'), 'SECRET=1');
    expect(() => resolveSafe('.env', cwd)).toThrow(ToolSafetyError);
  });

  test('rejects .env.production', () => {
    writeFileSync(joinPath(cwd, '.env.production'), 'X=1');
    expect(() => resolveSafe('.env.production', cwd)).toThrow(ToolSafetyError);
  });

  test('rejects a Windows-separated .monad auth.json path through the shared policy', () => {
    const windowsPath = `${cwd.replace(/\//g, '\\')}\\.monad\\auth.json`;
    expect(() => resolveSafe(windowsPath, cwd)).toThrow(ToolSafetyError);
  });

  test('rejects .monad/auth.json provider tokens', () => {
    mkdirSync(joinPath(cwd, '.monad'));
    writeFileSync(joinPath(cwd, '.monad', 'auth.json'), '{"provider":"token"}');
    expect(() => resolveSafe('.monad/auth.json', cwd)).toThrow(ToolSafetyError);
  });

  test('rejects *.pem files', () => {
    writeFileSync(joinPath(cwd, 'cert.pem'), '---');
    expect(() => resolveSafe('cert.pem', cwd)).toThrow(ToolSafetyError);
  });

  test('rejects id_rsa (no extension)', () => {
    writeFileSync(joinPath(cwd, 'id_rsa'), 'fake');
    expect(() => resolveSafe('id_rsa', cwd)).toThrow(ToolSafetyError);
  });

  test('SENSITIVE_PATTERNS list is non-empty', () => {
    expect(SENSITIVE_PATTERNS.length).toBeGreaterThan(5);
  });
});

describe('isBinary', () => {
  test('flags buffer with NUL bytes', () => {
    expect(isBinary(Buffer.from([0x68, 0x69, 0x00, 0x65]))).toBe(true);
  });

  test('clears plain ASCII', () => {
    expect(isBinary(Buffer.from('hello world\nfoo bar\n', 'utf8'))).toBe(false);
  });

  test('clears UTF-8 (Korean)', () => {
    expect(isBinary(Buffer.from('안녕하세요 world', 'utf8'))).toBe(false);
  });

  test('flags high non-printable density', () => {
    const buf = Buffer.alloc(100);
    for (let i = 0; i < 100; i += 1) buf[i] = i % 7 === 0 ? 0x41 : 0x01;
    expect(isBinary(buf)).toBe(true);
  });

  test('returns false for empty buffer', () => {
    expect(isBinary(Buffer.alloc(0))).toBe(false);
  });
});
