/**
 * ⛔⭐⭐ ***셸 인용은 「틀려도 조용하다」*** — 그래서 시험이 없으면 안 된다.
 *
 * 🩸 2026-09-22 — 이 축에서 인용으로 «네 번» 데었다:
 *   ⓐ 따옴표 하나로 명령이 갈렸다(프롬프트를 그대로 넣었다)
 *   ⓑ ssh 는 argv 를 «공백으로 이어» 원격 셸에 넘긴다 ⇒ `['bash','-lc',cmd]` 가 쪼개진다
 *   ⓒ ***인용이 「~」를 죽인다*** — `'~/a'` 는 확장되지 않는다
 *   ⓓ heredoc 이 «두 겹»이면 따옴표가 조용히 벗겨진다
 * 🔑 넷 다 ***exit 0 을 내고 엉뚱한 일을 한다.*** 손으로 한 번 눌러 보고 그 누름을 버렸었다.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shq, shqPath } from './remote.js';

/** ⛔ 인용이 «실제 셸»을 통과해 원문 그대로 나오나 — 문자열 비교가 아니라 «실행»으로 본다. */
function throughShell(quoted: string): string {
  return execFileSync('bash', ['-lc', `printf %s ${quoted}`], { encoding: 'utf8', timeout: 10_000 });
}

describe('shq — 셸 인용', () => {
  const SAMPLES = [
    'plain',
    '공백이 있는 말',
    "작은따옴표's",
    'double"quote',
    '$HOME 은 확장되면 «안 된다»',
    '`backtick`',
    'semi; colon && and || or',
    'star * glob ? question',
    '줄바꿈\n두 줄',
    '역슬래시\\끝',
  ];
  for (const s of SAMPLES) {
    test(`원문 그대로 통과한다: ${JSON.stringify(s).slice(0, 34)}`, () => {
      expect(throughShell(shq(s))).toBe(s);
    });
  }

  test('⛔ $HOME 이 «확장되지 않는다» — 값이 섞이면 명령이 갈린다', () => {
    const out = throughShell(shq('$HOME'));
    expect(out).toBe('$HOME');
    expect(out).not.toContain('/Users');
  });
});

describe('shqPath — ⛔ 인용이 «틸데를 죽인다»', () => {
  test('`~/` 는 «인용 밖»에 두어 확장된다', () => {
    const home = execFileSync('bash', ['-lc', 'printf %s "$HOME"'], { encoding: 'utf8' });
    expect(throughShell(shqPath('~/어떤 폴더/파일.txt')))
      .toBe(`${home}/어떤 폴더/파일.txt`);
  });

  test('절대 경로는 «그대로» — 확장할 것이 없다', () => {
    expect(throughShell(shqPath('/tmp/공백 있는/파일.txt'))).toBe('/tmp/공백 있는/파일.txt');
  });

  test('⛔ `~` 가 «중간»에 있으면 확장하지 않는다 — 진짜 파일 이름일 수 있다', () => {
    expect(throughShell(shqPath('/tmp/a~b/c'))).toBe('/tmp/a~b/c');
  });

  test('⭐ 그 경로로 «실제 파일»을 읽을 수 있다 — 인용이 살아 있다는 최종 증거', () => {
    const d = mkdtempSync(join(tmpdir(), '따옴표 " 폴더-'));
    try {
      const f = join(d, "이름's 파일.txt");
      execFileSync('bash', ['-lc', `printf %s 값 > ${shqPath(f)}`], { timeout: 10_000 });
      expect(readFileSync(f, 'utf8')).toBe('값');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
