import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractGoalDocSections } from './goal-doc/section.js';

export interface SupervisorGoalFillEvidence {
  round: number;
  command: string;
  reviewVerdict: 'pass' | 'warn' | 'fail';
  /** ⭐ 게이트 로그에서 **실제로 읽은** fail 수. 기대값이 아니다(리뷰 must-fix). */
  observedFail: number;
  /** 게이트 로그의 baseline 행 원문 — 독립 검사기가 **이 문자열을 다시 판정**한다. */
  baselineLine: string;
  /** ⭐ **원천 그대로** — 독립 검사기가 writer 의 파싱 결과가 아니라 **로그를 직접** 다시 읽는다. */
  gateLog: string;
}

export interface SupervisorGoalFillInput {
  path: string;
  round: number;
  gate: { passed: boolean; log?: string };
  review?: { verdict: 'pass' | 'warn' | 'fail' };
  /** An external checker, deliberately separate from this writer/parser. */
  independentlyCheck: (document: string, evidence: SupervisorGoalFillEvidence) => Promise<boolean>;
}

export type SupervisorGoalFillResult = 'filled' | 'already-filled' | 'unverifiable' | 'rejected';

const UNVERIFIABLE = 'UNVERIFIABLE';

interface VerifiedGateEvidence {
  command: string;
  observedFail: number;
  baselineLine: string;
}

/**
 * ⛔ **로그가 스스로 모순이면 채우지 않는다.** 종전 판은 ⓐ `[test] PASS` 접두와 명령 모양만 보고
 * ⓑ baseline 행이 **아예 없어도 통과**시켰다 ⇒ `[test] PASS bun test x — 0 pass | 5 fail` 같은
 * 로그로도 *"fail 0"* 을 채울 수 있었다(리뷰 must-fix).
 * ⇒ **fail 수를 실제로 읽고**, baseline 행을 **필수**로 하고, 그 원문을 증거에 실어 독립 검사기가
 *   같은 로그를 **다시** 판정할 수 있게 한다.
 */
function verifiedGateEvidence(gate: SupervisorGoalFillInput['gate']): VerifiedGateEvidence | undefined {
  if (!gate.passed || !gate.log) return undefined;
  const test = gate.log.match(/^\[test\]\s+PASS\s+(.+?)\s*(?:—|$)/m);
  if (!test?.[1]) return undefined;
  const command = test[1].trim();
  if (!/^bun\s+test(?:\s|$)/.test(command)) return undefined;

  // ⭐ 요약 줄에서 **관측된** fail 수를 읽는다. 못 읽으면 판정 불가다(0 으로 가정하지 않는다).
  const testLine = gate.log.split('\n').find((line) => /^\[test\]\s+PASS\b/.test(line));
  const failMatch = testLine?.match(/(\d+)\s+fail\b/);
  if (!failMatch) return undefined;
  const observedFail = Number(failMatch[1]);
  if (observedFail !== 0) return undefined;   // PASS 라고 적혀 있어도 fail 이 있으면 모순이다

  // ⛔ baseline 행은 **필수**다 — 없으면 "깨끗하다" 가 아니라 "안 쟀다" 이다.
  const baseline = gate.log.match(/^\[gate-baseline\]\s+introduced=(\d+),\s*preexisting=(\d+),\s*unknown=(\d+),\s*precondition-unmet=(\d+).*$/m);
  if (!baseline) return undefined;
  if (baseline.slice(1, 5).some((count) => count !== '0')) return undefined;
  return { command, observedFail, baselineLine: baseline[0].trim() };
}

function section(document: string, heading: string): { start: number; end: number; body: string } | undefined {
  return extractGoalDocSections(document, {
    search: 'substring',
    heading,
    endHeading: '\n## ',
  })[0];
}

/**
 * ⛔ **두 절은 서로 다른 것을 말한다** — 같은 문자열을 양쪽에 넣으면 무엇도 검증하지 않는다(리뷰 must-fix).
 *   `불변식` = 이 골이 **지켜야 할 조건** · `판정 신호` = 그것을 **어떻게 관측하나**.
 * ⛔ 그리고 **기대값이 아니라 관측값**을 적는다 — 종전 판은 로그를 안 읽고 `기대 — fail 0` 을 박았다.
 */
function invariantReplacement(evidence: SupervisorGoalFillEvidence): string {
  return `- filled-by: supervisor@round-${evidence.round}\n  조건 — ${evidence.command} 가 실패 없이 끝난다\n  이 라운드에서 관측됨 — fail ${evidence.observedFail}\n  근거 — round-${evidence.round} gate [test] PASS ${evidence.command} · ${evidence.baselineLine}`;
}

function signalReplacement(evidence: SupervisorGoalFillEvidence): string {
  return `- filled-by: supervisor@round-${evidence.round}\n  관측 — \`${evidence.command}\` 요약 줄의 fail 수\n  이번 라운드 관측값 — fail ${evidence.observedFail}\n  근거 — round-${evidence.round} review ${evidence.reviewVerdict} · ${evidence.baselineLine}`;
}

function replaceUnverifiableSlot(body: string, filled: string): string | undefined {
  const slot = /^- UNVERIFIABLE(?:[ \t]*:[^\r\n]*)?[ \t]*$/m;
  return slot.test(body) ? body.replace(slot, filled) : undefined;
}

/**
 * Fill only the two empty authored slots. Gate evidence is accepted only when
 * its logged test command and PASS status agree; baseline contradictions keep
 * the original document queued and byte-identical.
 */
export async function fillUnverifiableGoalSlots(input: SupervisorGoalFillInput): Promise<SupervisorGoalFillResult> {
  const original = readFileSync(input.path, 'utf8');
  const invariant = section(original, '## 불변식');
  const signals = section(original, '## 판정 신호');
  if (!invariant || !signals) return 'unverifiable';
  const invariantNeedsFill = invariant.body.includes(UNVERIFIABLE);
  const signalsNeedFill = signals.body.includes(UNVERIFIABLE);
  if (!invariantNeedsFill && !signalsNeedFill) return 'already-filled';

  const gateEvidence = verifiedGateEvidence(input.gate);
  if (!invariantNeedsFill || !signalsNeedFill || !gateEvidence || !input.review) return 'unverifiable';

  const evidence: SupervisorGoalFillEvidence = {
    round: input.round,
    command: gateEvidence.command,
    reviewVerdict: input.review.verdict,
    observedFail: gateEvidence.observedFail,
    baselineLine: gateEvidence.baselineLine,
    gateLog: input.gate.log ?? '',
  };
  const invariantBody = replaceUnverifiableSlot(invariant.body, invariantReplacement(evidence));
  const signalBody = replaceUnverifiableSlot(signals.body, signalReplacement(evidence));
  if (invariantBody === undefined || signalBody === undefined) return 'unverifiable';
  const candidate = `${original.slice(0, invariant.start)}## 불변식${invariantBody}${original.slice(invariant.end, signals.start)}## 판정 신호${signalBody}${original.slice(signals.end)}`;
  if (!await input.independentlyCheck(candidate, evidence)) return 'rejected';

  const temporary = join(dirname(input.path), `.${Math.random().toString(16).slice(2)}.goal-fill.tmp`);
  try {
    writeFileSync(temporary, candidate, { flag: 'wx' });
    renameSync(temporary, input.path);
    return 'filled';
  } catch (error) {
    try { writeFileSync(input.path, original); } catch { /* preserve original best-effort */ }
    throw error;
  }
}
