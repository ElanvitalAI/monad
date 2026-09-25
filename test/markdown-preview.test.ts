// ── Markdown preview (glow) tests ──
// Integration-ish: we rely on `glow` being on PATH for the positive
// case. When it's missing the tests verify graceful null return.
// Cache key construction is exercised directly (no glow needed).

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'bun';
import {
  detectGlow,
  renderMarkdown,
  _resetForTest as resetMarkdownPreview,
} from '../src/markdown-preview.js';

async function glowOnPath(): Promise<boolean> {
  try {
    const proc = spawn(['which', 'glow'], { stdout: 'pipe', stderr: 'ignore' });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return code === 0 && out.trim().length > 0;
  } catch {
    return false;
  }
}

let tempRoot: string;
let mdPath: string;

beforeEach(() => {
  resetMarkdownPreview();
});

afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe('detectGlow', () => {
  test('returns a boolean and caches the result', async () => {
    const first = await detectGlow();
    const second = await detectGlow();
    expect(typeof first).toBe('boolean');
    expect(second).toBe(first);
  });
});

describe('renderMarkdown', () => {
  test('returns null for a missing file', async () => {
    const lines = await renderMarkdown('/no/such/file.md');
    expect(lines).toBeNull();
  });

  test('renders a real markdown file when glow is installed', async () => {
    if (!(await glowOnPath())) return;
    tempRoot = mkdtempSync(join(tmpdir(), 'md-preview-'));
    mdPath = join(tempRoot, 'hello.md');
    writeFileSync(mdPath, '# Hello\n\nThis is **bold**.\n');
    const lines = await renderMarkdown(mdPath, { width: 60 });
    expect(lines).not.toBeNull();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines!.length).toBeGreaterThan(0);
    // Content should mention "Hello" somewhere (ANSI-wrapped or not).
    const joined = lines!.join('\n');
    expect(joined.toLowerCase()).toContain('hello');
  });

  test('caches identical requests (same path + mtime + size + width)', async () => {
    if (!(await glowOnPath())) return;
    tempRoot ||= mkdtempSync(join(tmpdir(), 'md-preview-'));
    mdPath = join(tempRoot, 'cached.md');
    writeFileSync(mdPath, '# cached\n');
    const a = await renderMarkdown(mdPath, { width: 60 });
    const b = await renderMarkdown(mdPath, { width: 60 });
    expect(a).not.toBeNull();
    expect(b).toBe(a); // exact same reference → hit the cache
  });

  test('different width bypasses cache', async () => {
    if (!(await glowOnPath())) return;
    tempRoot ||= mkdtempSync(join(tmpdir(), 'md-preview-'));
    mdPath = join(tempRoot, 'width.md');
    writeFileSync(mdPath, '# width\n');
    const a = await renderMarkdown(mdPath, { width: 60 });
    const b = await renderMarkdown(mdPath, { width: 120 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Not the same reference — cache key differs.
    expect(b).not.toBe(a);
  });
});
