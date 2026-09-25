'use client';

// WT-A-3b — `:agent <prompt>` response panel.
//
// Sticky-REPL `:agent <prompt>` ships through ACP `terminal/repl/exec`.
// While the LLM stream is in flight the parent surface (TerminalRepl)
// passes a `pendingTurn` summary so this sheet shows a spinner +
// prompt preview + Stop button. Once the daemon resolves runAgentTurn
// the parent moves the result into `response` and the sheet swaps to
// the markdown view. Closing during pendingTurn invokes `onAbort`
// (Phase 4 Q2=a — X button = abort), closing during response invokes
// `onResponseClose`.
//
// Default UX (per WT-A-3b PLAN, 2026-05-05):
//   - side="top" so the panel slides down from the header without
//     hiding the prompt the user just typed.
//   - max-h-[70vh] keeps ~30% of the screen visible for xterm context;
//     iPad 11" 1170×2532 portrait still shows ~750px of terminal.
//   - close: Esc / backdrop click / X button (base-ui Sheet defaults).
//   - markdown: react-markdown + remark-gfm — same stack ChatMessage
//     uses, so users get consistent rendering across `/chat` and
//     `/term`.

import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { MARKDOWN_REMARK_PLUGINS } from '@/lib/markdown-render';
import { debugLog } from '@/lib/debug';
import { CollapsibleCodeBlock } from './CollapsibleCodeBlock';

const MARKDOWN_COMPONENTS = { pre: CollapsibleCodeBlock };

export interface AgentResponse {
  markdown: string;
  modelLabel: string;
  stopReason: string;
  contextLines: number;
}

export interface AgentPendingTurn {
  /** First ~120 chars of the prompt body — header preview while the
   *  daemon's runAgentTurn is mid-stream. */
  prompt: string;
}

export interface AgentResponseSheetProps {
  /** Phase 4 — set when an `:agent` exec is in flight. The sheet
   *  renders a spinner state with the prompt preview + Stop button.
   *  Mutually exclusive with `response` (parent flips one for the
   *  other when the daemon resolves). */
  pendingTurn: AgentPendingTurn | null;
  /** Set when an `:agent` turn produced a response — sheet renders
   *  the markdown panel. Cleared (parent calls onResponseClose) when
   *  the user closes. */
  response: AgentResponse | null;
  /** Phase 4 — user closed the sheet during `pendingTurn` (X button
   *  / backdrop / Esc on Sheet). Parent calls daemon
   *  `terminal/repl/agent/abort` then clears pendingTurn locally. */
  onAbort: () => void;
  /** Sheet close during `response` state — parent clears `response`. */
  onResponseClose: () => void;
}

export function AgentResponseSheet({
  pendingTurn,
  response,
  onAbort,
  onResponseClose,
}: AgentResponseSheetProps): ReactElement | null {
  const open = pendingTurn !== null || response !== null;

  useEffect(() => {
    if (!open) return;
    if (response) {
      debugLog('webterm.agent.sheet.open', {
        modelLabel: response.modelLabel,
        stopReason: response.stopReason,
        mdLen: response.markdown.length,
        ctxLines: response.contextLines,
      });
    } else if (pendingTurn) {
      debugLog('webterm.agent.sheet.pending', {
        promptLen: pendingTurn.prompt.length,
      });
    }
  }, [open, response, pendingTurn]);

  if (!open) return null;

  const handleOpenChange = (next: boolean): void => {
    if (next) return;
    if (pendingTurn) onAbort();
    else onResponseClose();
  };

  const promptPreview = pendingTurn
    ? pendingTurn.prompt.length > 120
      ? `${pendingTurn.prompt.slice(0, 117)}…`
      : pendingTurn.prompt
    : '';

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="top"
        className="max-h-[70vh] min-h-[200px] w-full overflow-auto sm:max-w-none"
      >
        {response ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-sm">
                agent · {response.modelLabel}
              </SheetTitle>
              <SheetDescription className="font-mono text-[11px]">
                {response.contextLines > 0
                  ? `with ${response.contextLines} buffer line(s) of terminal context · stop=${response.stopReason}`
                  : `no buffer context attached · stop=${response.stopReason}`}
              </SheetDescription>
            </SheetHeader>
            <div
              className="prose prose-sm dark:prose-invert max-w-none px-4 pb-6 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_code]:font-mono [&_code]:text-[13px]"
              data-testid="agent-response-markdown"
            >
              <ReactMarkdown
                remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                components={MARKDOWN_COMPONENTS}
              >
                {response.markdown}
              </ReactMarkdown>
            </div>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 font-mono text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                agent · thinking
              </SheetTitle>
              <SheetDescription className="font-mono text-[11px]">
                Esc twice to abort · or click Stop
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-2 font-mono text-[12px] text-muted-foreground" data-testid="agent-pending-prompt">
              {promptPreview}
            </div>
            <div className="flex justify-end px-4 pb-4">
              <button
                type="button"
                onClick={onAbort}
                className="flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 font-mono text-[11px] text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200 dark:hover:bg-rose-900"
                data-testid="agent-abort-stop"
              >
                <X className="h-3 w-3" />
                Stop
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
