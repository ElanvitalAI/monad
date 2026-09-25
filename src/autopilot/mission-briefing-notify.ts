// ── 미션 최종 브리핑 발송(B3·PLAN-mission-pre-arming-briefing-2026-07-15) ──────────────────
//
// 실집행(arming) 직전, 종합 브리핑을 텔레그램으로: 요약 본문 + 버튼[✅승인][✏️재조치][❌보류].
// 리포트가 길면 전체 md 를 문서로 첨부(notifyMissionDocument). 브리핑 생성은 관측(제1원칙·B5 로
// 확장)에 남긴다. 카드 발송 여부 반환 — origin 텔레그램 없으면 미발송(호출측 폴백).

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLiveMissionBriefing } from './mission-briefing-live.js';
import { formatBriefingSummary, formatBriefingReport, type MissionBriefing } from './mission-briefing.js';
import { briefingButtonRow, notifyMissionDocument, resolveTelegramBotToken, sendTelegramButtonsTo } from './mission-notify.js';
import type { MissionOrigin } from './mission-origin.js';
import { recordMissionObservation } from './mission-observation.js';

/** 요약 본문이 이 길이를 넘거나 drift 경고가 있으면 전체 리포트를 문서로 첨부. */
const ATTACH_THRESHOLD = 900;

export interface BriefingPresentResult {
  sent: boolean;
  attached: boolean;
  briefing: MissionBriefing;
}

/** 브리핑 생성을 관측 3박자에 남긴다(제1원칙·자기인지 소스). fail-soft. */
function observeBriefing(missionId: string, b: MissionBriefing): void {
  try {
    recordMissionObservation({
      missionId, phaseId: b.pendingArming?.phaseId ?? 'briefing', phaseTitle: '[브리핑] 실집행 전 종합',
      stage: 'decision', verdict: 'event',
      rationale: `최종 브리핑 생성 — 골 진화 ${b.goalEvolution.length}세대·여정(split ${b.journey.splits}·결정 ${b.journey.decisions})·산출물 ${b.deliverables.groundedChecked ? 'grounded' : '휴리스틱'}(drift ${b.deliverables.driftWarnings.length})·정착 ${b.settlement.phasesDone}/${b.settlement.phasesTotal}`,
      importance: 6, stateful: true,
      refs: { briefing: true, drift: b.deliverables.driftWarnings.length, grounded: b.deliverables.groundedChecked, ...(b.pendingArming ? { armingPhase: b.pendingArming.title } : {}) },
    });
  } catch { /* fail-soft */ }
}

/**
 * 미션 최종 브리핑 카드 발송 — 요약 본문+버튼[승인/재조치/보류]. 리포트가 길거나 drift 있으면
 * 전체 md 문서 첨부. grounded 기본 ON(실집행 전이라 현실 관측 필요). 반환=발송/첨부 여부+브리핑.
 */
export function presentMissionBriefing(
  origin: MissionOrigin | null,
  missionId: string,
  opts: { pendingArming?: { phaseId: string; title: string }; grounded?: boolean } = {},
): BriefingPresentResult {
  const briefing = buildLiveMissionBriefing(missionId, {
    grounded: opts.grounded ?? true,
    ...(opts.pendingArming ? { pendingArming: opts.pendingArming } : {}),
  });
  observeBriefing(missionId, briefing);

  const summary = formatBriefingSummary(briefing);
  if (!origin || origin.channel !== 'telegram' || origin.chatId === undefined) {
    return { sent: false, attached: false, briefing };
  }
  const token = resolveTelegramBotToken(origin.botId);
  if (!token) return { sent: false, attached: false, briefing };

  let sent = false;
  let attached = false;
  try {
    const mid = sendTelegramButtonsTo(token, origin.chatId, summary, [briefingButtonRow(missionId)], origin.threadId);
    sent = mid !== null && mid !== undefined;
  } catch { /* fail-soft */ }

  // 길거나 drift 있으면 전체 리포트를 문서로 첨부(본문엔 요약만·판단 근거는 첨부에서).
  if (summary.length > ATTACH_THRESHOLD || briefing.deliverables.driftWarnings.length > 0) {
    try {
      const report = formatBriefingReport(briefing);
      const safeId = missionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      const path = join(tmpdir(), `mission-briefing-${safeId}.md`);
      writeFileSync(path, report, 'utf-8');
      attached = notifyMissionDocument(origin, path, '📋 미션 최종 브리핑 — 전체 리포트(판단 근거)');
    } catch { /* fail-soft */ }
  }
  return { sent, attached, briefing };
}
