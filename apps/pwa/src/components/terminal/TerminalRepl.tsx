'use client';

// WT-A-3 — sticky meta-command bar.
//
// A single-row text input that takes lines starting with `:` and
// dispatches them via daemon ACP `terminal/repl/exec`. The daemon
// runs `dispatchMetaCommand()` and echoes the result back as a
// `terminalOutput` chunk so it appears inline above the next shell
// prompt — no UI duplication, the user sees their command's effect
// in the same xterm view they're already watching.
//
// History: Up/Down cycles through previously-submitted lines (capped
// at 32, persisted to localStorage). Ctrl+Enter is reserved for a
// future "execute as shell command" override (not wired today).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import { getPeerId } from '@/lib/peer-id';
import {
  AgentResponseSheet,
  type AgentResponse,
  type AgentPendingTurn,
} from '@/components/agent/AgentResponseSheet';

const HISTORY_KEY = 'elanous.webterm.replHistory';
const HISTORY_LIMIT = 32;

// Track 2 — sticky REPL is now scoped to terminal-context commands.
// Session-management ones (:fork · :provider · :budget · :session ·
// :history · :reload) live behind UI affordances (TopBar / settings /
// chat composer) — the daemon's web-term surface returns a redirect
// hint when the user types them, but they're not advertised here.
const QUICK_CMDS = [
  ':help',
  ':agent ',
  ':tab next',
  ':tab prev',
  ':cwd',
  ':capture',
  ':peers',
] as const;

import type { ReplMirrorKind } from '@/lib/dock-history-mirror';

interface Props {
  /** Active terminalId — required so the daemon echoes the response
   *  into the right xterm view. When omitted, the meta command runs
   *  but its output is only returned in the response (not echoed). */
  terminalId: string;
  /** Track 2 — `:tab next|prev|N` resolves to a tabIntent on the
   *  daemon response. The page-level owner of the tabs list applies it
   *  (TerminalTabs is the source of truth for which tabs exist). */
  onTabIntent?: (intent: 'next' | 'prev' | number) => void;
  /** BACKLOG #15 — fires after each successful exec so the surrounding
   *  TerminalPanel can mirror the command + output into the dock's
   *  unified history. Caller decides which kinds to forward. */
  onMirror?: (event: ReplMirrorKind) => void;
}

/** Phase 4 — return the prompt body when `cmd` is `:agent <body>`
 *  (with optional --scroll N flag stripped). Returns null for the
 *  no-body chat-mode entry forms (`:agent`, `:agent --chat`, `:agent
 *  --scroll N`) since those don't trigger an LLM call and shouldn't
 *  open the spinner sheet. Mirrors the dispatcher's parsing in
 *  `src/repl/dispatch-meta.ts` :agent case so the client decides
 *  pendingTurn lock without a server round-trip. */
function parseAgentPromptBody(cmd: string): string | null {
  const m = cmd.match(/^:agent\s+(.*)$/);
  if (!m) return null;
  let rest = m[1] ?? '';
  // Strip --scroll N at the head.
  rest = rest.replace(/^--scroll\s+\S+\s+/, '');
  // --chat anywhere in the leading flags drops us into chat-mode-
  // only (no LLM run).
  if (/^--chat(\s|$)/.test(rest)) return null;
  rest = rest.trim();
  return rest.length > 0 ? rest : null;
}

function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string' && v.length > 0).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHistory(items: readonly string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-HISTORY_LIMIT)));
}

export function TerminalRepl({ terminalId, onTabIntent, onMirror }: Props) {
  const { client, sessionId } = useDaemon();
  const [line, setLine] = useState(':');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [agentResponse, setAgentResponse] = useState<AgentResponse | null>(null);
  // WT-A-3b Phase 2 — chat mode state. When true, plain-text input
  // (no leading `:`) is auto-prefixed with `:agent ` and routed through
  // the same ACP path. `:exit` (or `exitRequested` flag from the
  // dispatcher) returns to normal meta mode.
  const [chatMode, setChatMode] = useState(false);
  // WT-A-3b Phase 4 — pendingTurn tracks the in-flight `:agent` LLM
  // stream so the AgentResponseSheet can render a spinner + Stop
  // button while the daemon's runAgentTurn resolves. Cleared in
  // `exec`'s finally block (success / error / abort all converge).
  const [pendingTurn, setPendingTurn] = useState<AgentPendingTurn | null>(null);
  // Phase 4 — 2-stage abort gate (escAbortGate pattern, Q1=b). When
  // pendingTurn is active and the user hits Esc, the gate opens; a
  // second Esc (or Enter) inside the gate confirms the abort, any
  // other key cancels the gate. Mirrors `src/esc-abort-gate.ts`'s
  // 1단계/2단계 contract so accidental Esc never aborts mid-turn.
  const [abortGateOpen, setAbortGateOpen] = useState(false);

  const acpRef = useRef<ReturnType<typeof client.connectAcp> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!sessionId) return undefined;
    if (!acpRef.current) acpRef.current = client.connectAcp({ sessionId });
    return () => {
      try { acpRef.current?.close(); } catch { /* ignore */ }
      acpRef.current = null;
    };
  }, [client, sessionId]);

  const exec = useCallback(async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    // WT-A-3b Phase 2 — in chat mode, treat plain-text lines as agent
    // prompts (auto-prefix `:agent `). Lines starting with `:` still
    // dispatch as normal meta commands so `:exit` / `:provider` /
    // `:capture` stay reachable from inside chat mode.
    const cmd = chatMode && !trimmed.startsWith(':') && trimmed.length > 0
      ? `:agent ${trimmed}`
      : trimmed;
    if (!cmd.startsWith(':')) {
      setError('meta commands must start with `:`');
      return;
    }
    if (!sessionId) {
      setError('session 미설정');
      return;
    }
    if (!acpRef.current) acpRef.current = client.connectAcp({ sessionId });
    const acp = acpRef.current;
    // Phase 4 — `:agent <prompt>` (with body) routes through the
    // pendingTurn lane: the AgentResponseSheet renders a spinner +
    // Stop button while the LLM runs; non-agent meta commands still
    // use the bare `busy` flag (input disabled until response). We
    // detect the agent-with-body case here (mirrors the dispatcher's
    // `:agent --scroll N <body>` and `:agent <body>` cases), and skip
    // pendingTurn for `:agent` alone or `:agent --chat` since those
    // produce an immediate chatModeEnter response without an LLM call.
    const agentBody = parseAgentPromptBody(cmd);
    if (agentBody !== null) {
      setPendingTurn({ prompt: agentBody });
    } else {
      setBusy(true);
    }
    setError(null);
    try {
      const res = (await acp.send('terminal/repl/exec', {
        sessionId,
        terminalId,
        line: cmd,
      })) as {
        consumed?: boolean;
        output?: string;
        sessionIdChange?: string;
        tabIntent?: 'next' | 'prev' | number;
        injectPath?: string;
        exitRequested?: boolean;
        // WT-A-3b — `:agent <prompt>` response markdown + provider label.
        // Present only when the daemon's runAgentTurn ran successfully.
        agent?: {
          markdown: string;
          modelLabel: string;
          stopReason: string;
          contextLines: number;
        };
        // PP-9 — daemon-classified system message replacing the old
        // xterm-side ANSI echo. Mirrored into the chat dock as a red
        // badge (error) or dim italic (note).
        replSystem?: { level: 'note' | 'error'; text: string };
        // WT-A-3b Phase 2 — `:agent` (no args) flips us into chat mode.
        agentChatModeEnter?: boolean;
      } | undefined;
      debugLog('webterm.repl.exec', {
        cmd,
        consumed: res?.consumed,
        outputLen: res?.output?.length ?? 0,
        sessionIdChange: res?.sessionIdChange,
        tabIntent: res?.tabIntent,
        hasInject: !!res?.injectPath,
        hasAgent: !!res?.agent,
        chatEnter: !!res?.agentChatModeEnter,
        chatExit: chatMode && !!res?.exitRequested,
      });
      // WT-A-3b — `:agent <prompt>` response. Open the AgentResponseSheet
      // so the user sees the markdown without scrolling the terminal.
      if (res?.agent) {
        setAgentResponse(res.agent);
      }
      // BACKLOG #15 — mirror command + result into the dock's unified
      // history. We always echo the typed command, then either the
      // agent markdown (preferred), the daemon-classified system
      // message (PP-9 — replaces the old xterm ANSI echo), or the raw
      // output line as a fallback.
      if (onMirror) {
        onMirror({ kind: 'replCommand', line: cmd });
        if (res?.agent) {
          onMirror({
            kind: 'agentResult',
            markdown: res.agent.markdown,
            modelLabel: res.agent.modelLabel,
          });
        } else if (res?.replSystem) {
          onMirror({
            kind: 'systemMessage',
            level: res.replSystem.level,
            text: res.replSystem.text,
          });
        } else if (typeof res?.output === 'string' && res.output.length > 0) {
          onMirror({ kind: 'replOutput', output: res.output });
        }
        if (res?.agentChatModeEnter) {
          onMirror({ kind: 'note', text: 'agent chat mode entered' });
        } else if (chatMode && res?.exitRequested) {
          onMirror({ kind: 'note', text: 'agent chat mode exited' });
        }
      }
      // WT-A-3b Phase 2 — chat mode transitions.
      if (res?.agentChatModeEnter) {
        setChatMode(true);
      } else if (chatMode && res?.exitRequested) {
        // `:exit` inside chat mode returns to normal meta dispatch
        // without closing the terminal session itself.
        setChatMode(false);
      }
      // Track 2 — :tab response handed off to the page-level tab owner.
      if (res?.tabIntent !== undefined && onTabIntent) {
        onTabIntent(res.tabIntent);
      }
      // :capture response — daemon already saved the PNG and sent the
      // path. Inject as if the user typed it (mirrors the Camera/File
      // flow) so prefix commands (`chafa -f iterm`, `claude --image`)
      // can be added with one keystroke.
      if (res?.injectPath) {
        try {
          await acp.send('terminal/input', {
            sessionId,
            terminalId,
            data: `'${res.injectPath.replace(/'/g, "'\\''")}' `,
            peerId: getPeerId(),
          });
        } catch (e) {
          debugLog('webterm.repl.inject-error', { reason: String(e) });
        }
      }
      // Persist to history (dedupe consecutive duplicates).
      setHistory((prev) => {
        const next = prev[prev.length - 1] === cmd ? prev : [...prev, cmd].slice(-HISTORY_LIMIT);
        saveHistory(next);
        return next;
      });
      setHistIdx(-1);
      // Reset prompt to mode-appropriate starter: meta mode shows `:`,
      // chat mode clears so the user can type free text. The transition
      // (chat enter / exit) above already updated chatMode, but state
      // updates batch — read the *intended* next mode from the response
      // to set the right starter line.
      const nextChatMode = res?.agentChatModeEnter
        ? true
        : (chatMode && res?.exitRequested ? false : chatMode);
      setLine(nextChatMode ? '' : ':');
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      setError(msg);
      // PP-9 — surface client-side dispatch errors in the chat dock too,
      // not just the inline strip line. The strip is a 1-row sticky bar
      // and easy to miss; the dock is where the user expects feedback.
      if (onMirror) {
        onMirror({ kind: 'systemMessage', level: 'error', text: `:repl dispatch error — ${msg}` });
      }
    } finally {
      setBusy(false);
      setPendingTurn(null);
      setAbortGateOpen(false);
    }
  }, [client, sessionId, terminalId, chatMode]);

  // Phase 4 — fire the daemon's abort method then clear the local
  // pendingTurn so the sheet hides immediately. The original `exec`
  // promise will still resolve (the daemon-side runAgentTurn rejects
  // with an abort error which the ACP handler catches + echoes a red
  // ":agent error" line into xterm); its `finally` clears state again
  // (no-op the second time around).
  const triggerAbort = useCallback(async (): Promise<void> => {
    if (!pendingTurn || !sessionId) {
      setAbortGateOpen(false);
      return;
    }
    setAbortGateOpen(false);
    try {
      const acp = acpRef.current ?? client.connectAcp({ sessionId });
      acpRef.current = acp;
      const res = (await acp.send('terminal/repl/agent/abort', {
        sessionId,
        terminalId,
      })) as { aborted?: boolean } | undefined;
      debugLog('webterm.repl.agent.abort', { aborted: res?.aborted ?? false });
    } catch (e) {
      debugLog('webterm.repl.agent.abort-error', { reason: String(e) });
    }
    setPendingTurn(null);
  }, [client, sessionId, terminalId, pendingTurn]);

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>): void => {
    // Phase 4 — escAbortGate (Q1=b). When the abort gate is open, Esc
    // or Enter confirms the abort; any other key cancels the gate
    // (mirrors `src/esc-abort-gate.ts` 1단계/2단계). The input itself
    // is unfocused while the gate banner is visible — keys still
    // route through this handler because the input retains focus
    // until the user clicks elsewhere.
    if (abortGateOpen) {
      if (ev.key === 'Escape' || ev.key === 'Enter') {
        ev.preventDefault();
        void triggerAbort();
      } else {
        ev.preventDefault();
        setAbortGateOpen(false);
      }
      return;
    }
    // Phase 4 — first Esc with a turn in flight opens the gate. Q3=a:
    // chat 모드 유지, abort 후 다음 입력 받음 — chatMode state stays
    // unchanged through the abort so the user lands back in the same
    // conversation flow.
    if (pendingTurn && ev.key === 'Escape') {
      ev.preventDefault();
      setAbortGateOpen(true);
      return;
    }
    // Phase 4 — block Enter while the agent turn is in flight so a
    // second prompt can't queue up before the first finishes/aborts.
    // Esc-then-Enter to abort, or wait for the response.
    if (pendingTurn && ev.key === 'Enter') {
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void exec(line);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (history.length === 0) return;
      const next = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setLine(history[next] ?? ':');
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (histIdx < 0) return;
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(-1);
        setLine(':');
      } else {
        setHistIdx(next);
        setLine(history[next] ?? ':');
      }
    } else if (ev.key === 'Escape') {
      // WT-A-3b Phase 2 — Esc clears the input line. Mode itself only
      // toggles via `:agent` / `:exit` so an accidental Esc doesn't
      // drop the user out of an in-progress chat session.
      setLine(chatMode ? '' : ':');
      setHistIdx(-1);
      setError(null);
    }
  };

  const useQuickCmd = (cmd: string): void => {
    setLine(cmd + ' ');
    setPickerOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div
      className={`flex items-center gap-2 border-b px-2 py-1 text-xs ${
        chatMode
          ? 'border-primary/40 bg-primary/5'
          : 'border-border bg-background/40'
      }`}
    >
      <span
        className={`font-mono text-[11px] ${chatMode ? 'text-primary' : 'text-muted-foreground'}`}
        title={chatMode ? 'agent chat mode — :exit to leave' : 'REPL meta command'}
      >
        {chatMode ? 'agent>' : 'REPL'}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={line}
        onChange={(ev) => setLine(ev.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        placeholder={
          chatMode
            ? 'ask the agent — :exit to leave chat mode'
            : ':agent <prompt> · :help · :tab · :cwd · :capture'
        }
        className="flex-1 rounded border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground outline-none focus:border-primary disabled:opacity-50"
      />
      <AgentResponseSheet
        pendingTurn={pendingTurn}
        response={agentResponse}
        onAbort={() => { void triggerAbort(); }}
        onResponseClose={() => setAgentResponse(null)}
      />
      {abortGateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="alertdialog"
          aria-modal="true"
          data-testid="agent-abort-gate"
          onClick={() => setAbortGateOpen(false)}
        >
          <div
            className="rounded-md border border-rose-300 bg-card p-4 shadow-lg dark:border-rose-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-mono text-sm">Abort agent turn?</h3>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Esc again or Enter to confirm · any other key to cancel
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAbortGateOpen(false)}
                className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void triggerAbort(); }}
                className="rounded bg-rose-600 px-2 py-1 font-mono text-[11px] text-white hover:bg-rose-700"
                data-testid="agent-abort-confirm"
              >
                Abort
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="quick commands"
          title="quick commands"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
        {pickerOpen && (
          <ul className="absolute right-0 top-full z-40 mt-1 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md">
            {QUICK_CMDS.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-accent"
                  onClick={() => useQuickCmd(c)}
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <span className="ml-1 max-w-[40%] truncate text-[11px] text-rose-500" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
