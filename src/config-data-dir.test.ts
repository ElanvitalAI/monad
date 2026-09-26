import { describe, expect, test } from 'bun:test';
import { resolveDataDir } from './config.js';

// 🆕 2026-09-24 — 운영 코드(설치본·리더 트리)의 가변 상태는 코드 옆이 아니라 ~/.elanous/data.
describe('resolveDataDir', () => {
  const home = '/home/u';
  const noGit = () => false;
  const withGit = () => true;
  test('installed copy (node_modules/elanous, no git above) → ~/.elanous/data', () => {
    expect(resolveDataDir('/home/u/.local/share/elanous/versions/1.0.0-abc/node_modules/elanous', { env: {}, home, leaderTree: () => null, hasGit: noGit }))
      .toBe('/home/u/.elanous/data');
  });
  test('leader tree → ~/.elanous/data', () => {
    expect(resolveDataDir('/src/pilot', { env: {}, home, leaderTree: () => '/src/pilot', hasGit: withGit })).toBe('/home/u/.elanous/data');
  });
  test('any other worktree keeps its own data/', () => {
    expect(resolveDataDir('/tmp/wt', { env: {}, home, leaderTree: () => '/src/pilot', hasGit: withGit })).toBe('/tmp/wt/data');
    expect(resolveDataDir('/tmp/wt', { env: {}, home, leaderTree: () => null, hasGit: withGit })).toBe('/tmp/wt/data');
  });
  test('node_modules/elanous inside a git checkout is not an install', () => {
    expect(resolveDataDir('/src/app/node_modules/elanous', { env: {}, home, leaderTree: () => null, hasGit: withGit })).toBe('/src/app/node_modules/elanous/data');
  });
  test('ELANOUS_DATA_DIR wins', () => {
    expect(resolveDataDir('/src/pilot', { env: { ELANOUS_DATA_DIR: '/x/data' }, home, leaderTree: () => '/src/pilot', hasGit: withGit })).toBe('/x/data');
  });
});
