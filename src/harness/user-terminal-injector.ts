// relay 재주입을 사용자 실 터미널로 — §9 terminal-forwarder 융합 (④ · 2026-07-20)
//
// DESIGN-cross-surface-autonomy-membrane §9. 셸 relay 의 재주입 seam(ShellInjector)은 기본
// 헤드리스 PtyShell(dispatchPtyShellSend)로 쓴다. 하지만 사용자가 SwiftTerm/PreviewTerminal
// 에서 codex/aider 를 직접 보고 있을 땐, relay 답을 **그 실 터미널**로 주입해야 operator 가
// 자기 화면에서 결과를 본다. terminal-forwarder(§9 예전 결과물·autopilot 키스트로크 포워딩)를
// relay 막의 injector 로 재사용해 "relay → 사용자 터미널" 경로를 하나로 융합한다.
//
// 이건 §9 흡수의 **주입 측 반쪽**(감지 측 = detectShellPrompt). 새 기계장치 아님 — 기존
// forwardToUserTerminal 을 ShellInjector 형태로 감싼 어댑터(additive·기본 injector 무변).
//
// ★ 제1원칙: 전달 성공/실패는 forwardToUserTerminal 이 audit(autopilot.terminal-forwarder)로
//   이미 남긴다. 어댑터는 ForwardResult→ShellInjectResult 로만 매핑(fail-soft: 미전달=ok:false).

import type { ShellInjector } from './shell-relay.js';
import {
  forwardToUserTerminal,
  type ForwardInput,
  type ForwardResult,
  type ForwardSource,
} from '../autopilot/terminal-forwarder.js';

export interface UserTerminalInjectorConfig {
  /** 대상 세션(ACP sessionId — relay 를 구동하는 세션). */
  sessionId: string;
  /** 대상 SwiftTerm/PreviewTerminal id. */
  terminalId: string;
  /** audit 마커(기본 'autopilot' — relay 는 자율 드라이브 계열). */
  source?: ForwardSource;
  /** 포워딩 함수 override(테스트/대체 전송). 기본 forwardToUserTerminal. */
  forward?: (input: ForwardInput) => ForwardResult;
}

/**
 * relay 재주입을 사용자 PreviewTerminal 로 보내는 ShellInjector 를 만든다.
 * shellId 는 origin 라벨로만 쓰인다(포워딩 대상은 config 의 terminalId).
 * 미전달(unknown_terminal 등)은 throw 대신 ok:false — relay 가 fail-soft 로 흡수.
 */
export function userTerminalInjector(cfg: UserTerminalInjectorConfig): ShellInjector {
  const forward = cfg.forward ?? forwardToUserTerminal;
  return async ({ shellId, bytes }) => {
    const r = forward({
      sessionId: cfg.sessionId,
      terminalId: cfg.terminalId,
      data: bytes,
      source: cfg.source ?? 'autopilot',
      origin: `relay:${shellId}`,
    });
    return r.delivered ? { ok: true } : { ok: false, error: r.reason ?? 'not-delivered' };
  };
}
