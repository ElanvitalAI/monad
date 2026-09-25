#!/usr/bin/env bun
/**
 * SCQA 채움 감사 — **형식 준수와 내용 검증을 가른다**(SCQA 조항 ⑧).
 *
 * ⛔ 이 스크립트가 존재하는 이유: 2026-08-04 실측에서 골 문서의 S·C·Q·A 네 칸이
 *    **90% 채워져 있었는데** `Question:`/`Answer:` 의 대부분이 `Complication:` 과
 *    **같은 입력(`persistentEvidence`)에서 나온 같은 문장**이었다. 채움률만 보면 건강해 보인다.
 *
 * ⭐ 그래서 이 도구는 「있나」가 아니라 **「다른 것을 말하나」**를 잰다.
 *
 * 사용:
 *   bun run scripts/scqa-fill-audit.ts                 # docs/goals 전수
 *   bun run scripts/scqa-fill-audit.ts --since 2026-08-03
 *   bun run scripts/scqa-fill-audit.ts --json
 *
 * exit: 0 = 감사 완료(판정과 무관) · 1 = 대상 0건(자가 안 돈 것이니 「0%」로 읽지 마라)
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GOAL_DOCUMENT_EXTENSIONS, isGoalDocumentFileName } from '../src/self-implement/goal-document.js';

const GOALS_DIR = join(import.meta.dir, '..', 'docs', 'goals');
/** `C` 를 그대로 옮겼는지 판정할 때 비교하는 앞머리 길이. 짧으면 우연 일치가 섞인다. */
const ECHO_PREFIX_CHARS = 120;

interface Row {
  file: string;
  situation: string;
  complication: string;
  question: string;
  answer: string;
  /** `Q` 가 `C` 의 앞머리를 그대로 담고 있다 = 새 정보 없음 */
  questionEchoesComplication: boolean;
  answerEchoesComplication: boolean;
}

function field(text: string, key: string): string {
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text);
  return m ? (m[1] ?? '').trim() : '';
}

/** `GROUNDED — ` / `NOT-GROUNDED — ` 접두는 상태 표지이지 내용이 아니다. */
function core(value: string): string {
  return value.replace(/^(NOT-)?GROUNDED\s*—\s*/, '').trim();
}

function echoes(child: string, parent: string): boolean {
  const head = core(parent).slice(0, ECHO_PREFIX_CHARS);
  // ⛔ 짧은 앞머리는 우연히 겹친다 — 비교 자체를 포기하고 false 로 둔다(과대 판정 금지).
  if (head.length < 60) return false;
  return core(child).includes(head);
}

function audit(files: readonly string[]): Row[] {
  return files.map((file) => {
    const text = readFileSync(join(GOALS_DIR, file), 'utf8');
    const complication = field(text, 'Complication');
    const question = field(text, 'Question');
    const answer = field(text, 'Answer');
    return {
      file,
      situation: field(text, 'Situation'),
      complication,
      question,
      answer,
      questionEchoesComplication: !!question && echoes(question, complication),
      answerEchoesComplication: !!answer && echoes(answer, complication),
    };
  });
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;

if (!existsSync(GOALS_DIR)) {
  console.error(`scqa-fill-audit: ${GOALS_DIR} 가 없다 — 대상 0건이지 「채움 0%」가 아니다.`);
  process.exit(1);
}

const all = readdirSync(GOALS_DIR).filter(isGoalDocumentFileName);
const files = since ? all.filter((f) => f.includes(since)) : all;
const extensionCounts = Object.fromEntries(GOAL_DOCUMENT_EXTENSIONS.map((extension) => [
  extension,
  files.filter((file) => file.endsWith(extension)).length,
]));

if (files.length === 0) {
  console.error(`scqa-fill-audit: 대상 0건${since ? ` (--since ${since})` : ''} — 자가 안 돈 것이니 「0%」로 읽지 마라.`);
  process.exit(1);
}

const rows = audit(files);
const n = rows.length;
const filled = {
  S: rows.filter((r) => r.situation).length,
  C: rows.filter((r) => r.complication).length,
  Q: rows.filter((r) => r.question).length,
  A: rows.filter((r) => r.answer).length,
};
const qEcho = rows.filter((r) => r.questionEchoesComplication).length;
const aEcho = rows.filter((r) => r.answerEchoesComplication).length;

if (asJson) {
  console.log(JSON.stringify({ total: n, since: since ?? null, extensionCounts, filled, questionEchoesComplication: qEcho, answerEchoesComplication: aEcho }, null, 2));
  process.exit(0);
}

console.log(`분모(골 문서${since ? ` · --since ${since}` : ''}) = ${n} (${GOAL_DOCUMENT_EXTENSIONS.map((extension) => `${extension.slice(1)} ${extensionCounts[extension]}`).join(', ')})`);
console.log('');
console.log('칸        채움          ⛔ C 반복 / 전체    ⛔ C 반복 / «채워진 것»');
console.log(`S         ${String(filled.S).padStart(4)} ${pct(filled.S, n).padStart(7)}   —                 —`);
console.log(`C         ${String(filled.C).padStart(4)} ${pct(filled.C, n).padStart(7)}   —                 —`);
console.log(`Q         ${String(filled.Q).padStart(4)} ${pct(filled.Q, n).padStart(7)}   ${String(qEcho).padStart(4)} ${pct(qEcho, n).padStart(7)}      ${pct(qEcho, filled.Q).padStart(7)}`);
console.log(`A         ${String(filled.A).padStart(4)} ${pct(filled.A, n).padStart(7)}   ${String(aEcho).padStart(4)} ${pct(aEcho, n).padStart(7)}      ${pct(aEcho, filled.A).padStart(7)}`);
console.log('');
console.log('⭐ 읽는 법: 채움률이 높은데 반복률도 높으면 «채운 척»이다(조항 ⑧).');
console.log('   ⛔ 마지막 열이 진짜 자다 — 「전체 대비」는 안 채운 골이 분모를 부풀려 «건강해 보이게» 한다.');
console.log('   Q·A 의 마지막 열이 0 에 가까워야 그 두 칸이 실제로 다른 것을 말한다.');
