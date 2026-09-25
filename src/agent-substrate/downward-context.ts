// 하향 컨텍스트 조립 — 오케스트레이터 → 스테이지 2층 컨텍스트 (공용·중립 · 2026-07-20 C6 승격).
//
// 원본: src/autopilot/pipeline/coordinator-context.ts(2층 컨텍스트 C5). 스테이지(walker)는 fresh 세션이라
// 자기 슬라이스만 알고 "전체가 어디까지 왔나"를 모른다 → 오케스트레이터가 **선별·압축한 전체 시야 블록**을
// 하향 주입(국소 최적화가 전체 intent 를 벗어나지 않게). Anthropic condensed-return·MemGPT core block 동형.
//
// ★ 이 모듈은 **도메인-무관 순수 코어**(DESIGN §16 C6): progress(진행률+권장) + phases(카운트+내 위치) +
//   failures(상위 N) 를 요약. 워킹메모리/frames/routing 은 제외(중복회피·예산경계·~10줄). 미션은 MissionState
//   에서 이 구조적 입력을 뽑아 넘긴다(coordinator-context.ts 바인딩). 스몰-폼 하니스가 자기 스테이지로 재사용
//   (§15c 큐레이팅 하향 블록). 전부 순수·결정론·I/O 없음.

import type { ProgressLedger } from './progress-ledger.js';

/** 하향 블록 산출(관측용 지표 포함) — caller 가 프롬프트에 blockText 주입 + 관측 방출. */
export interface DownwardContextResult {
  /** 스테이지 프롬프트에 붙일 블록(비어 있으면 ''). */
  blockText: string;
  donePhases: number;
  totalPhases: number;
  failureCount: number;
  recommendation?: string;
}

/** 하향 컨텍스트 입력(구조적 — 도메인 State 결합 회피). */
export interface DownwardContextInput {
  /** 스테이지들(id·status). done 카운트·내 위치 파생. */
  phases: readonly { id: string; status: string }[];
  /** 실패 스테이지(상위 N 노출). */
  failures: readonly { title: string }[];
  /** 진행 판정(Progress Ledger·C3). 없으면 상태줄 생략. */
  progress?: ProgressLedger;
  /** 현재 스테이지 id(내 위치 계산). */
  currentPhaseId: string;
}

/**
 * ★ 하향 컨텍스트 블록 조립(순수). progress(진행률+권장) + phases(카운트+내 위치) + failures(상위3) 요약.
 * 정보 없으면 blockText=''(무주입). 워킹메모리/frames 제외(중복·노이즈).
 */
export function formatDownwardContext(input: DownwardContextInput): DownwardContextResult {
  const { phases, failures, progress, currentPhaseId } = input;
  const done = phases.filter((p) => p.status === 'done').length;
  const total = phases.length;
  const myIdx = phases.findIndex((p) => p.id === currentPhaseId);
  const empty: DownwardContextResult = { blockText: '', donePhases: done, totalPhases: total, failureCount: failures.length };
  if (!total && !progress) return empty;   // 정보 없으면 무주입

  const lines: string[] = ['', '[미션 진행 상황 · 조율자 시야]'];
  if (total) lines.push(`- 진행: ${done}/${total} 페이즈 done${myIdx >= 0 ? ` · 이 페이즈=${myIdx + 1}번째` : ''}`);
  if (progress) {
    lines.push(`- 상태: ${progress.satisfied ? '충족' : '전진 중'}(stall=${progress.stallCount}${progress.inLoop ? '·교착' : ''})`);
    if (progress.recommendation) {
      lines.push(`- 권장: ${progress.recommendation}${progress.rationale ? ` — ${progress.rationale.slice(0, 80)}` : ''}`);
    }
  }
  if (failures.length) {
    lines.push(`- ⚠ 실패 페이즈(${failures.length}): ${failures.slice(0, 3).map((f) => f.title).join(' · ')}`);
  }
  lines.push('→ 위 미션 전체 시야 위에서 이 페이즈를 수행하라(국소 작업이 전체 진행과 정합하게).');
  return { blockText: lines.join('\n'), donePhases: done, totalPhases: total, failureCount: failures.length, ...(progress?.recommendation ? { recommendation: progress.recommendation } : {}) };
}
