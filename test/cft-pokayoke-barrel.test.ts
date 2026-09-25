// ── PFC-S3.3 P3: barrel exports ──

import { describe, expect, test } from 'bun:test';
import * as cft from '../src/cft/index';

describe('src/cft/index.ts barrel — Poka-Yoke surface', () => {
  test('exports validate + guardWrite + parseShallowFrontmatter', () => {
    expect(typeof cft.validate).toBe('function');
    expect(typeof cft.guardWrite).toBe('function');
    expect(typeof cft.parseShallowFrontmatter).toBe('function');
  });

  test('exports are wired to real implementations', () => {
    const r = cft.validate('abc', { kind: 'string', min: 1 });
    expect(r.ok).toBe(true);
  });
});
