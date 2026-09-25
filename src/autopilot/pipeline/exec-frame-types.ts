// 미션 실행(구현) 페이즈 프레임 — 계약 (S4·실행 적응 시나리오 2026-07-19)
//
// ★ 제1원칙 관측·리플레이의 실행-타임 토대. 빌드 프레임(PipelineFrame·frame-types.ts)이 분해
//   파이프라인 stage 를 담는다면, 이 ExecutionFrame 은 승인된 미션의 **실행 페이즈**(구현·조사·
//   스킵·아크수술·의존추천)를 담는다. BuildStage/Blackboard 에 강결합된 빌드 프레임과 분리(대표
//   결정 2026-07-19) — 저수준 저널 IO(appendJsonlLine/readJsonlLines·safeId·frameDir)만 재사용.
//   저장 파일도 분리: pipeline_frames/<id>.exec.jsonl (빌드 = <id>.jsonl).
//
// 재사용: version 세만틱 = ANS Versioned/supersede(MESI S→I) — goto/되감기 대비. deviation = E1 kind.

import type { DeviationKind } from '../mission-working-memory.js';

/** 실행 프레임을 만든 조작 — 리플레이 재현 + 셀프힐 감사(왜 이 프레임이 생겼나).
 *  phase-start/phase-done = 정상 실행 · skip = 이미 충족(S1) · arc-surgery = in-flight 아크 추가/수술(S3)
 *  · dep-recommend = 선행 의존 미션 추천(S2) · pending-write = 부분 durable write 보존(P0·고아 방지).
 *  skip/arc-surgery/dep-recommend 는 각 시나리오에서 배선. · review-gate = 자율 PR 리뷰 판정(R1·PR 산출물
 *  검증을 1급 실행 프레임으로·verdict=fail 이면 status=blocked+deviation review_fail → 재작업 유발 감사).
 *
 *  ★ pending-write (조율자 격상 P0·LangGraph put_writes 이식) — 페이즈가 durable 산출물(PR push·브랜치)을
 *    낸 "그 순간" 기록한다. phase-done 프레임이 써지기 전 프로세스가 죽어도, 이 프레임이 원장에 남아
 *    산출물이 고아(원격엔 있으나 미션 원장엔 부재)가 되지 않는다. 재개 시 collectPendingWrites 로 회수 →
 *    조율자가 "이 페이즈 이미 PR 냈다"를 보고 재구현하지 않는다(dogfood a6230f 재구현 근본 차단). */
export type ExecFrameOp = 'phase-start' | 'phase-done' | 'skip' | 'arc-surgery' | 'dep-recommend' | 'pending-write' | 'review-gate';

/** 실행 페이즈 상태 — no-op = 변경 0(이미 충족·빈 산출). */
export type ExecPhaseStatus = 'running' | 'done' | 'failed' | 'skipped' | 'blocked' | 'no-op';

/** 실행 프레임 = 한 페이즈 실행(또는 미션-레벨 적응)의 기록. 리플레이·되감기의 단위(빌드 프레임과 분리). */
export interface ExecutionFrame {
  frameId: string;          // `${safeMissionId}:exec:${seq}` — 저널 내 결정론 식별자
  missionId: string;
  seq: number;              // 단조증가(실행 저널 내) — 순서·최신 판정
  phaseId: string;          // 해당 task id(빈 문자열 = 미션-레벨 적응, 예: dep-recommend)
  phaseTitle: string;
  op: ExecFrameOp;
  status: ExecPhaseStatus;
  timestamp: string;        // ISO8601
  version: number;          // ANS Versioned 재사용 — goto/rerun 시 옛 프레임 supersede 판정
  generation?: number;      // ★ H4 — rerun 세대(파티션). append 시 스탬프·옛 프레임은 undefined(하위호환)
  /** 실행 경로(자기인지) — se-isolated(구현·격리 worktree) 또는 walker(조사·운영·main 트리). */
  framework?: 'se-isolated' | 'walker';
  /** 이 페이즈가 속한 아크(RFC 아크). 없으면 flat/미태깅. */
  arcId?: string;
  /** 플랜 이탈(E1) — 스킵/부분완주/수술의 "왜"를 회고·리플레이가 회상. */
  deviation?: { kind: DeviationKind; note: string };
  /** 산출물(PR URL·파일). */
  artifacts?: string[];
  /** 짧은 요약(사후 관측). */
  note?: string;
  /** ★ 실시간 관측(2026-07-19 대표) — 사람이 읽는 아크 지칭. arcId(해시)와 별개로 로그/리플레이에
   *  "아크 ①/2 YouTube MVP" 를 바로 보여준다. 없으면 flat/미태깅. */
  arcName?: string;
  /** 아크 순번 `k/N`(멀티아크만). */
  arcSeq?: string;
  /** 무효화한 프레임 seq(MESI S→I·goto/rewind 대비) — stale 재생 방지. */
  supersededBy?: number;
}
