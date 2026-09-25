// ── 시스템 결함 → 셀프힐링 미션 스폰 (셀프힐 배선 · 2026-07-13 · 대표 지시) ──────
//
// escalate(mission-tool)가 시스템 결함 의심(R2 모순 + R3 Opus 룩백 리포트)을 규명하면, 이 헬퍼가
// 그 결함 컨텍스트를 골에 실어 **system-repair 권한 미션**을 스폰한다(HITL). 새 미션은:
//   1) submitIntent(narrow-waist) 로 생성 → se-mission-prepare 자동 분해 → HITL 페이즈 검토.
//   2) authorizeSystemRepair(newMissionId) — IMMUTABLE_CORE 수정 예외 등재(worktree·PR 까지·merge 는 HITL).
//   3) build.backend 는 mission-se-bridge 가 isSystemRepairAuthorized 로 Opus 강제(별도 배선).
//
// 자율경계: 감지·진단·스폰까지는 escalate 탭(사람 결정)이 트리거하지만, 실제 수리 빌드는 분해 후
// HITL 승인, merge + 데몬 재시작은 다시 HITL. 완전 자율 아님(대표 결정). IMMUTABLE_CORE(safety.ts)는
// system-repair 예외라도 수리 프롬프트가 "수정 금지"로 명시(힐링 범위만).

import type { ContradictionSignal } from './contradiction-detector.js';
import type { MissionOrigin } from './mission-origin.js';
import { authorizeSystemRepair } from './system-repair.js';

export interface SpawnSystemRepairInput {
  /** 결함이 규명된 원 미션 id(계보·컨텍스트). */
  sourceMissionId: string;
  /** 실패 페이즈 제목(결함이 드러난 지점). */
  phaseTitle: string;
  /** R2 모순 신호(시스템 결함 의심 근거). */
  signals: readonly ContradictionSignal[];
  /** R3 Opus 룩백 리포트(결함 위치·수정 후보). */
  report: string;
  /** R3 가 조사한 의심 소스 파일. */
  suspectFiles?: readonly string[];
  /** 알림 되돌림 origin(발신 채널). */
  origin?: MissionOrigin | null;
  /** submitIntent seam(테스트 격리). 없으면 실제 intent-gate. */
  submit?: (goal: string, origin?: MissionOrigin | null) => Promise<{ route: string; missionId?: string }>;
  /** system-repair 권한 등재 seam(테스트 격리·실 ~/.monad 미접촉). 없으면 authorizeSystemRepair. */
  authorize?: (missionId: string) => void;
}

export interface SpawnSystemRepairResult {
  ok: boolean;
  missionId?: string;
  goal?: string;
  error?: string;
}

/** 결함 컨텍스트(R2+R3) → 수리 미션 골(ASCII+한글·특수문자 회피·agent 정책). Opus 가 분해·수리할
 *  구체 지시. IMMUTABLE_CORE 수정 금지를 골에 명시(힐링 범위 한정). 순수·테스트 가능. */
export function buildRepairGoal(input: {
  phaseTitle: string;
  signals: readonly ContradictionSignal[];
  report: string;
  suspectFiles?: readonly string[];
}): string {
  const suspectLine = input.suspectFiles && input.suspectFiles.length
    ? input.suspectFiles.join(', ')
    : '(R3 리포트 참조)';
  // ASCII+한글만(en-dash 등 특수문자는 agent 프롬프트 truncation 유발·feedback_agent_prompt_ascii_only).
  // signal.detail(contradiction-detector)이 em-dash 를 담을 수 있어 조립 후 정규화(방어).
  return asciiSafe([
    'monad 시스템 결함 수리(self-heal): 미션 fabric 자기 코드/설정의 시스템 결함을 조사하고 수리하라.',
    `계기: 페이즈 "${input.phaseTitle}" 에서 시스템 모순 ${input.signals.length}건 감지(예산/분할로 안 풀리는 시스템 결함).`,
    '',
    '## 감지된 모순(R2)',
    ...input.signals.map((s) => `- [${s.kind}] ${s.detail}`),
    '',
    '## R3 소스 룩백 리포트(Opus READ-ONLY 조사)',
    input.report.slice(0, 1800),
    '',
    `## 의심 소스: ${suspectLine}`,
    '',
    '## 수리 지시',
    '1. R3 리포트가 지목한 결함을 실제 코드에서 확인하라(재사용 우선, 재구현 금지).',
    '2. 최소 수정으로 결함을 고치고 회귀 테스트를 추가/보강하라(게이트 커버리지 포함).',
    '3. IMMUTABLE_CORE(safety.ts 매매/재부팅 핵심)는 수정 금지(힐링 범위만).',
    '4. merge 와 데몬/PWA 재시작은 사람 승인(HITL) 대상이다. worktree 와 PR 초안까지만.',
  ].join('\n'));
}

/** agent 프롬프트 안전화(대표 feedback_agent_prompt_ascii_only) — em/en-dash·특수 하이픈을 ASCII
 *  하이픈으로. contradiction-detector 등 상류가 em-dash 를 섞어도 truncation(정책 오탐)을 막는다. */
function asciiSafe(text: string): string {
  return text.replace(/[‒-―−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** 시스템 수리 미션 스폰 — 결함 컨텍스트를 골에 실어 submitIntent 로 미션 생성 + system-repair
 *  권한 등재. 생성 실패(마커 파싱 등) 시 {ok:false}. fail-soft. */
export async function spawnSystemRepairMission(input: SpawnSystemRepairInput): Promise<SpawnSystemRepairResult> {
  const goal = buildRepairGoal({
    phaseTitle: input.phaseTitle, signals: input.signals, report: input.report,
    ...(input.suspectFiles ? { suspectFiles: input.suspectFiles } : {}),
  });
  const submit = input.submit ?? defaultSubmit;
  let res: { route: string; missionId?: string };
  try { res = await submit(goal, input.origin ?? null); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : String(e) }; }
  if (res.route !== 'mission' || !res.missionId) {
    return { ok: false, error: `미션 생성 실패(route=${res.route}).` };
  }
  // ★ system-repair 권한 등재(대표 opt-in 을 escalate 사람 결정이 대신) — IMMUTABLE_CORE 수정 허용
  //   (worktree·PR). merge 는 여전히 HITL. Opus 강제는 mission-se-bridge 가 이 등재를 읽어 적용.
  const authorize = input.authorize ?? authorizeSystemRepair;
  try { authorize(res.missionId); } catch { /* fail-soft — 등재 실패해도 미션은 생성됨 */ }
  return { ok: true, missionId: res.missionId, goal };
}

/** 기본 submit — intent-gate.submitIntent(마커 접두 + channel=api + source=human-intent →
 *  se-mission-prepare 분해 + HITL). lazy import(순환/부팅 회피). */
async function defaultSubmit(goal: string, origin?: MissionOrigin | null): Promise<{ route: string; missionId?: string }> {
  const { submitIntent } = await import('../intent-gate/gate.js');
  const r = await submitIntent({
    text: `미션: ${goal}`,
    channel: 'api',
    source: 'human-intent',
    ...(origin ? { origin } : {}),
  });
  return r.route === 'mission' ? { route: 'mission', missionId: r.missionId } : { route: r.route };
}
