import { describe, expect, test } from 'bun:test';

import { routeFile } from '../src/preview/router.js';

describe('preview router', () => {
  test('directories → folder handler', () => {
    expect(routeFile({ absPath: '/tmp/anything', isDirectory: true })).toBe('folder');
  });

  test('common text/code extensions → text', () => {
    for (const ext of ['md', 'ts', 'tsx', 'json', 'yaml', 'toml', 'sh', 'py']) {
      expect(routeFile({ absPath: `/tmp/a.${ext}`, isDirectory: false })).toBe('text');
    }
  });

  test('special basenames → text', () => {
    for (const base of ['Makefile', 'Dockerfile', 'CLAUDE.md', '.env', '.env.local']) {
      expect(routeFile({ absPath: `/tmp/${base}`, isDirectory: false })).toBe('text');
    }
  });

  test('raster images → image', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heic', 'jxl']) {
      expect(routeFile({ absPath: `/tmp/a.${ext}`, isDirectory: false })).toBe('image');
    }
  });

  test('svg / pdf / video / font / archive route to their names', () => {
    expect(routeFile({ absPath: '/tmp/a.svg', isDirectory: false })).toBe('svg');
    expect(routeFile({ absPath: '/tmp/a.pdf', isDirectory: false })).toBe('pdf');
    expect(routeFile({ absPath: '/tmp/a.mp4', isDirectory: false })).toBe('video');
    expect(routeFile({ absPath: '/tmp/a.ttf', isDirectory: false })).toBe('font');
    expect(routeFile({ absPath: '/tmp/a.zip', isDirectory: false })).toBe('archive');
    expect(routeFile({ absPath: '/tmp/a.tar.gz', isDirectory: false })).toBe('archive');
  });

  test('unknown extension → fallback', () => {
    expect(routeFile({ absPath: '/tmp/a.xyz', isDirectory: false })).toBe('fallback');
    expect(routeFile({ absPath: '/tmp/noext', isDirectory: false })).toBe('fallback');
  });

  test('case-insensitive extension match', () => {
    expect(routeFile({ absPath: '/tmp/A.PDF', isDirectory: false })).toBe('pdf');
    expect(routeFile({ absPath: '/tmp/B.PNG', isDirectory: false })).toBe('image');
  });
});
