/**
 * resolveChatSessionSync — 탭 ↔ 전역 세션 동기화 방향 판별 (2026-07-13).
 *
 * 버그 맥락: attach(updateChatTab)가 탭 상태만 바꾸고 전역 daemon 세션은
 * 그대로라 pill/대화가 이전 세션에 머물던 선재 이슈(P5 self-검증 실측 —
 * 기존 목록-행 attach 경로도 동일 재현). 시나리오별 방향과 수렴(핑퐁 없음)
 * 을 검증한다.
 */
import { describe, expect, it } from 'bun:test';

import { resolveChatSessionSync } from './session-sync';

const base = {
  isActive: true,
  tabSessionId: 'tab-A',
  daemonSessionId: 'tab-A',
  prevTabSessionId: 'tab-A',
  prevDaemonSessionId: 'tab-A',
};

describe('resolveChatSessionSync', () => {
  it('일치 상태 → none (아무 개입 없음)', () => {
    expect(resolveChatSessionSync(base)).toBe('none');
  });

  it('비활성 패널은 값이 달라도 절대 개입하지 않는다', () => {
    expect(resolveChatSessionSync({
      ...base, isActive: false, tabSessionId: 'tab-B',
    })).toBe('none');
  });

  it('attach — 탭 세션이 방금 변함 → adopt-tab (전역이 탭을 따라감)', () => {
    expect(resolveChatSessionSync({
      ...base,
      tabSessionId: 'attached-C',
      prevTabSessionId: 'tab-A',   // 탭이 A→C 로 변경됨
      daemonSessionId: 'tab-A',
      prevDaemonSessionId: 'tab-A',
    })).toBe('adopt-tab');
  });

  it('탭 활성 전환/초기 마운트 — 양쪽 다 안 변했는데 다름 → adopt-tab (탭 소유)', () => {
    expect(resolveChatSessionSync({
      ...base,
      tabSessionId: 'tab-B',
      prevTabSessionId: 'tab-B',
      daemonSessionId: 'tab-A',
      prevDaemonSessionId: 'tab-A',
    })).toBe('adopt-tab');
  });

  it('ChatLayout 내부 전환(fork 버튼·ACP adoption) — 전역만 변함 → record-global (탭에 역기록)', () => {
    expect(resolveChatSessionSync({
      ...base,
      tabSessionId: 'tab-A',
      prevTabSessionId: 'tab-A',
      daemonSessionId: 'forked-D',
      prevDaemonSessionId: 'tab-A',
    })).toBe('record-global');
  });

  it('수렴 — adopt-tab 적용 후 다음 사이클은 none (핑퐁 없음)', () => {
    // attach 로 adopt-tab 발동 → setSessionId('attached-C') 반영된 다음 사이클
    expect(resolveChatSessionSync({
      isActive: true,
      tabSessionId: 'attached-C',
      prevTabSessionId: 'attached-C',
      daemonSessionId: 'attached-C',
      prevDaemonSessionId: 'tab-A',   // 전역이 방금 변했지만 이미 일치
    })).toBe('none');
  });

  it('수렴 — record-global 적용 후 다음 사이클은 none', () => {
    // 전역 fork → 탭에 기록된 다음 사이클: 탭이 방금 변했지만 이미 일치
    expect(resolveChatSessionSync({
      isActive: true,
      tabSessionId: 'forked-D',
      prevTabSessionId: 'tab-A',
      daemonSessionId: 'forked-D',
      prevDaemonSessionId: 'forked-D',
    })).toBe('none');
  });

  it('동시 변경(탭·전역 둘 다) — 탭 우선 (사용자 명시 attach 가 이김)', () => {
    expect(resolveChatSessionSync({
      isActive: true,
      tabSessionId: 'attached-C',
      prevTabSessionId: 'tab-A',
      daemonSessionId: 'forked-D',
      prevDaemonSessionId: 'tab-A',
    })).toBe('adopt-tab');
  });
});
