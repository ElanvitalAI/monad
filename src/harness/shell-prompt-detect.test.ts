// 셸 프롬프트 자동감지(§6(b)) — codex/aider/generic 패턴·꼬리 스캔·보수적 lowRisk.
import { test, expect, describe } from 'bun:test';
import { detectShellPrompt } from './shell-prompt-detect.js';

describe('detectShellPrompt — codex 승인', () => {
  test('Apply patch? (y/n) → confirm·고위험', () => {
    const d = detectShellPrompt('writing files...\nApply patch? (y/n)');
    expect(d?.kind).toBe('confirm');
    expect(d?.source).toBe('codex');
    expect(d?.lowRisk).toBe(false);
  });
  test('Allow command? → confirm·고위험', () => {
    const d = detectShellPrompt('$ rm -rf build\nAllow command? [y/N]');
    expect(d?.kind).toBe('confirm');
    expect(d?.source).toBe('codex');
    expect(d?.lowRisk).toBe(false);
  });
});

describe('detectShellPrompt — aider 인라인 메뉴', () => {
  test('(Y)es/(N)o/(A)ll/(D)on\'t → menu 옵션 추출', () => {
    const d = detectShellPrompt("Add file to the chat? (Y)es/(N)o/(A)ll/(D)on't");
    expect(d?.kind).toBe('menu');
    expect(d?.source).toBe('aider');
    expect(d?.options).toEqual(['es', 'o', 'll', 'on']); // 헤드-매칭(라벨 나머지)
    expect(d?.optionStyle).toBe('text');
  });
});

describe('detectShellPrompt — 번호 메뉴', () => {
  test('1) .. 2) .. → menu·arrows·고위험', () => {
    const text = 'Conflict on foo.ts\n1) Overwrite\n2) Skip\n3) Rename\nChoose:';
    const d = detectShellPrompt(text);
    expect(d?.kind).toBe('menu');
    expect(d?.source).toBe('generic-menu');
    expect(d?.options).toEqual(['Overwrite', 'Skip', 'Rename']);
    expect(d?.optionStyle).toBe('arrows');
    expect(d?.lowRisk).toBe(false);
  });
});

describe('detectShellPrompt — generic y/N', () => {
  test('(yes/no) → confirm', () => {
    const d = detectShellPrompt('Overwrite existing file (yes/no)?');
    expect(d?.kind).toBe('confirm');
    // "Overwrite" = RISKY → generic-yn(고위험)
    expect(d?.source).toBe('generic-yn');
    expect(d?.lowRisk).toBe(false);
  });
  test('무해 continue → benign·저위험', () => {
    const d = detectShellPrompt('Reached end of page. Continue? [Y/n]');
    expect(d?.kind).toBe('confirm');
    expect(d?.lowRisk).toBe(true);
    expect(d?.source).toBe('benign');
  });
});

describe('detectShellPrompt — 꼬리 스캔·오탐 방지', () => {
  test('중간 로그의 (y/n) 은 무시(꼬리만)', () => {
    const text = 'old log: was it ok? (y/n) yes\n'.repeat(3) + 'Build succeeded.\nAll done.';
    expect(detectShellPrompt(text)).toBe(null);
  });
  test('프롬프트 없음 → null', () => {
    expect(detectShellPrompt('just some output\nno prompt here')).toBe(null);
    expect(detectShellPrompt('')).toBe(null);
    expect(detectShellPrompt('   \n  ')).toBe(null);
  });
  test('꼬리 마지막 줄의 프롬프트는 감지', () => {
    const text = 'line1\nline2\nline3\nline4\nline5\nApply patch? (y/n)';
    expect(detectShellPrompt(text)?.source).toBe('codex');
  });
});
