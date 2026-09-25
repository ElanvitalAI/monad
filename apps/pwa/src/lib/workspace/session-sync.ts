// ── 워크스페이스 chat 탭 ↔ 전역 daemon 세션 동기화 방향 판별 (2026-07-13) ──
//
// 배경: ChatLayout 은 전역 `useDaemon().sessionId` 를 렌더하고, 워크스페이스
// 탭은 자체 `tab.sessionId` 를 기록한다. 둘을 잇는 배선이 없어 "다른 세션
// attach"(updateChatTab)가 탭 상태만 바꾸고 화면(pill·대화)은 이전 세션에
// 머무는 버그가 있었다 (P5 self-검증에서 실측 — 기존 목록-행 attach 경로도
// 동일 재현). 본 판별기가 활성 탭에 한해 두 값을 수렴시킨다.
//
// 방향 규칙 — "어느 쪽이 방금 변했나"로 소유권 판정:
//   · 탭 쪽이 변함(attach) 또는 아무 쪽도 안 변함(탭 활성 전환·초기 마운트)
//     → 탭이 전역을 소유: adopt-tab (setSessionId)
//   · 전역만 변함(ChatLayout 내부 전환 — fork 버튼·ACP handshake adoption)
//     → 탭에 기록: record-global (updateChatTab)
// 양방향 모두 "다르면 한 번"이라 한 사이클 내 수렴 — 핑퐁 없음.

export type ChatSessionSyncAction = 'adopt-tab' | 'record-global' | 'none';

export function resolveChatSessionSync(input: {
  /** 이 패널의 탭이 워크스페이스 활성 탭인가 — 비활성 패널은 절대 개입 금지. */
  isActive: boolean;
  tabSessionId: string;
  daemonSessionId: string;
  prevTabSessionId: string;
  prevDaemonSessionId: string;
}): ChatSessionSyncAction {
  if (!input.isActive) return 'none';
  if (input.tabSessionId === input.daemonSessionId) return 'none';
  const tabChanged = input.prevTabSessionId !== input.tabSessionId;
  const daemonChanged = input.prevDaemonSessionId !== input.daemonSessionId;
  if (tabChanged || !daemonChanged) return 'adopt-tab';
  return 'record-global';
}
