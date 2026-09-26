import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { excludeProjectDotElanous } from './project-local-exclude.js';

// 2026-09-26 베어 VM 실측(UX 13): 사용자 저장소가 `?? .elanous/` 로 더러워졌다.
describe('excludeProjectDotElanous — 사용자 저장소의 로컬 무시 목록', () => {
  test('git 저장소면 한 번 넣고, 다시 부르면 그대로 · .gitignore 는 건드리지 않는다', () => {
    const root = mkdtempSync(join(tmpdir(), 'excl-'));
    mkdirSync(join(root, '.git', 'info'), { recursive: true });
    writeFileSync(join(root, '.git', 'info', 'exclude'), '# git ls-files --others --exclude-from=.git/info/exclude');
    expect(excludeProjectDotElanous(root)).toBe('added');
    expect(excludeProjectDotElanous(root)).toBe('present');
    const body = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');
    expect(body.split('\n').filter((l) => l === '/.elanous/')).toHaveLength(1);
    expect(body.startsWith('# git ls-files')).toBe(true);
  });

  test('git 저장소가 아니거나 워크트리(.git 이 파일)면 아무것도 안 한다', () => {
    const plain = mkdtempSync(join(tmpdir(), 'excl-plain-'));
    expect(excludeProjectDotElanous(plain)).toBe('not-a-repo');
    const wt = mkdtempSync(join(tmpdir(), 'excl-wt-'));
    writeFileSync(join(wt, '.git'), 'gitdir: /elsewhere');
    expect(excludeProjectDotElanous(wt)).toBe('not-a-repo');
  });
});
