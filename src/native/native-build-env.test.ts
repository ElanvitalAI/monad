import { describe, expect, test } from 'bun:test';
import { readFileSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { nativeBuildEnv, nativeBuildShimDir } from './native-build-env.js';

// 🆕 2026-09-24 빈 Ubuntu VM — apt node 가 있으면 node-pty 가 bun 과 안 맞게 빌드돼 불러오는 순간 panic.
describe('native build shim', () => {
  test('node points at bun and node-gyp runs the latest node-gyp through bun, first on PATH', () => {
    const dir = nativeBuildShimDir('/opt/bun/bin/bun');
    try {
      expect(readlinkSync(join(dir, 'node'))).toBe('/opt/bun/bin/bun');
      expect(readFileSync(join(dir, 'node-gyp'), 'utf8')).toContain('"/opt/bun/bin/bun" x node-gyp@latest "$@"');
      expect(nativeBuildEnv({ PATH: '/usr/bin' }, dir).PATH).toBe(`${dir}:/usr/bin`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
