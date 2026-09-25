// ── 관측성 자기증강 — 관측부채 스캐너 (RFC 자기인지 3박자·P4 · 2026-07-14) ──────
//
// 문제(RFC §2b·§3.4): 이번 세션에 셀프힐 3층+교착감지(#4105~4113)를 넣으면서 debug.log 계측을
// 0개 넣었다(P1 이 뒤늦게 수습). 즉 새 자율 로직이 추가될 때마다 관측 계측이 빠진다 — 사람이
// 매번 수동으로 심어야 하고, 안 심으면 관측 사각지대가 조용히 쌓인다.
//
// 설계(RFC §3.4): 자율 서브시스템(autopilot/)에서 셀프힐·실패 의미를 가진 파일 중 관측 계측
// (recordMissionObservation/observe/debug.log)이 없는 곳을 스스로 감지해 self-memory 로
// 표면화한다. propose-only(발송 없이 자각 기록만·대표 §6-4 권고) — 봇이 "이 서브시스템은 관측
// 사각지대" 를 ambient 로 인지한다. "스스로 관측성이 증가하는 장치".
//
// 순수 분석기(scanObservabilityDebt)는 단위테스트로 회귀 가드. 드라이버는 fs/self-memory 주입 seam.

/** 셀프힐·실패 의미 신호 — 이 중 하나라도 있으면 "관측되어야 할 자율 로직" 후보. */
const SELFHEAL_SIGNALS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /VERDICT:\s*FAIL/, label: 'verdict-fail' },
  { re: /교착|deadlock/i, label: 'deadlock' },
  { re: /no-op|no-change/i, label: 'noop' },
  { re: /gate-failed|gate_failed/i, label: 'gate-failed' },
  { re: /triage/i, label: 'triage' },
  { re: /리커버리|recover(y|Grounded)/i, label: 'recover' },
  { re: /self-?heal|셀프\s*힐|자기치유/i, label: 'self-heal' },
  { re: /escalat/i, label: 'escalate' },
];

/** 관측 계측 신호 — 이 중 하나라도 있으면 "관측됨"으로 본다. */
const OBSERVATION_SIGNALS: ReadonlyArray<RegExp> = [
  /recordMissionObservation\s*\(/,
  /\bobserve\s*\(/,
  /makeMissionObserver\s*\(/,
  /debug\.log\s*\(/,
];

// ★ 방출(emission) 신호 — 이 파일이 사람용 로그/알림을 실제로 방출하는 "능동 emitter"인가.
//   진짜 관측부채 = 방출은 하는데(run.log·console·onProgress) 구조화 관측(관문)엔 안 하는 것(P1 이
//   고친 패턴). 순수 분석기/타입정의/렌더러(방출 없이 값만 반환)는 호출측이 관측하므로 부채 아님 —
//   이 신호로 걸러 오탐(pure helper 오검출)을 대폭 줄인다.
const EMISSION_SIGNALS: ReadonlyArray<RegExp> = [
  /\blog\s*\(/,
  /console\.(log|error|warn)\s*\(/,
  /onProgress\s*\(/,
];

export interface ObservabilityDebtFinding {
  path: string;
  /** 이 파일에서 감지된 셀프힐 신호(무엇이 관측돼야 하나). */
  signals: string[];
  /** 감지된 셀프힐 신호 총 라인 수(부채 규모의 근사). */
  hits: number;
  reason: string;
}

export interface DebtScanInput {
  path: string;
  content: string;
}

/**
 * 순수 분석기 — 파일 목록에서 관측부채를 감지(부작용 없음).
 * 부채 = 셀프힐·실패 의미 신호는 있는데 관측 계측(recordMissionObservation/observe/debug.log)이 0.
 * .test. 파일은 제외(테스트는 관측 대상 아님).
 */
export function scanObservabilityDebt(files: readonly DebtScanInput[]): ObservabilityDebtFinding[] {
  const findings: ObservabilityDebtFinding[] = [];
  for (const f of files) {
    if (/\.test\.tsx?$/.test(f.path)) continue;
    const hasObservation = OBSERVATION_SIGNALS.some((re) => re.test(f.content));
    if (hasObservation) continue; // 이미 관측됨
    const emits = EMISSION_SIGNALS.some((re) => re.test(f.content));
    if (!emits) continue; // 방출 없는 순수 로직 — 호출측이 관측(부채 아님)
    const matched: string[] = [];
    let hits = 0;
    for (const sig of SELFHEAL_SIGNALS) {
      const m = f.content.match(new RegExp(sig.re, sig.re.flags.includes('g') ? sig.re.flags : sig.re.flags + 'g'));
      if (m && m.length) { matched.push(sig.label); hits += m.length; }
    }
    if (matched.length >= 2) {
      // 신호 2종 이상이어야 "자율 셀프힐 로직"으로 판단(단순 언급 오탐 방지).
      findings.push({
        path: f.path,
        signals: matched,
        hits,
        reason: `셀프힐/실패 신호 ${matched.length}종(${matched.join('·')})·${hits}건이 있으나 관측 계측(recordMissionObservation/observe/debug.log)이 0 — 관측 사각지대`,
      });
    }
  }
  // 부채 큰 순(hits 내림차순).
  return findings.sort((a, b) => b.hits - a.hits);
}

/** 사람 읽기·self-memory 주입용 요약 — 상위 N 부채. */
export function formatObservabilityDebt(findings: readonly ObservabilityDebtFinding[], topN = 5): string {
  if (findings.length === 0) return '관측부채 없음 — 셀프힐 자율 로직이 전부 관측 계측을 갖춤.';
  const lines = [`관측부채 ${findings.length}개 파일(계측 없는 자율 셀프힐 로직):`];
  for (const f of findings.slice(0, topN)) lines.push(`- ${f.path} — ${f.signals.join('·')}(${f.hits}건)`);
  if (findings.length > topN) lines.push(`… 외 ${findings.length - topN}개`);
  return lines.join('\n');
}

export interface DebtScanDeps {
  /** 스캔 대상 파일 목록·내용(기본 src/autopilot/*.ts 실 fs). */
  listFiles?: () => DebtScanInput[];
  /** self-memory 주입(기본 injectSelfMemory·propose-only). */
  inject?: (summary: string, text: string) => void;
  /** 마지막 스캔 시각(ISO·throttle). 미주입=마커 파일. */
  lastScanAt?: () => number;
  setScanAt?: (nowMs: number) => void;
  /** 현재 시각(ms) — throttle 계산·seam. */
  nowMs?: () => number;
  /** 최소 스캔 간격(기본 20h) — 매 미션 실행마다 안 돌게. */
  throttleMs?: number;
}

export interface DebtScanResult {
  ran: boolean;
  reason: 'ran' | 'throttled' | 'error';
  findings: ObservabilityDebtFinding[];
}

/**
 * 드라이버 — 관측부채 스캔 → self-memory 표면화(propose-only). throttle(기본 20h)로 hot-path 회피.
 * 전부 fail-soft(스캔 실패가 미션/호출측을 막지 않음). 발송 없음(대표 §6-4 propose-only).
 */
export function runObservabilityDebtScan(deps: DebtScanDeps = {}): DebtScanResult {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const throttleMs = deps.throttleMs ?? 20 * 3600 * 1000;
  try {
    const last = (deps.lastScanAt ?? defaultLastScanAt)();
    const now = nowMs();
    if (last && now - last < throttleMs) return { ran: false, reason: 'throttled', findings: [] };

    const files = (deps.listFiles ?? defaultListFiles)();
    const findings = scanObservabilityDebt(files);
    (deps.setScanAt ?? defaultSetScanAt)(now);

    if (findings.length > 0) {
      const inject = deps.inject ?? defaultInject;
      inject(
        `관측부채 자가진단 — 계측 없는 자율 셀프힐 ${findings.length}개 파일`,
        `${formatObservabilityDebt(findings)}\n\n(RFC 자기인지 3박자·P4 자기증강 — 새 자율 로직에 관측 계측(recordMissionObservation/observe)을 추가하라. propose-only.)`,
      );
    }
    return { ran: true, reason: 'ran', findings };
  } catch { return { ran: false, reason: 'error', findings: [] }; }
}

// ── 실 fs/self-memory 기본 배선(fail-soft) ─────────────────────────────────
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { monadStateRoot } from './state-paths.js';

const DEBT_MARKER = () => join(monadStateRoot(), 'autopilot', '.obs-debt-scan');

function defaultListFiles(): DebtScanInput[] {
  const dir = join(process.cwd(), 'src', 'autopilot');
  try {
    return readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => ({ path: `src/autopilot/${f}`, content: (() => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return ''; } })() }))
      .filter((x) => x.content);
  } catch { return []; }
}

function defaultLastScanAt(): number {
  try { return existsSync(DEBT_MARKER()) ? Number(readFileSync(DEBT_MARKER(), 'utf8').trim()) || 0 : 0; }
  catch { return 0; }
}

function defaultSetScanAt(nowMs: number): void {
  try { mkdirSync(dirname(DEBT_MARKER()), { recursive: true }); writeFileSync(DEBT_MARKER(), String(nowMs)); }
  catch { /* fail-soft */ }
}

function defaultInject(summary: string, text: string): void {
  void (async () => {
    try {
      const { injectSelfMemory } = await import('../domains/self-awareness.js');
      await injectSelfMemory({ tool: 'autopilot', kind: 'observability-debt', importance: 6, summary, text });
    } catch { /* fail-soft */ }
  })();
}
