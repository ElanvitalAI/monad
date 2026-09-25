import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { debug } from '../debug/log.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localRefGroundingDigest, parseLocalReferenceMetadata } from './ref-grounding.js';

const roots: string[] = [];
function tmpRoot(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'refroot-'));
  roots.push(root);
  for (const n of names) mkdirSync(join(root, n));
  return root;
}
afterEach(() => { while (roots.length) { try { rmSync(roots.pop()!, { recursive: true, force: true }); } catch { /* */ } } });

describe('localRefGroundingDigest — 로컬 ref 실존 디렉터리 그라운딩(결정론)', () => {
  test('골 토큰이 실존 디렉터리면 경로 주입', () => {
    const root = tmpRoot(['lazycodex', 'ouroboros']);
    const out = localRefGroundingDigest('lazycodex 와 ouroboros 조사해줘', [root]);
    expect(out).toContain(join(root, 'lazycodex'));
    expect(out).toContain(join(root, 'ouroboros'));
    expect(out).toContain('로컬');
  });
  test('없는 이름은 무시 → 빈 문자열(false positive 0)', () => {
    const root = tmpRoot(['lazycodex']);
    expect(localRefGroundingDigest('nonexistentref 조사', [root])).toBe('');
  });
  test('길이<4 토큰 무시(흔한 단어 노이즈 차단)', () => {
    const root = tmpRoot(['ab']);
    expect(localRefGroundingDigest('ab 조사', [root])).toBe('');
  });
  test('빈 taskText → 빈 문자열', () => {
    const root = tmpRoot(['lazycodex']);
    expect(localRefGroundingDigest('', [root])).toBe('');
  });
  test('존재하지 않는 root → 무주입(fail-soft)', () => {
    expect(localRefGroundingDigest('lazycodex 조사', ['/no/such/root'])).toBe('');
  });
  test('README 카테고리 표에서 repo·경로·참조 이유를 파싱', () => {
    const metadata = parseLocalReferenceMetadata([
      '### Agent / CLI Harness',
      '| Repo | URL | Path | 참조 이유 |',
      '|---|---|---|---|',
      '| **lazycodex** | https://example.test/lazycodex | `lazycodex/` | 계획 수립 패턴 참조. |',
    ].join('\n'));
    expect(metadata).toEqual([{ category: 'Agent / CLI Harness', repo: 'lazycodex', path: 'lazycodex/', reason: '계획 수립 패턴 참조.' }]);
  });
  test('README 메타를 실존 ref digest에 포함', () => {
    const root = tmpRoot(['lazycodex']);
    writeFileSync(join(root, 'README.md'), [
      '### Agent / CLI Harness',
      '| Repo | URL | Path | 참조 이유 |',
      '|---|---|---|---|',
      '| lazycodex | https://example.test/lazycodex | `lazycodex/` | 계획 수립 패턴 참조. |',
    ].join('\n'));
    const out = localRefGroundingDigest('lazycodex 조사', [root]);
    expect(out).toContain('카테고리: Agent / CLI Harness');
    expect(out).toContain('참조 이유: 계획 수립 패턴 참조.');
  });
  test('매치 수와 README 메타 포함 수를 관측한다', () => {
    const root = tmpRoot(['lazycodex', 'ouroboros']);
    writeFileSync(join(root, 'README.md'), [
      '### Agent / CLI Harness',
      '| Repo | URL | Path | 참조 이유 |',
      '|---|---|---|---|',
      '| lazycodex | https://example.test/lazycodex | `lazycodex/` | 계획 수립 패턴 참조. |',
    ].join('\n'));
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      localRefGroundingDigest('lazycodex 와 ouroboros 조사', [root]);
      expect(log).toHaveBeenCalledWith('ref-grounding', 'digest', { matched: 2, withMeta: 1 });
    } finally {
      log.mockRestore();
    }
  });
  test('README가 없거나 표 형식이 다르면 빈 메타로 fail-soft', () => {
    const root = tmpRoot(['lazycodex']);
    expect(localRefGroundingDigest('lazycodex 조사', [root])).not.toContain('카테고리:');
    writeFileSync(join(root, 'README.md'), '### Agent / CLI Harness\n- lazycodex: 계획 수립 패턴 참조');
    expect(parseLocalReferenceMetadata('### Agent / CLI Harness\n- lazycodex: 계획 수립 패턴 참조')).toEqual([]);
    expect(localRefGroundingDigest('lazycodex 조사', [root])).not.toContain('카테고리:');
  });
});
