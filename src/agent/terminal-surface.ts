// PLAN-multi-surface-pty-shell M1 — shared terminal-surface layer.
//
// Telegram proved four surface adapters are what turn "PtyShell is
// exposed" into "PtyShell actually works as a mission surface":
//   ① budgetGrant     — the tool loop earns extra rounds ONLY while a
//                       PtyShell-family tool is being dispatched.
//   ② cancel→PTY      — aborting the turn kills non-detached headless
//                       PTYs (detached ones survive by design).
//   ③ _imageFile      — a tool result carrying an `_imageFile` pointer
//                       (e.g. PtyShellScreenshot) is delivered through
//                       the surface's FileSink as an inline image; the
//                       LLM sees only the text output.
//   ④ discipline      — the [터미널 미션 규율] system-prompt block that
//                       keeps multi-step missions in ONE PtyShell
//                       session instead of scattered Bash calls.
//
// This module is the single source for all four, in the same spirit as
// `core-tools.ts` for the L2 tool catalog: a self-turn assembler passes
// its base pieces through `buildTerminalCapableTurn` and gets the
// terminal-capable versions back. Surface-agnostic and headless — no
// telegram / discord / dashboard imports (the FileSink seam carries the
// per-surface image channel).

import type { LLMOpts, LLMToolSpec } from '../llm.js';
import type { FileSink } from '../channel/file-sink.js';
import { PTY_SHELL_TOOL_NAMES } from '../boot/daemon-tools/pty-shell.js';
import { killNonDetached as killNonDetachedPty } from '../pty-shell/registry.js';

/** ① Conditional tool-budget grant for driving a headless terminal /
 *  coding agent. Keeps the tight per-family cap for ordinary turns
 *  (codex's re-read pathology brake stays intact) while spawn→snapshot→
 *  send→poll loops earn extra rounds up to the ceiling. Activates ONLY
 *  when one of these tools is actually dispatched (llm.ts budgetGrant
 *  hook). Applies across providers. */
export const PTY_BUDGET_GRANT: NonNullable<LLMOpts['budgetGrant']> = {
  tools: PTY_SHELL_TOOL_NAMES,
  perCall: 6,
  ceiling: 60,
};

/** ④ Surface-agnostic terminal mission discipline (extracted verbatim
 *  from the telegram agent's monadSelfAccessPrompt, 2026-07-12). Joined
 *  into the system prompt of every terminal-capable self turn. */
export const TERMINAL_MISSION_DISCIPLINE = [
  '[터미널 미션 규율]',
  '- 여러 단계가 얽힌 터미널/빌드/실행/설치 미션은 흩어진 Bash 호출로 쪼개지 말고 "하나의 PtyShell',
  '  세션"에서 처리하라: PtyShellStart 로 셸을 한 번 열고(cd 로 작업폴더 이동) → 파일 작성·설치·',
  '  서버 기동·테스트를 모두 그 세션에서 → PtyShellPoll/PtyShellSnapshot 으로 결과를 눈으로 확인하며',
  '  진행. 관측·취소·화면캡처가 되는 하나의 흐름이 된다. 거대한 Bash 한 방 스크립트로 흩뿌리지 마라.',
  '- Bash 는 진짜 단발성 한 줄(ls·cat·quick check)에만. 지속/인터랙티브/서버/watch/화면 필요 시 PtyShell.',
  '- "화면 보여줘·캡처·스크린샷·show" 요청은 PtyShellScreenshot 으로 그 세션 화면을 PNG 이미지로 첨부하라',
  '  (텍스트 파일 저장이나 chafa 같은 ad-hoc 뷰어로 대체하지 마라 — 사용자는 이미지를 원한다).',
  '- 미션이 끝나면 중간 로그·스크립트를 그대로 나열하지 말고, 결과를 한 번에 정리한 요약 하나로 답하라.',
].join('\n');

/** Media type for an image file path by extension. PtyShellScreenshot
 *  emits PNG; jpeg kept for future capture tools. */
function imageMediaType(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}

/** Dispatcher shape shared by the self-turn assemblers (telegram's
 *  per-turn closure, daemon dispatchers). Extra args beyond (name,
 *  args) — e.g. runCoreTurn's dispatch ctx `{callId, sessionId, …}` —
 *  are surface-specific: the wrapper forwards them verbatim and never
 *  inspects them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any — passthrough
// variadic: `any[]` is the only shape assignable BOTH from narrower
// dispatchers ((name, args) or (name, args, ctx?: DaemonCtx)) and TO
// consumer contracts (CoreTurnDispatchTool) under strictFunctionTypes.
export type TerminalTurnDispatch = (
  name: string,
  args: Record<string, unknown>,
  ...rest: any[]
) => Promise<unknown>;

export interface TerminalCapableBase {
  /** Tool catalog — passed through verbatim today (every self-turn
   *  surface already inherits the PtyShell specs via its tool builder);
   *  kept in the contract so a surface lacking them can be topped up
   *  here later without changing consumers. */
  specs: LLMToolSpec[];
  /** The surface's fully-assembled dispatcher (delegation branches and
   *  all) — wrapped with the ③ `_imageFile` intercept. */
  dispatch: TerminalTurnDispatch;
  /** System-prompt parts; ④ TERMINAL_MISSION_DISCIPLINE is appended.
   *  Caller joins (telegram uses '\n\n'). */
  systemPromptParts: string[];
  /** llmOpts to receive ① PTY_BUDGET_GRANT. */
  llmOpts?: LLMOpts;
  /** Turn abort signal — ② on first abort, non-detached PTYs die.
   *  Absent ⇒ no cancel wiring (surface has no cancel affordance). */
  signal?: AbortSignal;
  /** Surface image channel for ③. Absent (or without sendImage) ⇒ the
   *  image is dropped and the LLM still gets the text output — unless
   *  `inlineImages` is set. */
  fileSink?: FileSink;
  /** ③ daemon-path variant (PLAN M2): no side-channel sink exists, but
   *  the surface understands the image-bearing result convention
   *  (`{mediaType, dataB64}` — `maybeImageBearingResult` in llm.ts).
   *  When set (and no fileSink handled the image), `_imageFile` results
   *  are converted to inline base64 bytes, so (a) daemon-prompt-turn's
   *  onImageBlock forwards them to PWA/iOS/Android clients, and (b)
   *  vision-capable LLMs can SEE the captured screen. */
  inlineImages?: boolean;
}

const TERMINAL_CAPABLE_TURN_BRAND = Symbol('monad.terminal-capable-turn');

export interface TerminalCapableTurn {
  specs: LLMToolSpec[];
  dispatch: TerminalTurnDispatch;
  systemPromptParts: string[];
  llmOpts: LLMOpts;
  readonly [TERMINAL_CAPABLE_TURN_BRAND]: true;
}

export function isTerminalCapableTurn(value: {
  specs?: LLMToolSpec[];
  dispatch?: TerminalTurnDispatch;
  systemPromptParts?: string[];
  llmOpts?: LLMOpts;
}): value is TerminalCapableTurn {
  if ((value as { [TERMINAL_CAPABLE_TURN_BRAND]?: true })[TERMINAL_CAPABLE_TURN_BRAND] === true) return true;
  return (value.llmOpts as { [TERMINAL_CAPABLE_TURN_BRAND]?: true } | undefined)?.[TERMINAL_CAPABLE_TURN_BRAND] === true;
}

/** Fold the four terminal adapters onto a self-turn's base pieces.
 *  Call once per turn (the ② abort listener binds to THIS turn's
 *  signal; `{once: true}` keeps repeat aborts inert). */
export function buildTerminalCapableTurn(base: TerminalCapableBase): TerminalCapableTurn {
  // ② /cancel — Bash children die via the signal threaded into
  // dispatchBash; PtyShell PTYs are persistent (they'd outlive the
  // turn), so kill the non-detached ones here. Detached PTYs survive.
  if (base.signal) {
    base.signal.addEventListener('abort', () => {
      try { killNonDetachedPty(); } catch { /* best-effort */ }
    }, { once: true });
  }

  // ③ Inline-image delivery — a tool (e.g. PtyShellScreenshot) may
  // return an `_imageFile` pointer. When the surface can render inline
  // images, attach it and hand the LLM back just the text `output` so
  // its context isn't polluted with the image path. Fail-soft: any
  // read/send error just drops the image.
  const dispatch: TerminalTurnDispatch = async (name, args, ...rest) => {
    const result = await base.dispatch(name, args, ...rest);
    if (result && typeof result === 'object' && '_imageFile' in result) {
      const r = result as { output?: string; _imageFile?: string; _imageCaption?: string };
      if (r._imageFile && base.fileSink?.sendImage) {
        try {
          const { readFileSync } = await import('node:fs');
          base.fileSink.sendImage(readFileSync(r._imageFile), r._imageCaption ? { caption: r._imageCaption } : undefined);
        } catch { /* drop image, keep text */ }
      } else if (r._imageFile && base.inlineImages) {
        // Daemon-path delivery: inline the bytes per the image-bearing
        // convention instead of a side-channel send.
        try {
          const { readFileSync } = await import('node:fs');
          return {
            output: r.output ?? 'Screen captured.',
            mediaType: imageMediaType(r._imageFile),
            dataB64: readFileSync(r._imageFile).toString('base64'),
          };
        } catch { /* fall through to text-only */ }
      }
      return { output: r.output ?? 'Screen captured.' };
    }
    return result;
  };

  const llmOpts = {
    ...(base.llmOpts ?? {}),
    budgetGrant: PTY_BUDGET_GRANT,
    [TERMINAL_CAPABLE_TURN_BRAND]: true,
  };
  return {
    specs: base.specs,
    dispatch,
    systemPromptParts: [...base.systemPromptParts, TERMINAL_MISSION_DISCIPLINE],
    llmOpts, // ①
    [TERMINAL_CAPABLE_TURN_BRAND]: true,
  };
}
