import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function read(rel: string): string {
  return readFileSync(resolve(import.meta.dir, '..', rel), 'utf8');
}

describe('ui foundation · R7 menu lifecycle source truth', () => {
  test('dashboard wire opts into explicit single-instance policy', () => {
    const src = read('src/context-menu-dashboard-wire.ts');
    expect(src).toContain('singleInstance: true');
  });

  test('context menu host defaults to unique anchor-derived surface ids', () => {
    const src = read('src/ui/context-menu-host.ts');
    expect(src).toContain("opts.surfaceId ?? `${opts.idPrefix ?? 'context-menu'}:${req.anchorRow}:${req.anchorCol}`");
  });

  test('default presenter maps singleInstance to the stable context-menu surface id', () => {
    const src = read('src/ui/context-menu-presenter.ts');
    expect(src).toContain('opts?.singleInstance');
    expect(src).toContain("deps.singleInstanceSurfaceId ?? 'context-menu'");
  });
});
