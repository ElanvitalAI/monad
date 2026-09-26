// PR 근거 아티팩트 작성기 (2026-09-17) — self-implement PR 준비 경로의 «일곱 축» 관문.
//
// 왜 있나: `orchestrator.ts` 의 `prBody` 는 «주어진 것만» 잇는다. 모든 인자가 optional 이라
// 비면 그 절이 조용히 «사라지고», 그래서 「원장도 위험도 대안도 없는 본문」이 정상 산출과
// 구별되지 않는다. 📏 실측 대조(2026-09-17 · `gh pr view`)로 그 갈림이 값으로 찍혔다:
//
//   #18879 (self-implement 산출) — 골 ✅ · 계획 ❌ · 원장 ❌ · 비판 ✅ · 시험 ✅ · 위험 ❌ · 대안 ~
//   #18890 (다른 경로 산출)      — 골 ❌ · 계획 ~ · 원장 ❌ · 비판 ❌ · 시험 ✅ · 위험 ❌ · 대안 ❌
//
// ⇒ 일곱 축 중 「원장」과 「위험」은 «둘 다» 0이었다. 이 모듈이 그 일곱을 이름으로 세고,
//   비면 «거절»하며(빈 절을 만들지 않는다), 다 채워지면 일곱 절을 «전부» 싣는다.
//
// ⛔ 순수 모듈이다 — stdout 에 쓰지 않고 로그 스토어·파일시스템·시계를 안 건드린다.
//   관측과 차단 판정은 호출자(`orchestrator.ts`)가 자기 관문에서 한다.

/** PR 본문이 실어야 하는 근거 축. 순서가 곧 렌더 순서다. */
export type PrEvidenceAxis =
  | 'goal'
  | 'plan'
  | 'ledger'
  | 'critique'
  | 'tests'
  | 'risks'
  | 'alternatives';

/** ⛔ 렌더 순서와 판정 순서를 «한 값»으로 둔다 — 둘을 따로 적으면 곧 갈린다. */
export const PR_EVIDENCE_AXES: readonly PrEvidenceAxis[] = [
  'goal', 'plan', 'ledger', 'critique', 'tests', 'risks', 'alternatives',
];

/** 축마다의 사람용 제목. 본문 절 제목이자 거절 메시지의 이름이다. */
const AXIS_TITLES: Readonly<Record<PrEvidenceAxis, string>> = {
  goal: '골 — 무엇을 요구했나',
  plan: '계획 — 어떤 순서로 갔나',
  ledger: '원장 — 이 런이 실제로 걸은 길',
  critique: '비판 — 내부 리뷰가 무엇을 지적했나',
  tests: '시험 — 무엇을 돌려 무엇이 나왔나',
  risks: '위험 — 이 착지가 무엇을 흔드나',
  alternatives: '대안 — 안 간 길과 그 이유',
};

/**
 * 「채운 척」하는 문면들. ⛔ 빈 칸에 이것을 써 넣으면 일곱 축이 «전부 초록»이 되고 자가 사라진다.
 * 그래서 공백과 «같은 값»으로 본다 — 없는 것은 없다고 말한다.
 */
const PLACEHOLDER_TOKENS: readonly string[] = [
  '', '-', '--', 'n/a', 'na', 'none', 'tbd', 'todo', '?', '(없음)', '없음', '(미정)', '미정',
  '(요약 없음)', '(summary unavailable)', 'unknown', '(unknown)',
];

function isBlank(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return PLACEHOLDER_TOKENS.includes(normalized);
}

/** 공백·플레이스홀더를 걷어낸 목록. 남은 것이 0이면 그 축은 «없다». */
function meaningful(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter((v) => !isBlank(v));
}

export interface PrEvidenceGoal {
  /** 저장소 상대 골 파일 경로. ⛔ 「모른다」를 경로로 꾸미지 않는다 — 없으면 생략한다. */
  readonly goalFile?: string;
  /** 골이 요구한 것. 이 축의 «필수» 값이다. */
  readonly objective: string;
  /** 골이 선언한 판정 신호 문면(있으면 싣는다). */
  readonly decisionSignals?: readonly string[];
}

export interface PrEvidencePlan {
  /** 실제로 밟은 단계. 하나라도 있어야 이 축이 선다. */
  readonly steps: readonly string[];
  /** 감독이 수용 기준을 완화했다면 그 사실. */
  readonly revision?: {
    readonly reason: string;
    readonly target?: string;
    readonly from?: string;
    readonly to?: string;
  };
}

export interface PrEvidenceLedger {
  /** 이 런의 식별자. ⛔ 이것이 없으면 본문은 「어느 런이 냈는지」를 영영 못 말한다. */
  readonly runId: string;
  /** 원장이 기록한 종료 단계(`pr-opened` 등). */
  readonly stage: string;
  /** 파이프라인 노드(`open-pr` 등). */
  readonly node?: string;
  readonly branch?: string;
  /** rework 라운드 수. 1 이상이어야 「돌았다」가 성립한다. */
  readonly rounds: number;
  /** 병합 판정 이유(`review-clean-armed` 등). */
  readonly mergeReason?: string;
  /** 구현 자식의 두뇌. */
  readonly provider?: string;
}

export interface PrEvidenceCritique {
  /** 리뷰가 «실제로» 돌았나. ⛔ 거짓이면 이 축은 없다 — 침묵을 「clean」으로 읽지 않는다. */
  readonly reviewed: boolean;
  readonly verdict: string;
  readonly summary: string;
  readonly mustFix?: readonly string[];
  readonly shouldFix?: readonly string[];
}

export interface PrEvidenceTestRun {
  readonly command: string;
  readonly passed?: number;
  readonly failed?: number;
  /** 한 줄 결과 문면(러너 요약 줄 등). */
  readonly detail?: string;
}

export interface PrEvidenceTests {
  /** 돌린 명령들. 하나라도 있어야 이 축이 선다. */
  readonly runs: readonly PrEvidenceTestRun[];
  readonly typecheck?: { readonly passed: boolean; readonly detail?: string };
  /** 게이트 로그 원문(상한은 렌더에서 건다). */
  readonly gateLog?: string;
}

export interface PrEvidenceAlternative {
  /** 고려했던 길. */
  readonly option: string;
  /** ⛔ 「왜 안 갔나」가 없으면 대안이 아니라 목록이다. 둘 다 있어야 센다. */
  readonly rejectedBecause: string;
}

export interface PrEvidenceInput {
  readonly goal?: PrEvidenceGoal;
  readonly plan?: PrEvidencePlan;
  readonly ledger?: PrEvidenceLedger;
  readonly critique?: PrEvidenceCritique;
  readonly tests?: PrEvidenceTests;
  /** 이 착지가 흔드는 것. 문면 하나 이상. */
  readonly risks?: readonly string[];
  readonly alternatives?: readonly PrEvidenceAlternative[];
}

export type PrEvidenceArtifactResult =
  | {
      readonly ok: true;
      /** 렌더된 근거 절 전체. 호출자가 PR 본문에 그대로 잇는다. */
      readonly body: string;
      /** 실린 축. 항상 `PR_EVIDENCE_AXES` 전부다. */
      readonly axes: readonly PrEvidenceAxis[];
      readonly chars: number;
    }
  | {
      readonly ok: false;
      /** 비어 있는 필수 축의 «이름». ⛔ 수만 내지 않는다 — 이름이 있어야 고칠 수 있다. */
      readonly missing: readonly PrEvidenceAxis[];
      /** 사람이 읽는 한 줄. 축 이름과 제목을 같이 댄다. */
      readonly reason: string;
    };

/** 게이트 로그는 길다 — 본문에 실을 상한. `prBody` 가 쓰는 3000자와 같은 수를 쓴다. */
const GATE_LOG_MAX_CHARS = 3000;
/** 리뷰 요약 상한. `prBody` 의 1500자와 같은 수를 쓴다. */
const CRITIQUE_SUMMARY_MAX_CHARS = 1500;
/** 목록형 축이 싣는 최대 줄 수 — 본문이 GitHub 상한을 혼자 먹지 않게 한다. */
const LIST_MAX_ITEMS = 12;

function clip(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n[…${trimmed.length - maxChars}자 생략]`;
}

function bulletList(values: readonly string[]): string[] {
  const kept = values.slice(0, LIST_MAX_ITEMS).map((v) => `- ${v}`);
  const omitted = values.length - kept.length;
  return omitted > 0 ? [...kept, `- […${omitted}개 더 생략]`] : kept;
}

/**
 * 축마다 「이 값이 있나」를 판정한다. ⛔ 존재(`!== undefined`)가 아니라 «의미 있는 값»을 본다 —
 * `{ steps: [] }` 이나 `{ objective: '(없음)' }` 는 «없다»로 읽는다.
 */
function axisSatisfied(axis: PrEvidenceAxis, input: PrEvidenceInput): boolean {
  switch (axis) {
    case 'goal':
      return !isBlank(input.goal?.objective);
    case 'plan':
      return meaningful(input.plan?.steps).length > 0;
    case 'ledger':
      return !isBlank(input.ledger?.runId)
        && !isBlank(input.ledger?.stage)
        && Number.isFinite(input.ledger?.rounds)
        && (input.ledger?.rounds ?? 0) >= 1;
    case 'critique':
      return input.critique?.reviewed === true
        && !isBlank(input.critique?.verdict)
        && !isBlank(input.critique?.summary);
    case 'tests':
      return (input.tests?.runs ?? []).some((run) => !isBlank(run.command));
    case 'risks':
      return meaningful(input.risks).length > 0;
    case 'alternatives':
      return (input.alternatives ?? []).some((a) => !isBlank(a.option) && !isBlank(a.rejectedBecause));
  }
}

/** 비어 있는 필수 축을 «선언 순서대로» 낸다. 전부 채워졌으면 빈 배열이다. */
export function missingPrEvidenceAxes(input: PrEvidenceInput): PrEvidenceAxis[] {
  return PR_EVIDENCE_AXES.filter((axis) => !axisSatisfied(axis, input));
}

function section(axis: PrEvidenceAxis, lines: readonly string[]): string[] {
  return ['', `## ${AXIS_TITLES[axis]}`, ...lines];
}

function goalSection(goal: PrEvidenceGoal): string[] {
  const signals = meaningful(goal.decisionSignals);
  return section('goal', [
    ...(isBlank(goal.goalFile) ? [] : [`- 골 파일: \`${goal.goalFile!.trim()}\``]),
    '',
    clip(goal.objective, 4000),
    ...(signals.length ? ['', '**선언된 판정 신호**', ...bulletList(signals)] : []),
  ]);
}

function planSection(plan: PrEvidencePlan): string[] {
  const steps = meaningful(plan.steps);
  const revision = plan.revision;
  return section('plan', [
    ...steps.slice(0, LIST_MAX_ITEMS).map((step, index) => `${index + 1}. ${step}`),
    ...(steps.length > LIST_MAX_ITEMS ? [`${LIST_MAX_ITEMS + 1}. […${steps.length - LIST_MAX_ITEMS}단계 더 생략]`] : []),
    ...(revision ? [
      '',
      '**감독 수용 기준 완화**',
      ...(isBlank(revision.target) ? [] : [`- 대상: ${revision.target!.trim()}`]),
      ...(isBlank(revision.from) ? [] : [`- 이전: ${revision.from!.trim()}`]),
      ...(isBlank(revision.to) ? [] : [`- 완화: ${revision.to!.trim()}`]),
      `- 이유: ${revision.reason.trim()}`,
    ] : []),
  ]);
}

function ledgerSection(ledger: PrEvidenceLedger): string[] {
  return section('ledger', [
    `- runId: \`${ledger.runId.trim()}\``,
    `- 종료 단계: \`${ledger.stage.trim()}\``,
    ...(isBlank(ledger.node) ? [] : [`- 노드: \`${ledger.node!.trim()}\``]),
    ...(isBlank(ledger.branch) ? [] : [`- 브랜치: \`${ledger.branch!.trim()}\``]),
    `- rework 라운드: ${ledger.rounds}`,
    ...(isBlank(ledger.mergeReason) ? [] : [`- 병합 판정: \`${ledger.mergeReason!.trim()}\``]),
    ...(isBlank(ledger.provider) ? [] : [`- 구현 두뇌: \`${ledger.provider!.trim()}\``]),
    '',
    `📏 이 런을 다시 보는 명령: \`elanous logs --category self-implement --grep ${ledger.runId.trim()}\``,
  ]);
}

function critiqueSection(critique: PrEvidenceCritique): string[] {
  const mustFix = meaningful(critique.mustFix);
  const shouldFix = meaningful(critique.shouldFix);
  return section('critique', [
    `- verdict: **${critique.verdict.trim()}**`,
    `- must-fix ${mustFix.length}개 · should-fix ${shouldFix.length}개`,
    '',
    clip(critique.summary, CRITIQUE_SUMMARY_MAX_CHARS),
    ...(mustFix.length ? ['', '**must-fix**', ...bulletList(mustFix)] : []),
    ...(shouldFix.length ? ['', '**should-fix (비블로킹)**', ...bulletList(shouldFix)] : []),
  ]);
}

function testRunLine(run: PrEvidenceTestRun): string {
  const counts = [
    ...(run.passed === undefined ? [] : [`${run.passed} pass`]),
    ...(run.failed === undefined ? [] : [`${run.failed} fail`]),
  ].join(' · ');
  const tail = [counts, run.detail?.trim()].filter((part) => !isBlank(part)).join(' — ');
  return `- \`${run.command.trim()}\`${tail ? ` → ${tail}` : ''}`;
}

function testsSection(tests: PrEvidenceTests): string[] {
  const runs = tests.runs.filter((run) => !isBlank(run.command));
  const typecheck = tests.typecheck;
  return section('tests', [
    ...runs.slice(0, LIST_MAX_ITEMS).map(testRunLine),
    ...(runs.length > LIST_MAX_ITEMS ? [`- […${runs.length - LIST_MAX_ITEMS}개 더 생략]`] : []),
    ...(typecheck ? [`- 타입 검사: ${typecheck.passed ? '통과' : '실패'}${isBlank(typecheck.detail) ? '' : ` — ${typecheck.detail!.trim()}`}`] : []),
    ...(isBlank(tests.gateLog) ? [] : ['', '<details><summary>게이트 로그</summary>', '', '```', clip(tests.gateLog!, GATE_LOG_MAX_CHARS), '```', '', '</details>']),
  ]);
}

function risksSection(risks: readonly string[]): string[] {
  return section('risks', bulletList(meaningful(risks)));
}

function alternativesSection(alternatives: readonly PrEvidenceAlternative[]): string[] {
  const kept = alternatives.filter((a) => !isBlank(a.option) && !isBlank(a.rejectedBecause));
  return section('alternatives', [
    ...kept.slice(0, LIST_MAX_ITEMS).map((a) => `- **${a.option.trim()}** — 안 간 이유: ${a.rejectedBecause.trim()}`),
    ...(kept.length > LIST_MAX_ITEMS ? [`- […${kept.length - LIST_MAX_ITEMS}개 더 생략]`] : []),
  ]);
}

/**
 * 일곱 축을 모아 상세 본문을 낸다. 필수 축이 하나라도 비면 **본문을 내지 않고 거절**한다 —
 * ⛔ 빈 절을 만들거나 `(없음)` 으로 채우지 않는다.
 */
export function composePrEvidenceArtifact(input: PrEvidenceInput): PrEvidenceArtifactResult {
  const missing = missingPrEvidenceAxes(input);
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: `PR 근거 아티팩트 거절 — 필수 축 ${missing.length}/${PR_EVIDENCE_AXES.length}개가 비었다: ${missing.map((axis) => `${axis}(${AXIS_TITLES[axis]})`).join(' · ')}`,
    };
  }
  const body = [
    '# 근거 아티팩트 — 일곱 축',
    '',
    `이 절은 \`composePrEvidenceArtifact\` 가 냈다. 일곱 축(${PR_EVIDENCE_AXES.join(' · ')})이 «전부» 채워졌을 때만 실린다.`,
    ...goalSection(input.goal!),
    ...planSection(input.plan!),
    ...ledgerSection(input.ledger!),
    ...critiqueSection(input.critique!),
    ...testsSection(input.tests!),
    ...risksSection(input.risks!),
    ...alternativesSection(input.alternatives!),
  ].join('\n');
  return { ok: true, body, axes: PR_EVIDENCE_AXES, chars: body.length };
}

/**
 * 게이트 로그에서 「무엇을 돌려 무엇이 나왔나」를 뽑는다. 순수 함수다.
 *
 * 📏 문면은 실측이다 — `gh pr view 18879` 의 게이트 절이 이 모양을 쓴다:
 *   `[test] PASS bun test scripts/graph-contract-flow.test.ts —  0 fail |  63 expect() calls | Ran 18 tests…`
 *
 * ⛔ 수를 «지어내지» 않는다 — 로그가 `N fail` 을 말한 것만 `failed` 로 싣고, 안 말하면 칸을 비운다.
 */
export function parseGateLogTestRuns(gateLog: string | undefined): PrEvidenceTestRun[] {
  if (isBlank(gateLog)) return [];
  const runs: PrEvidenceTestRun[] = [];
  for (const raw of gateLog!.split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^\[([\w.-]+)\]\s+(PASS|FAIL)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const [, step, outcome, tail] = match;
    const split = /^(.*?)\s+[—–-]\s+(.*)$/u.exec(tail!);
    const command = (split ? split[1]! : tail!).trim();
    if (isBlank(command)) continue;
    const detailText = split ? split[2]!.trim() : '';
    const failMatch = /(\d+)\s+fail/u.exec(detailText);
    const passMatch = /(\d+)\s+pass/u.exec(detailText);
    runs.push({
      command,
      ...(passMatch ? { passed: Number(passMatch[1]) } : {}),
      ...(failMatch ? { failed: Number(failMatch[1]) } : {}),
      detail: `${step}=${outcome}${detailText ? ` · ${detailText.slice(0, 200)}` : ''}`,
    });
  }
  return runs;
}

/**
 * 골 문서에서 «계획 · 위험 · 대안 · 판정 신호»를 뽑는다. 순수 함수다 — 파일을 읽지 않고 문면만 받는다.
 *
 * ⭐ 왜 이 넷인가: 그 값들은 이미 골 문서에 «있다». `## Answer`(계획) · `## 불변식`(위험) ·
 *   `## 경계` ⊕ `⛔ 막힌 길`(대안) · `판정 신호:`(신호). ⛔ 새로 지어내는 것이 아니라 «옮기는» 것이다 —
 *   그래서 이 관문은 골을 제대로 쓴 런에서 «실제로» 통과할 수 있다.
 */
export function extractGoalDocumentEvidence(document: string): {
  readonly steps: string[];
  readonly risks: string[];
  readonly alternatives: PrEvidenceAlternative[];
  readonly decisionSignals: string[];
} {
  const lines = document.split(/\r?\n/);
  const steps: string[] = [];
  const risks: string[] = [];
  const alternatives: PrEvidenceAlternative[] = [];
  const decisionSignals: string[] = [];
  let heading = '';
  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = /^#{1,6}\s+(.*)$/u.exec(line);
    if (headingMatch) {
      heading = headingMatch[1]!.trim();
      continue;
    }
    if (line === '') continue;
    // 판정 신호 · 불변식 · 경계 는 «마커»다 — 제목이 아니라 줄 앞머리로 읽는다.
    const marker = /^(판정 신호|불변식|경계)\s*[:：]\s*(.+)$/u.exec(line);
    if (marker) {
      const value = marker[2]!.trim();
      if (marker[1] === '판정 신호') decisionSignals.push(value);
      else if (marker[1] === '불변식') risks.push(`불변식이 깨지면 회귀다 — ${stripEmphasis(value)}`);
      else alternatives.push({ option: stripEmphasis(value), rejectedBecause: '이 골이 «의도적으로» 밖에 둔 결정이다' });
      continue;
    }
    // `## Answer` 의 ⑴⑵… 또는 번호/불릿 줄 = 실제로 밟은 계획.
    if (/^Answer$/iu.test(heading) && /^(?:[⑴-⒇]|\d+[.)]|[-*])\s*/u.test(line)) {
      steps.push(stripEmphasis(line.replace(/^(?:[⑴-⒇]|\d+[.)]|[-*])\s*/u, '')));
      continue;
    }
    // `## Complication` 의 「막힌 길」 = 고려했고 «안 간» 길.
    if (/^Complication$/iu.test(heading) && line.startsWith('⛔')) {
      const text = stripEmphasis(line.replace(/^⛔\s*/u, ''));
      const split = /^(.*?)\s+—\s+(.*)$/u.exec(text);
      if (split) alternatives.push({ option: split[1]!.trim(), rejectedBecause: split[2]!.trim() });
      else if (text) alternatives.push({ option: text, rejectedBecause: '골이 «막힌 길»로 선언했다' });
    }
  }
  return { steps, risks, alternatives, decisionSignals };
}

/** 마크다운 강조·안내 기호를 걷어 한 줄로 만든다 — 본문에 겹치는 강조가 쌓이지 않게. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*/g, '').replace(/[⭐⛔⚠️🩸📏🔑]/gu, '').replace(/\s+/g, ' ').trim();
}

export interface PrEvidenceGateDecision {
  /** 참이면 호출자는 PR 준비를 «진행하지 않는다». */
  readonly blocked: boolean;
  /** 본문에 이을 근거 절. 거절이면 undefined 다. */
  readonly body?: string;
  readonly missing: readonly PrEvidenceAxis[];
  /** 관측·오류 메시지에 그대로 쓰는 한 줄. 통과면 undefined 다. */
  readonly reason?: string;
  /** 이 판정이 «막을 수 있는» 상태였나 — `enforce` 를 그대로 되비춘다. */
  readonly enforced: boolean;
}

/**
 * 관문 판정. 작성기의 거절을 «막는 것»으로 올릴지는 `enforce` 가 정한다.
 *
 * ⛔ 기본을 차단으로 두지 않는 것은 «의도적 결정»이다 — `orchestrator.test.ts` 의 `pr-opened`
 *   단정 141개가 골의 «내용»과 무관하게 죽는다. 그래서 거절은 기본적으로 「근거 절을 안 싣고
 *   그 사실을 이름으로 관측한다」까지이고, 차단은 config 로 «명시»해 켠다.
 */
export function decidePrEvidenceGate(
  input: PrEvidenceInput,
  options: { readonly enforce: boolean },
): PrEvidenceGateDecision {
  const result = composePrEvidenceArtifact(input);
  if (result.ok) return { blocked: false, body: result.body, missing: [], enforced: options.enforce };
  return {
    blocked: options.enforce,
    missing: result.missing,
    reason: result.reason,
    enforced: options.enforce,
  };
}
