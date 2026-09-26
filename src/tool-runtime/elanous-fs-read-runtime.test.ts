// PLAN-codex-app-server-hermes-parity §5 Phase H1·5e test —
// dispatchElanousFsRead branches (path required · clamp escape · dir
// rejection · text content · binary base64 · truncation flag · mime
// detection). Isolated tmp dir + rootResolver override.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FsRootKind } from '../acp/fs-roots.js';
import {
  dispatchElanousFsRead,
  elanousFsReadRuntime,
  buildElanousFsReadTool,
} from './elanous-fs-read-runtime.js';

let workdir: string;
let resolver: (kind: FsRootKind) => string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'elanous-fs-read-test-'));
  resolver = (_kind) => workdir;
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('dispatchElanousFsRead · input validation', () => {
  test('missing path → path-required error', async () => {
    const r = await dispatchElanousFsRead({}, { rootResolver: resolver });
    expect(r.error).toBe('path-required');
  });

  test('empty path → path-required error', async () => {
    const r = await dispatchElanousFsRead({ path: '' }, { rootResolver: resolver });
    expect(r.error).toBe('path-required');
  });
});

describe('dispatchElanousFsRead · clamp', () => {
  test('escape attempt → path-escapes-root error', async () => {
    const r = await dispatchElanousFsRead(
      { path: join(workdir, '..', '..', 'elsewhere.txt') },
      { rootResolver: resolver },
    );
    expect(r.error).toBe('path-escapes-root');
  });

  test('directory target → path-is-directory error', async () => {
    mkdirSync(join(workdir, 'subdir'));
    const r = await dispatchElanousFsRead(
      { path: join(workdir, 'subdir') },
      { rootResolver: resolver },
    );
    expect(r.error).toBe('path-is-directory');
  });

  test('missing file → ENOENT-flavored error', async () => {
    const r = await dispatchElanousFsRead(
      { path: join(workdir, 'no-such-file.txt') },
      { rootResolver: resolver },
    );
    expect(r.error).toContain('ENOENT');
  });

  test('resolver throw surfaces error', async () => {
    const r = await dispatchElanousFsRead(
      { root: 'obsidian', path: 'x.md' },
      {
        rootResolver: (k) => {
          if (k === 'obsidian') throw new Error('obsidian-vault-unavailable');
          return workdir;
        },
      },
    );
    expect(r.error).toBe('obsidian-vault-unavailable');
  });
});

describe('dispatchElanousFsRead · text content', () => {
  test('returns content (utf8) for .md', async () => {
    const p = join(workdir, 'note.md');
    writeFileSync(p, '# Heading\n\nThis is a note.');
    const r = await dispatchElanousFsRead({ path: p }, { rootResolver: resolver });
    expect(r.content).toBe('# Heading\n\nThis is a note.');
    expect(r.bytes).toBeUndefined();
    expect(r.mime).toContain('text');
    expect(r.size).toBe(26);
    expect(r.truncated).toBeUndefined();
  });

  test('returns content (utf8) for .json', async () => {
    const p = join(workdir, 'data.json');
    writeFileSync(p, '{"a":1}');
    const r = await dispatchElanousFsRead({ path: p }, { rootResolver: resolver });
    expect(r.content).toBe('{"a":1}');
  });

  test('truncates text content at maxBytes + flags truncated', async () => {
    const p = join(workdir, 'big.txt');
    writeFileSync(p, 'x'.repeat(1024));
    const r = await dispatchElanousFsRead(
      { path: p, maxBytes: 100 },
      { rootResolver: resolver },
    );
    expect(r.content?.length).toBe(100);
    expect(r.truncated).toBe(true);
    expect(r.size).toBe(1024);
    expect(r.output).toContain('first 100');
  });
});

describe('dispatchElanousFsRead · binary content', () => {
  test('returns bytes (base64) for .png', async () => {
    const p = join(workdir, 'pixel.png');
    // 8-byte PNG signature + nothing else (good enough for mime branch test)
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(p, raw);
    const r = await dispatchElanousFsRead({ path: p }, { rootResolver: resolver });
    expect(r.bytes).toBe(raw.toString('base64'));
    expect(r.content).toBeUndefined();
    expect(r.mime).toContain('image');
    expect(r.size).toBe(8);
  });
});

describe('dispatchElanousFsRead · maxBytes bounds', () => {
  test('honors caller-provided maxBytes', async () => {
    const p = join(workdir, 'data.txt');
    writeFileSync(p, 'abcdefghij');
    const r = await dispatchElanousFsRead(
      { path: p, maxBytes: 3 },
      { rootResolver: resolver },
    );
    expect(r.content).toBe('abc');
    expect(r.truncated).toBe(true);
  });

  test('rejects maxBytes > 8MB ceiling (falls back to default 256KB)', async () => {
    const p = join(workdir, 'small.txt');
    writeFileSync(p, 'hi');
    const r = await dispatchElanousFsRead(
      { path: p, maxBytes: 100 * 1024 * 1024 },
      { rootResolver: resolver },
    );
    expect(r.content).toBe('hi');
    expect(r.truncated).toBeUndefined();
  });
});

describe('elanousFsReadRuntime · ToolRuntime interface', () => {
  test('exposes id and spec', () => {
    expect(elanousFsReadRuntime.id).toBe('elanous_fs_read');
    expect(elanousFsReadRuntime.spec.name).toBe('elanous_fs_read');
  });

  test('buildElanousFsReadTool requires path in spec', () => {
    const spec = buildElanousFsReadTool();
    const params = spec.parameters as { required?: string[] };
    expect(params.required).toContain('path');
  });
});
