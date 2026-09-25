// ── UX 에이전트 라이브 배선 브릿지 (P4 Phase 2b·2026-07-19) ────────────────────
// autopilot(FLOW/write) ↔ ux 코어(RENDER/NORMALIZE) 브릿지. 발행(UXIntent→텔레그램)·수신(콜백/
// 리액션→UXEvent)·소비(승인→실행 write)를 연결한다. opt-in(canUseUxAgent·기본 OFF)이라 켜야 동작.
//
// 안전: 승인/거부는 **공유 write**(approveMission·cancelMission·PWA/CLI 동일·멱등 가드 내장)를 재사용
// (비가역 실행 오발 방지). 동적 액션(redecompose·descope·apply-heal 등)은 **기존 공유 실처리 함수**
// (spawnMissionPrepare·rebuildCritiquedPhases — apm-* 콜백 경로와 동일)를 재사용해 배선하고, 각 전이 시
// loadMissionOrigin→sendTelegramTo 로 사용자에게 통지한다(대표 지적: 재분해 무통지 수복). arc-surgery·
// dep-mission 은 페이즈 컨텍스트/기존 실처리 부재로 관측만(후속 배선). clarify 라이브도 후속.
// 순환 import 회피: mission-notify 는 이 모듈을 dynamic import 로 호출한다.

import type { UXIntent } from '../ux/ux-intent.js';
import { approvalToUXIntent } from '../ux/ux-intent-builder.js';
import { buildContextualActions } from '../ux/ux-dynamic-builder.js';
import { emitUxIntentToTelegram, handleUxEvent, type UxEventConsumerDeps } from '../ux/ux-flow.js';
import { parseUxCallbackData, normalizeTelegramCallback, type TgMessageReactionLike } from '../ux/telegram-ux-adapter.js';
import { resolveReactionEvent } from '../ux/ux-reaction-router.js';
import { approveMission, DECOMPOSE_OPUS_MODEL } from './mission-engine.js';
import { cancelMission, rebuildCritiquedPhases } from './mission-lifecycle.js';
import { resolveTelegramBotToken, sendTelegramButtonsTo, sendForceReplyTo, sendTelegramTo, hitlToken } from './mission-notify.js';
import { resolveMissionByHitlToken } from './mission-hitl-callback.js';
import { spawnMissionPrepare } from './mission-prepare-spawn.js';
import { readPendingRedesign, clearPendingRedesign } from './mission-pending-redesign.js';
import { readPendingRedecompose } from './mission-pending-redecompose.js';
import { loadMissionOrigin, type MissionOrigin } from './mission-origin.js';
import { debug } from '../debug/log.js';

/** 동적 액션 실처리 시 origin 채널로 사용자 통지(fail-soft). 재분해/힐 "시작" 무통지 수복(대표 지적). */
function notifyUxAction(missionId: string, message: string): void {
  try {
    const origin = loadMissionOrigin(missionId);
    const token = origin ? resolveTelegramBotToken(origin.botId) : null;
    if (origin && token && origin.chatId !== undefined) {
      sendTelegramTo(token, origin.chatId, message, origin.threadId);
    }
  } catch { /* fail-soft */ }
}

/**
 * UXEvent 소비 deps — 승인/거부는 공유 write(멱등·비가역 안전). 동적 액션은 apm-* 콜백과 **동일 공유
 * 실처리 함수**(spawnMissionPrepare·rebuildCritiquedPhases)를 재사용해 배선 + origin 통지 + 관측.
 * approve → approveMission(실행 시작·PWA/CLI 동일 경로) · reject → cancelMission(defer=보류).
 */
export function defaultUxConsumerDeps(): UxEventConsumerDeps {
  return {
    approve: (missionId) => { void approveMission(missionId).catch(() => { /* 멱등·fail-soft */ }); },
    reject: (missionId) => { void cancelMission(missionId, { defer: true }).catch(() => { /* fail-soft */ }); },
    action: (missionId, optionId) => { handleUxDynamicAction(missionId, optionId); },
    clarifyAnswer: (missionId, flowState, optionId) => { debug.log('ux.clarify', 'answer', { missionId, flowState, optionId }); },
    clarifyEdit: (missionId, flowState) => { debug.log('ux.clarify', 'edit', { missionId, flowState }); },
  };
}

/**
 * ★ 동적 액션 실처리 라우터(대표 2026-07-21·빌더↔처리 이원화 수복) — ux-dynamic-builder 가 낸 choice
 * 버튼을 실집행에 연결한다. 종전엔 accept-redesign 만 배선되고 나머지는 debug.log 관측만이라 [🔁 좁혀
 * 재분해] 를 눌러도 State 전이·spawn·통지가 전무했다(미션 proposed 고정). 공유 실처리 함수 재사용(중복 0):
 *  - redecompose / redecompose-arc / descope / redecompose-opus → spawnMissionPrepare(forceDecompose·
 *    comment=pending-redecompose 반영) [apm-* redecompose 경로와 동일 spawn]
 *  - accept-redesign → spawnMissionPrepare(redesign·pending-redesign) [CC3 기존 배선 보존]
 *  - apply-heal → rebuildCritiquedPhases(진단 힐 재구현 재개) [mission-lifecycle 공유]
 *  - arc-surgery / dep-mission → 페이즈 컨텍스트/기존 실처리 부재로 관측만(후속 배선)
 * 각 실처리 시 origin 통지(재분해 시작 무통지 수복) + debug.log 전이 관측(상태 소유 갭 대응). fail-soft.
 */
export function handleUxDynamicAction(missionId: string, optionId: string): void {
  debug.log('ux.action', optionId, { missionId });
  try {
    switch (optionId) {
      // ★ CC3(대표 2026-07-20) — 역제안 수용: pending-redesign 을 reviseContext 로 재분해 재-spawn.
      case 'accept-redesign': {
        const comment = readPendingRedesign(missionId)?.comment ?? '골 리디자인 역제안대로 미션을 재구성하라.';
        spawnMissionPrepare(missionId, { forceDecompose: true, comment, redesign: true }); // H5 — research 캐시 무효(전제 전환)
        clearPendingRedesign(missionId);
        debug.log('ux.action', 'accept-redesign-applied', { missionId });
        notifyUxAction(missionId, '🔀 역제안을 수용해 미션을 재구성합니다 — 완료 시 새 승인 카드가 옵니다.');
        return;
      }
      // ★ 최우선(대표 2026-07-21·막힌 것) — 게이팅 지적(mirage/치명)을 반영해 좁혀 재분해. redesign 미지정
      //   (전제 유지=좁혀). taps 예산은 기존 pending-redecompose 흐름이 보존(prepare 재-spawn 이 승계).
      case 'redecompose': {
        const comment = readPendingRedecompose(missionId)?.comment ?? '분해 게이팅 지적(mirage/치명)을 반영해 좁혀 재분해하라.';
        spawnMissionPrepare(missionId, { forceDecompose: true, comment });
        debug.log('ux.action', 'redecompose-respawn', { missionId });
        notifyUxAction(missionId, '🔁 좁혀 재분해를 시작합니다 — 게이팅 지적을 반영해 재구성하며, 완료 시 새 승인 카드가 옵니다.');
        return;
      }
      // ★ S7 교착(deadlock) 탈출 — 아크 재분해·접근 전환. 공유 spawn 재사용(전제 유지·좁혀).
      case 'redecompose-arc': {
        const comment = readPendingRedecompose(missionId)?.comment ?? '교착(진전 없음)을 벗어나도록 아크를 재분해하고 접근을 전환하라.';
        spawnMissionPrepare(missionId, { forceDecompose: true, comment });
        debug.log('ux.action', 'redecompose-arc-respawn', { missionId });
        notifyUxAction(missionId, '🔄 아크 재분해(교착 탈출)를 시작합니다 — 완료 시 새 승인 카드가 옵니다.');
        return;
      }
      // ★ 범위 초과(scopeExceeded) — 벗어난 기능 제외하고 핵심만 좁혀 재분해(발산 방지). 공유 spawn 재사용.
      case 'descope': {
        const comment = readPendingRedecompose(missionId)?.comment ?? '범위를 벗어난 기능을 제외하고 핵심만 좁혀 재분해하라.';
        spawnMissionPrepare(missionId, { forceDecompose: true, comment });
        debug.log('ux.action', 'descope-respawn', { missionId });
        notifyUxAction(missionId, '✂️ 벗어난 기능을 제외하고 재분해합니다 — 완료 시 새 승인 카드가 옵니다.');
        return;
      }
      // ★ 치명 다수 — 강력 모델(Opus)로 재분해(apm-* redecompose-opus 와 동일 모델 전환). 공유 spawn 재사용.
      case 'redecompose-opus': {
        const comment = readPendingRedecompose(missionId)?.comment ?? '치명 다수 — 강력 모델로 게이팅 지적을 반영해 재분해하라.';
        spawnMissionPrepare(missionId, { forceDecompose: true, comment, decomposeModel: DECOMPOSE_OPUS_MODEL });
        debug.log('ux.action', 'redecompose-opus-respawn', { missionId, model: DECOMPOSE_OPUS_MODEL });
        notifyUxAction(missionId, `🧠 Opus(${DECOMPOSE_OPUS_MODEL}·유료)로 재분해를 시작합니다 — 강력 모델이 게이팅 지적을 반영하며, 완료 시 새 승인 카드가 옵니다.`);
        return;
      }
      // ★ 진단 힐 적용(apply-heal·대표 2026-07-21) — 비평 지적 페이즈를 재구현 재개(rebuildCritiquedPhases
      //   공유·mission-lifecycle). 지적 페이즈가 없으면(clean/실행중) fail-soft 관측 후 종료.
      case 'apply-heal': {
        const r = rebuildCritiquedPhases(missionId);
        debug.log('ux.action', 'apply-heal-applied', { missionId, ok: r.ok, rebuilt: r.rebuilt, ...(r.error ? { error: r.error } : {}) });
        if (r.ok) {
          notifyUxAction(missionId, `🔧 진단 힐을 적용해 ${r.rebuilt}개 페이즈를 재구현 재개합니다 — 완료 시 새 알림이 옵니다.`);
        } else {
          notifyUxAction(missionId, `🔧 진단 힐 적용 불가: ${r.error ?? '대상 페이즈 없음'} — 재분해/직접입력을 대신 시도하세요.`);
        }
        return;
      }
      // ★ P5a(대표 2026-07-21) — arc-surgery(S3 in-flight 수술) 실집행. UX 카드에 phaseId 미배선이라
      //   store 에서 최근 실패 subagent 페이즈를 조회(견고)해 splitPhaseIntoSubphases(기존 공유·재spawn
      //   내장=defaultSpawnRunMission)로 국소 재분해 수술. 아크 수준 재구조화(insert/delete arc)는 조율자
      //   판정 경로(P5b/c). sync 핸들러라 fire-and-forget. (아크 merge/reorder 등 자유 편집은 P5 후속.)
      case 'arc-surgery': {
        void (async () => {
          try {
            const { TaskStore } = await import('../task-orchestrator/store.js');
            const store = new TaskStore();
            let targetPhaseId: string | null = null;
            try {
              const failed = store.listTasks({ goalSlug: missionId })
                .filter((t) => t.status === 'failed' && t.surface.kind === 'subagent')
                .sort((a, b) => b.createdAt - a.createdAt);
              targetPhaseId = failed[0]?.id ?? null;
            } finally { store.close(); }
            if (!targetPhaseId) {
              debug.log('ux.action', 'arc-surgery-no-target', { missionId });
              notifyUxAction(missionId, '🔪 아크 수술 불가 — 수술 대상(실패 페이즈)이 없습니다. 재분해/직접입력을 시도하세요.');
              return;
            }
            const { splitPhaseIntoSubphases } = await import('./mission-phase-split.js');
            const r = await splitPhaseIntoSubphases(missionId, targetPhaseId);
            debug.log('ux.action', 'arc-surgery-applied', { missionId, phaseId: targetPhaseId, ok: r.ok, subPhases: r.subPhaseCount, ...(r.error ? { error: r.error } : {}) });
            notifyUxAction(missionId, r.ok
              ? `🔪 아크 수술 — 실패 페이즈를 ${r.subPhaseCount}개 서브페이즈로 재분해하고 재개합니다. 완료 시 새 알림이 옵니다.`
              : `🔪 아크 수술 불가: ${r.error ?? '분할 실패'} — 재분해/직접입력을 시도하세요.`);
          } catch (e) {
            debug.log('ux.action', 'arc-surgery-error', { missionId, error: e instanceof Error ? e.message : String(e) }, { level: 'error' });
          }
        })();
        return;
      }
      // dep-mission(S2 의존 미션): 의존 미션 생성 로직 미구현(후속). 관측만.
      case 'dep-mission': {
        debug.log('ux.action', 'dep-mission-unwired', { missionId, reason: 'no dep-mission impl (follow-up)' });
        return;
      }
      // ★ P3(대표 2026-07-21) — 자율 종결(P2) 수용. 미션은 이미 terminal(done/failed)이라 실행 없음(관측만·
      //   카드 닫힘). 재개는 redecompose 버튼(위 wired)으로. acknowledge = 대표가 종결을 확인·수용한 기록.
      case 'acknowledge': {
        debug.log('ux.action', 'stuck-resolution-acknowledged', { missionId });
        return;
      }
      default: {
        // revise-goal·edit(kind:edit·직접입력 경로) 등 — action 라우팅 대상 아님(freeform 경로). 관측만.
        debug.log('ux.action', 'unhandled', { missionId, optionId });
        return;
      }
    }
  } catch (e) {
    debug.log('ux.action', 'error', { missionId, optionId, error: e instanceof Error ? e.message : String(e) }, { level: 'error' });
  }
}

/**
 * 발행 — HITL 승인 카드를 UXIntent(동적 액션·Phase 1 빌더)로 렌더. notifyMissionHitl 의 opt-in 대체.
 * 반환 = 첫 메시지 id(기존 notifyMissionHitl 반환 계약 호환). fail-soft(null).
 */
export function notifyMissionHitlViaUx(
  origin: MissionOrigin, missionId: string, text: string, opts: { criticalCount?: number; signals?: Record<string, unknown> } = {},
): number | null {
  const token = resolveTelegramBotToken(origin.botId);
  if (!token || origin.chatId === undefined) return null;
  const intent = approvalToUXIntent(missionId, {
    prompt: text, approveLabel: '✅ 승인(실행 시작)', rejectLabel: '⏸️ 보류',
    ...(opts.criticalCount !== undefined ? { criticalCount: opts.criticalCount } : {}),
    surface: { source: 'telegram', target: String(origin.chatId) },
  });
  // ★ 동적 액션(Phase 1) — signals 기반으로 옵션을 상황화(승인/보류 + 치명/실패/범위 신호 반영).
  // ★ CC2(RFC-general-coordinator-custom-contracts §3d) — 실행 적응 시나리오 신호(arcSurgery·
  //   blockedDependency·phaseFailed)를 context 에 병합해 재구성 선택지를 상황화(opts.signals).
  const ctx = opts.signals
    ? { ...intent.context, signals: { ...intent.context.signals, ...opts.signals } }
    : intent.context;
  const richIntent: UXIntent = { ...intent, context: ctx, options: buildContextualActions(ctx) };
  const result = emitUxIntentToTelegram(
    richIntent,
    { chatId: origin.chatId, token: hitlToken(missionId), ...(origin.threadId !== undefined ? { threadId: origin.threadId } : {}) },
    {
      sendButtons: (chatId, txt, buttons, threadId) => sendTelegramButtonsTo(token, chatId, txt, buttons, threadId),
      sendForceReply: (chatId, txt, threadId) => sendForceReplyTo(token, chatId, txt, threadId),
      sendText: (chatId, txt, threadId) => sendTelegramTo(token, chatId, txt, threadId),
    },
  );
  return result?.messageIds?.[0] ?? null;
}

/**
 * 수신(콜백) — 'ux:' 접두 콜백이면 처리하고 true(우리 것). 아니면 false(기존 핸들러로 넘김·무간섭).
 * flowState 는 현재 승인 카드(hitl:approve-plan). clarify 라이브는 후속.
 */
export function handleUxCallback(data: string, deps: UxEventConsumerDeps): boolean {
  if (!data.startsWith('ux:')) return false;
  const parsed = parseUxCallbackData(data);
  if (parsed) {
    const missionId = resolveMissionByHitlToken(parsed.token);
    if (missionId) {
      const event = normalizeTelegramCallback(data, missionId, 'hitl:approve-plan');
      if (event) handleUxEvent(event, deps);
    }
  }
  return true; // 'ux:' 는 우리 것(파싱 실패해도 소비)
}

/** 수신(리액션) — 카드 맵에서 intent 역추적(messageId→missionId·flowState) 후 UXEvent 소비. */
export function handleUxReactionUpdate(messageId: number, reaction: TgMessageReactionLike, deps: UxEventConsumerDeps): void {
  const event = resolveReactionEvent(messageId, reaction);
  if (event) handleUxEvent(event, deps);
}
