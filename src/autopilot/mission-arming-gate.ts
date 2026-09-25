// ── arming 경계 HITL 게이트 (Track C · 2026-07-15) ────────────────────────────
//
// 대표 지시: A3(canary 주문·체결검증) 같은 실집행 페이즈는 정의모듈 경계에서 게이트 실패로
// 처리하지 말고, "실집행 승인(arm)/범위 제외(skip)/나중에(defer)" 의사를 UX 로 다시 묻는다.
// 코드는 disarmed 게이트 뒤라 자동 실패는 부적절 — 사람이 arming 을 결정할 지점이다(매매=HITL).

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPhaseCallbackData, resolveTelegramBotToken, sendTelegramButtonsTo, notifyMissionDocument } from './mission-notify.js';
import type { MissionOrigin } from './mission-origin.js';
import { recordMissionObservation } from './mission-observation.js';
import { buildLiveMissionBriefing } from './mission-briefing-live.js';
import { formatBriefingSummary, formatBriefingReport } from './mission-briefing.js';

/** 실집행/arming 경계 페이즈인가 — canary·주문·체결·집행·mandate·매매·arming·live 키워드. 순수. */
export function isArmingBoundaryPhase(title: string, summary?: string): boolean {
  const t = `${title} ${summary ?? ''}`;
  return /canary|카나리|주문|체결|집행|mandate|매매|arming|arm\b|라이브|live 주문|order|execution|실집행/i.test(t);
}

export interface ArmingCard {
  text: string;
  buttons: Array<Array<{ text: string; data: string }>>;
}

/**
 * arming 의사확인 카드 — 실집행 페이즈를 실패가 아니라 HITL 결정으로. [🔒 실집행 승인(arm)]
 * [⏳ 나중에(defer)] [⏭️ 범위 제외(skip)]. arm/defer 는 PhaseAction 확장(handlePhaseReviewTap).
 */
export function buildArmingDecisionCard(phaseId: string, title: string): ArmingCard {
  const text = [
    `🔒 실집행 경계 — 사람 결정 필요`,
    `페이즈: ${title}`,
    ``,
    `이 페이즈는 실 매매 집행 경로(canary/체결)라 자동으로 실패 처리하지 않습니다.`,
    `코드는 disarmed 게이트 뒤 — arming 은 대표님이 결정하는 지점입니다(매매=HITL).`,
    ``,
    `· 🔒 실집행 승인 = arming 진행(별도 arm 플로우로 안내)`,
    `· ⏳ 나중에 = arming 단계로 defer(범위 제외·결정 기록)`,
    `· ⏭️ 범위 제외 = skip(기능 제외·미션 계속)`,
  ].join('\n');
  const buttons = [[
    { text: '🔒 실집행 승인', data: buildPhaseCallbackData(phaseId, 'arm') },
    { text: '⏳ 나중에', data: buildPhaseCallbackData(phaseId, 'defer') },
    { text: '⏭️ 범위 제외', data: buildPhaseCallbackData(phaseId, 'skip') },
  ]];
  return { text, buttons };
}

/**
 * arming 의사확인 카드 발송 + 관측(decision-required) — 실집행 페이즈 실패 대신 HITL 로 다시 묻는다.
 * origin 텔레그램 없으면 미발송(호출측이 폴백). 관측은 항상(logs.db·기억). 반환=발송 여부.
 */
export function presentArmingDecisionCard(origin: MissionOrigin | null, missionId: string, phaseId: string, title: string): boolean {
  // 관측 — "실집행 경계라 자동 실패 대신 HITL 요청"을 남긴다(자기인지 소스).
  try {
    recordMissionObservation({
      missionId, phaseId, phaseTitle: title, stage: 'decision', verdict: 'inject',
      rationale: `arming 경계 — 실집행 페이즈 자동 실패 대신 HITL 의사확인 카드 발송(arm/defer/skip)`,
      importance: 7, stateful: true, refs: { armingGate: true, phase: title },
    });
  } catch { /* fail-soft */ }
  if (!origin || origin.channel !== 'telegram' || origin.chatId === undefined) return false;
  try {
    const token = resolveTelegramBotToken(origin.botId);
    if (!token) return false;
    const card = buildArmingDecisionCard(phaseId, title);
    // ★ B4 브리핑 승격(PLAN §7) — arming 카드를 "브리핑 위의 승인"으로. 종합 브리핑(골 진화+여정+
    //   산출물 grounded 점검+정착)을 판단 근거로 앞세우고, 그 아래 arm/defer/skip 버튼(기존 mechanics
    //   보존). 리포트가 길거나 drift 있으면 전체 md 첨부. 브리핑 실패해도 카드는 발송(fail-soft).
    let body = card.text;
    try {
      const briefing = buildLiveMissionBriefing(missionId, { grounded: true, pendingArming: { phaseId, title } });
      body = `${formatBriefingSummary(briefing)}\n\n${'─'.repeat(8)}\n${card.text}`;
      if (briefing.deliverables.driftWarnings.length > 0 || body.length > 900) {
        const safeId = missionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const path = join(tmpdir(), `mission-briefing-${safeId}.md`);
        writeFileSync(path, formatBriefingReport(briefing), 'utf-8');
        notifyMissionDocument(origin, path, '📋 미션 최종 브리핑 — 전체 리포트(실집행 판단 근거)');
      }
    } catch { /* fail-soft — 브리핑 없이 순수 arming 카드로 폴백 */ }
    const mid = sendTelegramButtonsTo(token, origin.chatId, body, card.buttons, origin.threadId);
    return mid !== null && mid !== undefined;
  } catch { return false; }
}
