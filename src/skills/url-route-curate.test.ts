// P4b — URL route curation (obsidian path extract + process strip).
import { describe, test, expect } from 'bun:test';
import { extractObsidianPath, stripProcessNoise } from './url-route-curate.js';

describe('extractObsidianPath', () => {
  test('labeled 저장 완료', () => {
    const raw = 'Obsidian 저장 완료\n/Users/x/Obsidian/Vault/00. Inbox/20260722_Foo.md\n자막은…';
    expect(extractObsidianPath(raw)).toBe('/Users/x/Obsidian/Vault/00. Inbox/20260722_Foo.md');
  });
  test('저장 위치: inline', () => {
    const raw = '• 저장 위치:\n  /Users/x/Obsidian/Vault/note.md';
    expect(extractObsidianPath(raw)).toBe('/Users/x/Obsidian/Vault/note.md');
  });
  test('bare vault path fallback', () => {
    expect(extractObsidianPath('saved to /Users/x/Obsidian/V/a.md ok')).toBe('/Users/x/Obsidian/V/a.md');
  });
  test('no path → null', () => {
    expect(extractObsidianPath('그냥 요약 텍스트')).toBeNull();
  });
});

describe('stripProcessNoise', () => {
  test('drops tool echoes and progress lines, keeps summary prose', () => {
    const raw = [
      '구현 파이프라인으로 실행하겠습니다.',
      '⏺ Bash(npx tsx /Users/x/.claude/skills/youtube-master/scripts/main.ts "https://youtu.be/x")',
      '  메타데이터 조회...',
      '  라우트: format=brief, target=markdown',
      '  [1/3] Supadata 자막 조회...',
      '  [1/3] Supadata 성공 (5.4s, 14,696자)',
      '',
      '핵심 결론: 이 영상은 브랜드 시스템을 자산화한다.',
      '- 요점 1',
      '- 요점 2',
    ].join('\n');
    const out = stripProcessNoise(raw);
    expect(out).toContain('핵심 결론');
    expect(out).toContain('요점 1');
    expect(out).not.toContain('Bash(');
    expect(out).not.toContain('메타데이터 조회');
    expect(out).not.toContain('[1/3]');
    expect(out).not.toContain('라우트');
  });
});
