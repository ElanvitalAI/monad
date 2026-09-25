import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchEdit } from './edit.js';
import { dispatchWrite } from './write.js';
import { __resetSessionWorkingDir, setSessionCwd } from '../../session/working-dir.js';
import { HARNESS_BOUNDARY_ENV, HARNESS_SPACE_ENV } from '../../harness/harness-space.js';

let root = '';
let boundary = '';
let outside = '';
let savedHarnessSpace: string | undefined;
let savedHarnessBoundary: string | undefined;

beforeEach(() => {
  __resetSessionWorkingDir();
  root = mkdtempSync(join(tmpdir(), 'write-edit-boundary-'));
  boundary = join(root, 'boundary');
  outside = join(root, 'outside');
  mkdirSync(boundary);
  savedHarnessSpace = process.env[HARNESS_SPACE_ENV];
  savedHarnessBoundary = process.env[HARNESS_BOUNDARY_ENV];
  delete process.env[HARNESS_SPACE_ENV];
  delete process.env[HARNESS_BOUNDARY_ENV];
});

afterEach(() => {
  if (savedHarnessSpace === undefined) delete process.env[HARNESS_SPACE_ENV];
  else process.env[HARNESS_SPACE_ENV] = savedHarnessSpace;
  if (savedHarnessBoundary === undefined) delete process.env[HARNESS_BOUNDARY_ENV];
  else process.env[HARNESS_BOUNDARY_ENV] = savedHarnessBoundary;
  __resetSessionWorkingDir();
  rmSync(root, { recursive: true, force: true });
});

describe('Write and Edit isolated write boundaries', () => {
  test('Write rejects an outside new file before creating its parent directory', async () => {
    setSessionCwd(boundary, 'tool', { boundary: true });
    const target = join(outside, 'new-parent', 'new-file.txt');

    await expect(dispatchWrite({ file_path: target, content: 'blocked' })).rejects.toThrow(/boundary rejected.*outside/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(outside, 'new-parent'))).toBe(false);
  });

  test('Edit rejects an outside file before changing its bytes', async () => {
    mkdirSync(outside);
    const target = join(outside, 'existing.txt');
    writeFileSync(target, 'before', 'utf8');
    setSessionCwd(boundary, 'tool', { boundary: true });

    await expect(dispatchEdit({ file_path: target, old_string: 'before', new_string: 'after' })).rejects.toThrow(/boundary rejected.*outside/);
    expect(readFileSync(target, 'utf8')).toBe('before');
  });

  test('Write and Edit preserve successful writes inside an active boundary', async () => {
    setSessionCwd(boundary, 'tool', { boundary: true });
    const target = join(boundary, 'nested', 'inside.txt');

    const write = await dispatchWrite({ file_path: target, content: 'before' });
    const edit = await dispatchEdit({ file_path: target, old_string: 'before', new_string: 'after' });

    expect(write).toMatchObject({ path: target, created: true, bytesWritten: 6 });
    expect(edit).toMatchObject({ filePath: target, replacements: 1 });
    expect(readFileSync(target, 'utf8')).toBe('after');
  });

  test('Write and Edit preserve permissive behavior when the boundary is inactive', async () => {
    setSessionCwd(boundary, 'tool');
    const target = join(outside, 'inactive.txt');

    const write = await dispatchWrite({ file_path: target, content: 'before' });
    const edit = await dispatchEdit({ file_path: target, old_string: 'before', new_string: 'after' });

    expect(write).toMatchObject({ path: target, created: true, bytesWritten: 6 });
    expect(edit).toMatchObject({ filePath: target, replacements: 1 });
    expect(readFileSync(target, 'utf8')).toBe('after');
  });

  test('harness fallback rejects writes outside its boundary when the session boundary is inactive', async () => {
    setSessionCwd(boundary, 'tool');
    process.env[HARNESS_SPACE_ENV] = 'self-implement';
    process.env[HARNESS_BOUNDARY_ENV] = boundary;
    const writeTarget = join(outside, 'fallback-parent', 'write.txt');
    mkdirSync(outside);
    const editTarget = join(outside, 'edit.txt');
    writeFileSync(editTarget, 'before', 'utf8');

    await expect(dispatchWrite({ file_path: writeTarget, content: 'blocked' })).rejects.toThrow(/격리 경계 밖 쓰기 거부/);
    await expect(dispatchEdit({ file_path: editTarget, old_string: 'before', new_string: 'after' })).rejects.toThrow(/격리 경계 밖 쓰기 거부/);
    expect(existsSync(join(outside, 'fallback-parent'))).toBe(false);
    expect(readFileSync(editTarget, 'utf8')).toBe('before');
  });
});
