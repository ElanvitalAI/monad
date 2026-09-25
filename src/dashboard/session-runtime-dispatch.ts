import { debug } from '../debug/log.js';
import {
  dispatchSessionRuntimeTool,
  type SessionRuntimeDispatchDeps,
} from '../session-runtime/index.js';
import { createDashboardSessionRuntimeFeedback } from './session-runtime-feedback.js';

export interface DashboardSessionRuntimeDispatchDeps
  extends Omit<SessionRuntimeDispatchDeps, 'emitFeedback' | 'userText'> {
  contextUserText?: string;
  turnRefUserText: string | null;
  muted(line: string): string;
  pushChatLine(line: string): void;
  draw(): void;
}

export async function dispatchDashboardSessionRuntimeTool(
  name: string,
  args: Record<string, unknown>,
  deps: DashboardSessionRuntimeDispatchDeps,
): Promise<unknown> {
  const userText = deps.contextUserText ?? deps.turnRefUserText ?? undefined;
  const userTextSource = deps.contextUserText != null
    ? 'context'
    : deps.turnRefUserText !== null
      ? 'turn-ref'
      : 'absent';
  // ⛔ 관측이 디스패치를 «막지 않는다» — 원본 호출부가 이 try/catch 를 달고 있었고
  //    (*"Observability must not prevent the session runtime tool dispatch."*),
  //    helper 로 옮기면서 그것이 빠졌다(무인 리뷰 R3 must-fix ③ · 정확한 지적).
  try {
    debug.log('dashboard.session-runtime-dispatch', 'user-text-provenance', {
      contextUserTextPresent: deps.contextUserText !== undefined,
      contextUserTextLength: deps.contextUserText?.length ?? 0,
      turnRefUserTextPresent: deps.turnRefUserText !== null,
      turnRefUserTextLength: deps.turnRefUserText?.length ?? 0,
      userTextSource,
    });
  } catch {
    // Observability must not prevent the session runtime tool dispatch.
  }

  const {
    contextUserText: _contextUserText,
    turnRefUserText: _turnRefUserText,
    muted,
    pushChatLine,
    draw,
    ...runtimeDeps
  } = deps;
  return dispatchSessionRuntimeTool(name, args, {
    ...runtimeDeps,
    userText,
    emitFeedback: createDashboardSessionRuntimeFeedback({
      muted,
      pushChatLine,
      draw,
      // ⛔ 같은 이유로 렌더 관측도 «비차단»이다 — 이 로그가 던지면 진행 줄이 통째로 사라진다.
      observe: (renderState, data) => {
        try {
          debug.log('dashboard.session-runtime-feedback', 'received', {
            ...data,
            renderState,
          });
        } catch {
          // Observability must not prevent the progress line from rendering.
        }
      },
    }),
  });
}
