#!/usr/bin/env bun
/**
 * `내부 문서 `*`` 의 «표지 형태»를 센다 — ⛔ 다만 «모집단부터» 가른다.
 *
 * 🩸 계기(2026-09-01): 방법론 §4 의 빈도표가 「사람이 제목형을 쓴 비율」로 읽혔는데,
 *    실제로는 «세 모집단»(사람 ask · 하니스 분해 자식 ask · 저작기 산출)이 섞여 있었다.
 *    ⊕ 그 위에 「제목형이 «있나»」와 「인라인을 «안 썼나»」가 또 다른 값이었다 —
 *      08-30 의 「100%」는 «제목형만»이 0 이고 전부 «둘 다 섞음»이었다.
 *
 * ⭐ 템플릿 절 목록을 «손으로 쓰지 않는다» — `REQUIRED_BLOCKS`(goal-author.ts)를 불러 쓴다.
 *    ⛔ 다만 그 목록엔 `## 불변식`·`## 판정 신호` 가 «들어 있어» 그대로 쓰면 사람 ask 도 템플릿으로 읽힌다.
 *    ⇒ 표지와 «겹치지 않는» 절만 템플릿 지문으로 쓴다.
 *
 * 사용:
 *   bun scripts/goal-marker-population.ts --self-check
 *   bun scripts/goal-marker-population.ts [<날짜 접미…>]      기본 = 최근 5일
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_BLOCKS } from '../src/self-implement/goal-author.js';

const MARKER_WORDS = ['불변식', '판정 신호', '경계', '답하지 못하는 것'] as const;
/** ⭐ 템플릿 지문 = REQUIRED_BLOCKS 중 «표지 낱말이 아닌» 절. 손으로 쓰지 않는다. */
export const TEMPLATE_BLOCKS: readonly string[] = REQUIRED_BLOCKS
  .filter(block => !MARKER_WORDS.some(word => block.includes(word)));

const FENCE = /(`{3,})[^\n]*\n([\s\S]*?)\n\1/;
const HEADING = new RegExp(`^## *(${MARKER_WORDS.join('|')})`, 'm');
const INLINE = new RegExp(`^(${MARKER_WORDS.join('|')}) *:`, 'm');

export type Population = 'person' | 'harness-template' | 'unjudgeable';
export type MarkerShape = 'heading-only' | 'both' | 'inline-only' | 'none';

/** 저작기 산출 문서면 「Original ask」 울타리 «안»이 진짜 ask 다. ⛔ 못 읽으면 0 으로 접지 않는다. */
export function askOf(body: string): string | null {
  const at = body.indexOf('Original ask');
  if (at < 0) return body;
  const fence = FENCE.exec(body.slice(at));
  return fence ? fence[2]! : null;
}

export function classify(body: string): { population: Population; shape: MarkerShape | null } {
  const ask = askOf(body);
  if (ask === null) return { population: 'unjudgeable', shape: null };
  if (TEMPLATE_BLOCKS.some(block => new RegExp(`^${block}\\s*$`, 'm').test(ask))) {
    return { population: 'harness-template', shape: null };
  }
  const heading = HEADING.test(ask);
  const inline = INLINE.test(ask);
  const shape: MarkerShape = heading && inline ? 'both' : heading ? 'heading-only' : inline ? 'inline-only' : 'none';
  return { population: 'person', shape };
}

function report(suffixes: readonly string[]): number {
  const root = 'docs/goals';
  const all = readdirSync(root).filter(f => f.endsWith('.md'));
  // ⛔ 파일명 «끝 13자»를 날짜로 쓰면 `README.md`·`…dence-6999.md` 같은 것이 「날짜」가 된다(실측).
  //    ⇒ 날짜 «모양»을 정규식으로 요구한다. 안 맞는 파일은 어느 날짜 칸에도 안 들어간다.
  const DAY = /(\d{4}-\d{2}-\d{2})\.md$/;
  const dated = all.map(f => DAY.exec(f)?.[1]).filter((d): d is string => d !== undefined);
  const days = suffixes.length > 0 ? suffixes : [...new Set(dated)].sort().slice(-5);
  const undated = all.length - dated.length;
  if (undated > 0) console.log(`⚠️ 날짜가 없는 파일 ${undated}개는 어느 칸에도 «안» 들어간다(0 이 아니라 «못 셌음»).`);
  console.log('⭐ 템플릿 지문(REQUIRED_BLOCKS 에서 «가져옴»):', TEMPLATE_BLOCKS.join(' · '));
  console.log('');
  console.log('날짜         총   ①사람  제목형만   섞음  인라인만  표지없음   ②템플릿  판정불가');
  for (const day of days) {
    const files = all.filter(f => f.endsWith(`${day}.md`));
    const counts = { person: 0, 'heading-only': 0, both: 0, 'inline-only': 0, none: 0, template: 0, unjudgeable: 0 };
    for (const file of files) {
      const { population, shape } = classify(readFileSync(join(root, file), 'utf8'));
      if (population === 'unjudgeable') { counts.unjudgeable += 1; continue; }
      if (population === 'harness-template') { counts.template += 1; continue; }
      counts.person += 1;
      counts[shape!] += 1;
    }
    console.log(`${day}  ${String(files.length).padStart(4)}  ${String(counts.person).padStart(5)}  ${String(counts['heading-only']).padStart(7)}  ${String(counts.both).padStart(5)}  ${String(counts['inline-only']).padStart(7)}  ${String(counts.none).padStart(7)}  ${String(counts.template).padStart(8)}  ${String(counts.unjudgeable).padStart(7)}`);
  }
  console.log('');
  console.log('⛔ 「섞음」을 «통과»로 읽지 마라 — §4 실측: 제목형만 98.8% ↔ 섞음 97.8% 가 UNVERIFIABLE 이다.');
  console.log('⛔ 이 자가 «못 보는» 것: 「사람 ask」 안에서도 저자가 «누구인지»는 안 본다. 트랙별 비율은 이 자로 못 낸다.');
  return 0;
}

/** ⭐ 합성 표본 — 각 칸이 «다른 분기»를 탄다. 실물 파일을 관문으로 쓰면 코퍼스가 바뀔 때 깨진다. */
function selfCheck(): number {
  const cases: ReadonlyArray<readonly [string, string, Population, MarkerShape | null]> = [
    ['템플릿', '## PROBLEM\n\n내용\n\n## 불변식\n\n지킬 것', 'harness-template', null],
    ['제목형만', '# 제목\n\n## 불변식\n\n지킬 것', 'person', 'heading-only'],
    ['인라인만', '# 제목\n\n불변식: 지킬 것\n', 'person', 'inline-only'],
    ['둘 다', '# 제목\n\n## 불변식\n\n불변식: 지킬 것\n', 'person', 'both'],
    ['표지 없음', '# 제목\n\n아무 내용\n', 'person', 'none'],
    ['울타리 못 읽음', 'Original ask\n\n울타리가 없다', 'unjudgeable', null],
    ['울타리 «안»을 본다', 'Original ask\n\n````\n불변식: 안쪽\n````\n', 'person', 'inline-only'],
  ];
  let ok = true;
  for (const [name, body, population, shape] of cases) {
    const got = classify(body);
    const pass = got.population === population && got.shape === shape;
    console.log(`${pass ? '✅' : '⛔'} ${name.padEnd(18)} ${got.population}/${got.shape}`);
    if (!pass) ok = false;
  }
  const noMarkerBlocks = !TEMPLATE_BLOCKS.some(b => MARKER_WORDS.some(w => b.includes(w)));
  console.log(`${noMarkerBlocks ? '✅' : '⛔'} 템플릿 지문에 표지 낱말이 «없다»  (${TEMPLATE_BLOCKS.length}개)`);
  if (!ok || !noMarkerBlocks) { console.log('⛔ 자가 고장났다 — 이 자로 낸 수를 믿지 마라.'); return 1; }
  console.log('✅ 자가 산다.');
  return 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-check') ? selfCheck() : report(argv.filter(a => !a.startsWith('--'))));
}
