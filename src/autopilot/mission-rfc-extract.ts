// ── RFC → 아크/페이즈 추출 (R2 · RFC-plan-as-rfc-generation) ──────────────────
//
// 저작된 RFC(mission-rfc-author)의 구조화 아크/작업항목을 **결정론적으로** ProposedTask 로
// 변환한다 — 작업항목 = 페이즈(LLM sizing 우회 = 재분해 소동 근원 제거). decomposeMissionToPhases
// 의 `presetTasks` seam 으로 주입되면 기존 창작·아크분류·영속 machinery 를 그대로 재사용(안전).
// 각 페이즈에 **RFC 설계계약 참조**(아크 제목 + rfc.md 경로)를 주입해 빌드가 설계를 수령한다.
//
// 설계: 내부 문서 `RFC-plan-as-rfc-generation-2026-07-22` §2·§6(R2). 순수 함수(테스트 가능).

import type { ProposedTask } from '../task-orchestrator/generator-schema.js';
import type { AuthoredRfc } from './mission-rfc-author.js';
import { rfcDocPath } from './mission-rfc-store.js';

/** RFC 아크/작업항목 → ProposedTask[] (결정론·선형 dependsOn 체인). 작업항목 하나 = 페이즈 하나.
 *  description 에 RFC 설계계약 참조(아크 제목 + rfc.md 경로)를 실어 빌드가 설계 섹션을 계약으로 수령. */
export function rfcToProposedTasks(missionId: string, rfc: AuthoredRfc): ProposedTask[] {
  const docPath = rfcDocPath(missionId);
  const tasks: ProposedTask[] = [];
  let index = 0;
  for (const arc of rfc.arcs) {
    for (const item of arc.workItems) {
      const title = item.title.slice(0, 80); // Task.title 한도(80)와 정합 — 초과 throw 근절.
      const description = [
        `[RFC 설계계약] 이 페이즈는 승인된 RFC "${rfc.title}" 의 아크 "${arc.heading}" 작업항목이다.`,
        ...(item.detail?.trim() ? [`산출물·완료계약: ${item.detail.trim()}`] : []),
        `RFC 문서(설계 계약·이 페이즈의 근거): ${docPath}`,
        `이 작업항목만 구현하라 — RFC 밖 범위 확장·재해석 금지. 기존 심볼 재사용·불변 코어 무접촉.`,
      ].join('\n');
      tasks.push({
        index,
        title,
        description,
        surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: `${title}\n${description}` },
        // 선형 체인 — 이전 페이즈 위에 스택(현 se-build 스택 규율과 정합). 첫 페이즈는 선행 없음.
        ...(index > 0 ? { dependsOn: [index - 1] as readonly number[] } : {}),
        acceptance: { criteria: [`RFC 아크 "${arc.heading}" 의 작업항목 "${title}" 이 구현되고 자동 게이트(bun test) 통과`] },
      });
      index += 1;
    }
  }
  return tasks;
}

/** RFC 정합 검사 — 추출 전(사전 예측)·후(사후 검증) 공용. 작업항목 수 = 기대 페이즈 수.
 *  gradeArcConformance(arcHint×N)의 RFC 판. 손실(누락)·과잉(추가)을 관측용으로 보고. */
export interface RfcConformance {
  arcs: number;
  expectedPhases: number;
  /** 실제 생성 페이즈 수(사후 검증 시 주입·사전엔 생략). */
  actualPhases?: number;
  conformant: boolean;
  reason: string;
}

export function checkRfcConformance(rfc: AuthoredRfc, actualPhases?: number): RfcConformance {
  const expectedPhases = rfc.arcs.reduce((n, a) => n + a.workItems.length, 0);
  if (actualPhases === undefined) {
    return { arcs: rfc.arcs.length, expectedPhases, conformant: expectedPhases > 0, reason: expectedPhases > 0 ? '추출 대상 존재' : 'RFC 작업항목 없음' };
  }
  const conformant = actualPhases === expectedPhases;
  return {
    arcs: rfc.arcs.length, expectedPhases, actualPhases, conformant,
    reason: conformant ? '작업항목↔페이즈 1:1 정합'
      : actualPhases < expectedPhases ? `누락(${expectedPhases}→${actualPhases})`
      : `과잉(${expectedPhases}→${actualPhases})`,
  };
}
