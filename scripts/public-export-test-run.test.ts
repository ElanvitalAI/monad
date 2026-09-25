import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './public-export-test-run.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'export-comparison-fixture-'));
  const files = {
    'release/public-export.yaml': 'include: ["src/**"]\nexclude: []\nreplace: {}\n',
    'docs/private.md': 'present only in private checkout\n',
    'src/private.test.ts': "import { test, expect } from 'bun:test'; import { readFileSync } from 'node:fs'; test('needs private doc', () => { expect(readFileSync('docs/private.md', 'utf8')).toContain('present only'); });\n",
    'src/clean.test.ts': "import { test, expect } from 'bun:test'; test('self contained', () => { expect(1).toBe(1); });\n",
    'src/broken.test.ts': "import { test, expect } from 'bun:test'; test('broken on both sides', () => { expect(1).toBe(2); });\n",
    'docs/not-exported.test.ts': "import { test } from 'bun:test'; test('not exported', () => {});\n",
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), body);
  }
  const init = spawnSync('git', ['init', '-q'], { cwd: root });
  if (init.status !== 0) throw new Error(String(init.stderr));
  const add = spawnSync('git', ['add', '-A'], { cwd: root });
  if (add.status !== 0) throw new Error(String(add.stderr));
  return root;
}

function capture(root: string, args: string[]): { code: number; data: any; errors: string[] } {
  const messages: string[] = [];
  const errors: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...parts: unknown[]) => messages.push(parts.join(' '));
  console.error = (...parts: unknown[]) => errors.push(parts.join(' '));
  try {
    const code = run(['--json', ...args], root);
    return { code, data: messages.length ? JSON.parse(messages.at(-1)!) : undefined, errors };
  } finally { console.log = log; console.error = error; }
}

test('export-only failure is measured against private passing tests; clean test stays clean', () => {
  const root = fixture();
  try {
    const result = capture(root, ['src/private.test.ts', 'src/clean.test.ts']);
    expect(result.code).toBe(1);
    expect(result.data).toEqual({ exportOnly: ['needs private doc'], preexisting: [], notExported: [], exportRan: 2, privateRan: 2 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failing test on both sides is preexisting only', () => {
  const root = fixture();
  try {
    const result = capture(root, ['src/private.test.ts', 'src/broken.test.ts']);
    expect(result.code).toBe(1);
    expect(result.data).toEqual({ exportOnly: ['needs private doc'], preexisting: ['broken on both sides'], notExported: [], exportRan: 2, privateRan: 2 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('list lines are separate argv elements, absent files are counted, and defaults use exported tests', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'selection.txt'), 'src/clean.test.ts\nsrc/broken.test.ts\ndocs/not-exported.test.ts\n');
    const selected = capture(root, ['--files', 'selection.txt']);
    expect(selected.code).toBe(0);
    expect(selected.data).toEqual({ exportOnly: [], preexisting: ['broken on both sides'], notExported: ['docs/not-exported.test.ts'], exportRan: 2, privateRan: 2 });
    const all = capture(root, []);
    expect(all.code).toBe(1);
    expect(all.data.exportRan).toBe(3);
    expect(all.data.notExported).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an explicitly empty --files list is unmeasurable instead of running all exported tests', () => {
  const root = fixture();
  try {
    for (const contents of ['', '  \n\t\r\n']) {
      writeFileSync(join(root, 'selection.txt'), contents);
      const result = capture(root, ['--files', 'selection.txt']);
      expect(result.code).toBe(2);
      expect(result.data).toBeUndefined();
      expect(result.errors.some((line) => line.includes('measurement failed: empty --files selection'))).toBe(true);
    }
    const all = capture(root, []);
    expect(all.code).toBe(1);
    expect(all.data.exportRan).toBe(3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('overlapping path names select exactly the requested test on both sides', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'release/public-export.yaml'), 'include: ["src/**", "archive/src/**"]\nexclude: []\nreplace: {}\n');
    mkdirSync(join(root, 'archive/src'), { recursive: true });
    writeFileSync(join(root, 'src/a.test.ts'), "import { test } from 'bun:test'; test('selected path', () => {});\n");
    writeFileSync(join(root, 'archive/src/a.test.ts'), "import { test } from 'bun:test'; test('overlapping path must not run', () => { throw new Error('unexpected run'); });\n");
    expect(spawnSync('git', ['add', '-A'], { cwd: root }).status).toBe(0);
    const result = capture(root, ['src/a.test.ts']);
    expect(result.code).toBe(0);
    expect(result.data).toEqual({ exportOnly: [], preexisting: [], notExported: [], exportRan: 1, privateRan: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an export-only import error with a summary is unmeasurable, not a clean comparison', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'docs/private-module.ts'), 'export const value = 1;\n');
    writeFileSync(join(root, 'src/import.test.ts'), "import { value } from '../docs/private-module'; import { test, expect } from 'bun:test'; test('private import', () => expect(value).toBe(1));\n");
    expect(spawnSync('git', ['add', 'docs/private-module.ts', 'src/import.test.ts'], { cwd: root }).status).toBe(0);
    const result = capture(root, ['src/import.test.ts', 'src/clean.test.ts']);
    expect(result.code).toBe(2);
    expect(result.data).toBeUndefined();
    expect(result.errors.some((line) => line.includes('measurement failed') && line.includes('Unhandled error between tests'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a runner without a Ran N tests summary is unmeasurable, not zero failures', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'src/crash.test.ts'), 'process.exit(3);\n');
    expect(spawnSync('git', ['add', 'src/crash.test.ts'], { cwd: root }).status).toBe(0);
    const result = capture(root, ['src/crash.test.ts']);
    expect(result.code).toBe(2);
    expect(result.data).toBeUndefined();
    expect(result.errors.some((line) => line.includes('measurement failed'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no runnable exported test is unmeasurable; --keep reports and retains the temporary checkout', () => {
  const root = fixture();
  try {
    expect(capture(root, ['docs/not-exported.test.ts']).code).toBe(2);
    const kept = capture(root, ['--keep', 'src/clean.test.ts']);
    expect(kept.code).toBe(0);
    const path = kept.errors.find((line) => line.startsWith('kept export: '))!.slice('kept export: '.length);
    try {
      expect(existsSync(join(path, 'export', '.git'))).toBe(true);
      expect(lstatSync(join(path, 'export', 'node_modules')).isSymbolicLink()).toBe(true);
      const author = spawnSync('git', ['log', '-1', '--format=%ae'], { cwd: join(path, 'export'), encoding: 'utf8' });
      expect(author.stdout.trim()).toBe('export-test@example.com');
      expect(readFileSync(join(path, 'export', 'src/clean.test.ts'), 'utf8')).toContain('self contained');
    } finally { rmSync(path, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
