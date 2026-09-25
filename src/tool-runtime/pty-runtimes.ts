// ── PtyShell* runtimes — the first migrated clients ──
//
// Wraps the existing skill-tool-pty dispatchers in the ToolRuntime
// shape. Adds nothing behavior-wise — the approval / requireApproval
// logic still lives in dispatchPtyShellStart. The wrapper exists so
// dashboard (and future MCP exports) can call one API:
//
//   dispatchToolByName('PtyShellStart', args, { surface: 'dashboard',
//     requireApproval: true });
//
// instead of knowing the dispatcher's exact name + opts shape.

import {
  buildPtyShellKillTool,
  buildPtyShellListTool,
  buildPtyShellPollTool,
  buildPtyShellSendTool,
  buildPtyShellStartTool,
  dispatchPtyShellKill,
  dispatchPtyShellList,
  dispatchPtyShellPoll,
  dispatchPtyShellSend,
  dispatchPtyShellStart,
} from '../skills/tools/pty.js';
import type { ToolRuntime, ToolRuntimeContext } from './types.js';

type Args = Record<string, unknown>;
type Out = { output: string };

const productionPtyRuntimeDispatchers = {
  start: dispatchPtyShellStart,
  poll: dispatchPtyShellPoll,
  send: dispatchPtyShellSend,
  kill: dispatchPtyShellKill,
  list: dispatchPtyShellList,
} as const;

let ptyRuntimeDispatchers = productionPtyRuntimeDispatchers;

/** Test seam: preserve each real ToolRuntime `run()` wrapper while replacing
 * only the process/I/O dispatcher beneath it. Returns a restoration closure
 * so a test cannot leak fake PTY I/O into another runtime test. */
/** ⚠️ 테스트 전용 전역 주입. 겹친 주입은 **조용히 덮지 않고 던진다** — 전역 상태라
 *  동시 사용은 서로의 PTY dispatch 를 오염시키는데, 그 오염은 *다른* 테스트를 실패시켜
 *  원인을 못 찾게 만든다. ⇒ 조용한 오염을 **큰 실패**로 바꾼다(주석만으로는 안 막힌다).
 *  ⛔ 이 가드가 걸리면 병렬을 줄이지 말고 **테스트 전용 주입 경로로 격리**하라. */
export function setPtyRuntimeDispatchersForTest(
  overrides: Partial<typeof productionPtyRuntimeDispatchers>,
): () => void {
  if (ptyRuntimeDispatchers !== productionPtyRuntimeDispatchers) {
    throw new Error(
      'setPtyRuntimeDispatchersForTest: 이미 주입돼 있다 — 이전 주입의 restore() 를 먼저 부르거나, '
      + '동시 사용이라면 전역 대신 테스트 전용 주입 경로로 격리하라.',
    );
  }
  ptyRuntimeDispatchers = { ...productionPtyRuntimeDispatchers, ...overrides };
  return () => { ptyRuntimeDispatchers = productionPtyRuntimeDispatchers; };
}

export const ptyStartRuntime: ToolRuntime<Args, Out> = {
  id: 'pty_shell_start',
  spec: buildPtyShellStartTool(),
  async run(req, ctx: ToolRuntimeContext): Promise<Out> {
    // 자율 코딩 에이전트 정합(2026-07-17): dashboard(=essential TUI) 도
    // auto-approve 가 기본. 사용자가 REPL/dev server 를 명시 요청한 자율
    // 루프에서 PtyShell HITL 은 (1) redundant — 요청이 곧 의도 (2) 터미널
    // HITL 응답자 부재 시 아이폰(Pushcut/Telegram) 라우팅으로 turn hang.
    // Bash(dashboard·HITL 없음·sandbox 만)·SpawnCodingAgentHeadless
    // (requireApproval:false)와 일관. 안전은 sandbox·auto-kill-on-return·
    // max8 concurrent·audit-log. 명시 ctx.requireApproval 은 여전히 존중.
    const requireApproval = ctx.requireApproval ?? false;
    return ptyRuntimeDispatchers.start(req, {
      requireApproval,
      approver: ctx.approver,
      // L1 self-dev — when a required approval has no responder (headless
      // autonomous coding), fail-OPEN (proceed) instead of hang→reject.
      // Coding-tool-scoped: only PtyShell forwards this. Default false.
      ...(ctx.failOpen ? { failOpen: true } : {}),
    });
  },
};

export const ptyPollRuntime: ToolRuntime<Args, Out> = {
  id: 'pty_shell_poll',
  spec: buildPtyShellPollTool(),
  async run(req) {
    return ptyRuntimeDispatchers.poll(req);
  },
};

export const ptySendRuntime: ToolRuntime<Args, Out> = {
  id: 'pty_shell_send',
  spec: buildPtyShellSendTool(),
  async run(req) {
    return ptyRuntimeDispatchers.send(req);
  },
};

export const ptyKillRuntime: ToolRuntime<Args, Out> = {
  id: 'pty_shell_kill',
  spec: buildPtyShellKillTool(),
  async run(req) {
    return ptyRuntimeDispatchers.kill(req);
  },
};

export const ptyListRuntime: ToolRuntime<Args, Out> = {
  id: 'pty_shell_list',
  spec: buildPtyShellListTool(),
  async run() {
    return ptyRuntimeDispatchers.list();
  },
};

export const PTY_RUNTIMES = [
  ptyStartRuntime,
  ptyPollRuntime,
  ptySendRuntime,
  ptyKillRuntime,
  ptyListRuntime,
] as const;
