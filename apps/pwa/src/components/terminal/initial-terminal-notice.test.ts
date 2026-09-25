// 초기 발급 문면의 «네 갈래» — 실패 경로를 포함해 전부 태운다.
// ⛔ 이 파일이 있는 이유: 렌더 «안»에 문면이 있으면 실패 경로를 SSR 계약으로 원리상 못 잡는다
//    (무인 리뷰 must-fix · 2026-08-18 `#10105`).

import { describe, expect, test } from 'bun:test';

import { initialTerminalNotice } from './initial-terminal-notice';

describe('initialTerminalNotice', () => {
  test('이름을 기다리는 동안에는 준비 중 문면만 낸다 — 경고는 없다', () => {
    const notice = initialTerminalNotice({ status: 'pending' }, false);
    expect(notice.placeholder).toBe('터미널 이름을 준비하는 중…');
    expect(notice.fallbackBanner).toBeNull();
  });

  test('데몬이 이름을 주면 준비 문면도 경고도 없다', () => {
    const notice = initialTerminalNotice({ status: 'ready', issuedBy: 'daemon' }, true);
    expect(notice.placeholder).toBeNull();
    expect(notice.fallbackBanner).toBeNull();
  });

  test('로컬로 내려가면 «사유를 이름 대고» 경고한다 — 침묵하지 않는다', () => {
    const notice = initialTerminalNotice(
      { status: 'ready', issuedBy: 'local', fallbackReason: 'no-response' },
      true,
    );
    expect(notice.fallbackBanner).toContain('no-response');
    expect(notice.fallbackBanner).toContain('데몬 발급을 확인하지 못했습니다.');
  });

  test('사유가 «없으면» 사유를 지어내지 않는다 — 「모름」을 값으로 남긴다', () => {
    const notice = initialTerminalNotice({ status: 'ready', issuedBy: 'local' }, true);
    // ⛔ 종전에는 `daemon-unavailable` 이라 «단정»했다. 확인 안 한 사유였다.
    expect(notice.fallbackBanner).not.toContain('daemon-unavailable');
    expect(notice.fallbackBanner).toContain('사유 미상');
  });

  test('저장된 탭을 그대로 쓴 것은 폴백이 아니므로 경고하지 않는다', () => {
    const notice = initialTerminalNotice(
      { status: 'ready', issuedBy: 'local', fallbackReason: 'restored-tab' },
      true,
    );
    expect(notice.fallbackBanner).toBeNull();
    expect(notice.placeholder).toBeNull();
  });

  test('이름이 아직 없는데 로컬 폴백이면 준비 문면이 «그 사유»를 싣는다', () => {
    const notice = initialTerminalNotice(
      { status: 'ready', issuedBy: 'local', fallbackReason: 'response-without-terminal-id' },
      false,
    );
    expect(notice.placeholder).toContain('response-without-terminal-id');
  });
});
