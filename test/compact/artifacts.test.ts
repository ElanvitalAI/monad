import { afterEach, describe, expect, test } from 'bun:test';
import { promises as fsp, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendCompactToMemory } from '../../src/compact/index.js';

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'compact-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('appendCompactToMemory', () => {
  test('creates MEMORY.md when absent', async () => {
    const d = mkdir();
    const r = await appendCompactToMemory('summary body here', { cwd: d });
    expect(r.path).toBe(join(d, 'MEMORY.md'));
    const text = await fsp.readFile(r.path, 'utf-8');
    expect(text).toContain('### Recent work');
    expect(text).toContain('summary body here');
    expect(text).toMatch(/\*\*\d{4}-\d{2}-\d{2}\*\*/);
  });

  test('preserves pre-existing content outside Recent work section', async () => {
    const d = mkdir();
    const existing = '# Project memory\n\nSome bullet\n';
    writeFileSync(join(d, 'MEMORY.md'), existing);
    await appendCompactToMemory('first summary', { cwd: d });
    const text = await fsp.readFile(join(d, 'MEMORY.md'), 'utf-8');
    expect(text).toContain('# Project memory');
    expect(text).toContain('Some bullet');
    expect(text).toContain('first summary');
  });

  test('prepends newer entries at the top of existing Recent work', async () => {
    const d = mkdir();
    await appendCompactToMemory('older entry', { cwd: d });
    await new Promise((r) => setTimeout(r, 5));
    await appendCompactToMemory('newer entry', { cwd: d });
    const text = await fsp.readFile(join(d, 'MEMORY.md'), 'utf-8');
    const olderIdx = text.indexOf('older entry');
    const newerIdx = text.indexOf('newer entry');
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  test('returns { appended: true } for the happy path', async () => {
    const d = mkdir();
    const r = await appendCompactToMemory('ok', { cwd: d });
    expect(r.appended).toBe(true);
  });
});
