'use client';

/** CV-3 Showroom MVP — text input bar with mention picker.
 *  ([RFC v4](../../../../../내부 문서 `PLAN-cv-3-showroom-mvp-2026-05-07`))
 *
 *  P1: text only · broadcast 만 (Enter submit · Shift+Enter newline).
 *  P2: mention chip list — panel 의 displayName chip 클릭으로 `@name`
 *      input 에 inject. send 시 raw text 의 mention 으로 broadcast vs
 *      targeted 분기 (parent 에서 planDispatch).
 *
 *  D5 — broadcast first (no mention) · targeted via `@name`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AtSign, Bot, ClipboardPaste, FileAudio, Film, Forward, Link2, Paperclip, RefreshCw, Send, TerminalSquare, X } from 'lucide-react';
import {
  defaultTerminalContextLabel,
  matchMentionTypeahead,
  newTerminalContextId,
  panelDisplayName,
  parseMentions,
  planDispatch,
  type MentionTypeaheadMatch,
} from '@/lib/showroom/runtime';
import type {
  ClipboardContext,
  PriorAnswer,
  ShowroomAudioContext,
  ShowroomPanel,
  ShowroomVideoContext,
  TerminalContext,
  UrlContext,
} from '@/lib/showroom/types';
import type { DaemonTerminalSummary } from '@/lib/daemon-client';
import type { AttachmentMeta } from '@/lib/upload-attachment';
import { FileAttachButton } from '@/components/terminal/FileAttachButton';
import { ShowroomCameraIntake } from './ShowroomCameraIntake';
import { ShowroomVoiceIntake } from './ShowroomVoiceIntake';

interface Props {
  onSend: (text: string) => void | Promise<void>;
  /** All active panels — used by mention picker UI to expose chips. */
  panels: readonly ShowroomPanel[];
  /** Cached for placeholder + button label. Should equal
   *  `panels.filter(p => p.state === 'live').length`. */
  liveCount: number;
  /** P3 — attachment chip list state. broadcast 시 모든 dispatched
   *  panel 의 user message 에 첨부 (image / file). */
  attachments?: readonly AttachmentMeta[];
  onAttach?: (entries: AttachmentMeta[]) => void;
  onRemoveAttachment?: (id: string) => void;
  /** P4 — terminal context pin state (D14 frozen snapshot · client paste).
   *  broadcast 시 prompt prefix 로 `<terminal_context>` block prepend. */
  terminalContexts?: readonly TerminalContext[];
  onPinTerminalContext?: (ctx: TerminalContext) => void;
  onRemoveTerminalContext?: (id: string) => void;
  /** DM-3 — prior-answer promotion (RFC v4 §6.2 · 진짜 가치 axis).
   *  panel 의 assistant message 에서 promote 한 답변 list. broadcast
   *  시 prompt prefix 로 `<prior_answer>` block prepend (terminal
   *  context 다음 · user text 앞). cross-model deliberation 자동화의
   *  client-side minimum slice. */
  priorAnswers?: readonly PriorAnswer[];
  onRemovePriorAnswer?: (id: string) => void;
  /** §3.4 (BACKLOG-showroom-cv-3-post-dm-stage-4-2026-05-09): chip
   *  click flips `enabled` so the user can selectively activate which
   *  prior answers participate in the next broadcast. Disabled chips
   *  remain visible (reduced opacity) so the user can re-enable later. */
  onTogglePriorAnswer?: (id: string) => void;
  /** §6.3 — URL context source. user 입력 URL → daemon fetch + chip.
   *  broadcast 시 `<url_context>` block prepend. */
  urlContexts?: readonly UrlContext[];
  onAddUrlContext?: (url: string) => Promise<{ ok: boolean; reason?: string }>;
  onRemoveUrlContext?: (id: string) => void;
  /** §6.3 — Clipboard context source. navigator.clipboard.readText →
   *  chip. broadcast 시 `<clipboard_context>` block prepend. */
  clipboardContexts?: readonly ClipboardContext[];
  onAddClipboardContext?: () => Promise<{ ok: boolean; reason?: string }>;
  onRemoveClipboardContext?: (id: string) => void;
  /** R6 Task 4 · §6.3 — Video context source. file picker → keyframe
   *  extracted via canvas. broadcast 시 `<video_context>` block. */
  videoContexts?: readonly ShowroomVideoContext[];
  onAddVideoContext?: (file: File) => Promise<{ ok: boolean; reason?: string }>;
  onRemoveVideoContext?: (id: string) => void;
  /** R6 Task 4 · §6.3 — Audio context source. file picker + (optional)
   *  manual transcript. broadcast 시 `<audio_context>` block. */
  audioContexts?: readonly ShowroomAudioContext[];
  onAddAudioContext?: (file: File) => Promise<{ ok: boolean; reason?: string }>;
  onRemoveAudioContext?: (id: string) => void;
  onUpdateAudioTranscript?: (id: string, transcript: string) => void;
  /** P4.2 — daemon-side terminal scrollback fetch (replaces pure paste
   *  minimum from P4.1). When both are provided + onPinTerminalContext
   *  is set, the terminal pin draft renders an "active terminals"
   *  picker that auto-fetches scrollback into the textarea on click.
   *  Both undefined = legacy paste-only UX (P4.1 fallback). */
  /** ⛔ 2026-08-14 — 이 자리는 예전에 `cmd`/`workdir`/`outputBytes` 를 요구했다.
   *  그 셋은 `GET /v1/terminals` 응답에 «없다»(실측 키: alive · correlationId ·
   *  hasPty · id · instance · name · sessionId · sourceRoot · startedAt · status).
   *  구조 타입이 실물과 어긋난 채로 렌더가 `t.cmd` 를 찍고 있어서 picker 라벨이
   *  `undefined` 로 나왔다. 이제 클라이언트가 내보내는 실제 행 타입을 그대로 쓴다. */
  listTerminals?: () => Promise<{ terminals: DaemonTerminalSummary[] }>;
  fetchTerminalScrollback?: (
    id: string,
    lines: number,
  ) => Promise<{ scrollback: string; lines: number }>;
  disabled?: boolean;
}

export function ShowroomInput({
  onSend,
  panels,
  liveCount,
  attachments,
  onAttach,
  onRemoveAttachment,
  terminalContexts,
  onPinTerminalContext,
  onRemoveTerminalContext,
  priorAnswers,
  onRemovePriorAnswer,
  onTogglePriorAnswer,
  urlContexts,
  onAddUrlContext,
  onRemoveUrlContext,
  clipboardContexts,
  onAddClipboardContext,
  onRemoveClipboardContext,
  videoContexts,
  onAddVideoContext,
  onRemoveVideoContext,
  audioContexts,
  onAddAudioContext,
  onRemoveAudioContext,
  onUpdateAudioTranscript,
  listTerminals,
  fetchTerminalScrollback,
  disabled = false,
}: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [terminalDraft, setTerminalDraft] = useState('');
  const [terminalDraftOpen, setTerminalDraftOpen] = useState(false);
  // P4.2 — daemon scrollback picker state. Auto-refresh on draft open.
  const [activeTerminals, setActiveTerminals] = useState<DaemonTerminalSummary[]>([]);
  const [terminalsListLoading, setTerminalsListLoading] = useState(false);
  const [terminalsListError, setTerminalsListError] = useState<string | null>(null);
  const [scrollbackFetching, setScrollbackFetching] = useState<string | null>(null);
  const supportsTerminalsPicker = !!listTerminals && !!fetchTerminalScrollback;

  const refreshTerminalsList = useCallback(async () => {
    if (!listTerminals) return;
    setTerminalsListLoading(true);
    setTerminalsListError(null);
    try {
      const { terminals } = await listTerminals();
      setActiveTerminals(terminals);
    } catch (e) {
      setTerminalsListError(String(e));
    } finally {
      setTerminalsListLoading(false);
    }
  }, [listTerminals]);

  // Auto-fetch the terminals list when the pin draft opens. Refresh on
  // demand via the refresh button (debounce-free since it's user-driven).
  useEffect(() => {
    if (terminalDraftOpen && supportsTerminalsPicker) {
      void refreshTerminalsList();
    }
  }, [terminalDraftOpen, supportsTerminalsPicker, refreshTerminalsList]);

  const fetchAndFillScrollback = useCallback(
    async (id: string) => {
      if (!fetchTerminalScrollback) return;
      setScrollbackFetching(id);
      try {
        const { scrollback } = await fetchTerminalScrollback(id, 50);
        setTerminalDraft(scrollback);
      } catch (e) {
        setTerminalsListError(`scrollback: ${String(e)}`);
      } finally {
        setScrollbackFetching(null);
      }
    },
    [fetchTerminalScrollback],
  );
  // P2.5 — typeahead dropdown state. cursor-driven re-evaluation
  // (onSelectionChange + onChange).
  const [typeahead, setTypeahead] = useState<MentionTypeaheadMatch | null>(null);

  const refreshTypeahead = useCallback(() => {
    const ta = taRef.current;
    if (!ta) {
      setTypeahead(null);
      return;
    }
    const cursor = ta.selectionStart ?? text.length;
    const m = matchMentionTypeahead(text, cursor, panels);
    setTypeahead(m);
  }, [text, panels]);

  const replaceTypeaheadToken = useCallback(
    (token: string) => {
      const ta = taRef.current;
      if (!ta || !typeahead) return;
      const next = text.slice(0, typeahead.tokenStart) + `@${token} ` + text.slice(typeahead.tokenEnd);
      setText(next);
      setTypeahead(null);
      requestAnimationFrame(() => {
        const pos = typeahead.tokenStart + token.length + 2;
        ta.setSelectionRange(pos, pos);
        ta.focus();
      });
    },
    [text, typeahead],
  );

  const pinTerminal = useCallback(() => {
    const trimmed = terminalDraft.trim();
    if (!trimmed || !onPinTerminalContext) return;
    const ctx: TerminalContext = {
      id: newTerminalContextId(),
      label: defaultTerminalContextLabel(trimmed),
      text: trimmed,
      pinnedAt: Date.now(),
    };
    onPinTerminalContext(ctx);
    setTerminalDraft('');
    setTerminalDraftOpen(false);
  }, [terminalDraft, onPinTerminalContext]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(trimmed);
      setText('');
    } finally {
      setBusy(false);
    }
  }, [text, busy, disabled, onSend]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // P2.5 — typeahead dropdown 의 first match Enter 키로 accept.
      if (typeahead && e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const first = typeahead.matches[0];
        if (first) {
          e.preventDefault();
          replaceTypeaheadToken(panelDisplayName(first, panels));
          return;
        }
        if (typeahead.allMatches) {
          e.preventDefault();
          replaceTypeaheadToken('all');
          return;
        }
      }
      if (typeahead && e.key === 'Escape') {
        e.preventDefault();
        setTypeahead(null);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void submit();
      }
    },
    [submit, typeahead, replaceTypeaheadToken, panels],
  );

  /** Insert `@displayName ` at the textarea cursor position. */
  const insertMention = useCallback(
    (token: string) => {
      const ta = taRef.current;
      const insert = `@${token} `;
      if (!ta) {
        setText((prev) => `${prev}${insert}`);
        return;
      }
      const start = ta.selectionStart ?? text.length;
      const end = ta.selectionEnd ?? text.length;
      const next = text.slice(0, start) + insert + text.slice(end);
      setText(next);
      // restore caret to right after the insert (next tick)
      requestAnimationFrame(() => {
        const pos = start + insert.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
      });
    },
    [text],
  );

  // Mention chip viz (hybrid overlay) — vision Q4. textarea 그대로 +
  // detected mention 의 시각적 chip strip 을 textarea 위에 read-only
  // 로 노출. IME 안전 (textarea 직접 조작 안 함) · plan parsing 으로
  // 매칭된 panel + @all + unknown 표시.
  const detectedMentions = useMemo(() => {
    return parseMentions(text, panels);
  }, [text, panels]);

  // Plan label preview — broadcast vs targeted (live panel count).
  const plan = planDispatch(text, panels);
  const sendLabel = (() => {
    if (liveCount === 0 && plan.mode === 'broadcast') return 'No live panel';
    if (plan.mode === 'broadcast') return `Send · ${plan.targets.length}`;
    if (plan.targets.length === 1) {
      return `Send · @${panelDisplayName(plan.targets[0]!, panels)}`;
    }
    return `Send · @${plan.targets.length}`;
  })();
  const canSend =
    !disabled && !busy && text.trim().length > 0 && plan.targets.length > 0;

  const hasAttachments = (attachments?.length ?? 0) > 0;
  const hasTerminalContexts = (terminalContexts?.length ?? 0) > 0;
  const hasPriorAnswers = (priorAnswers?.length ?? 0) > 0;
  const hasUrlContexts = (urlContexts?.length ?? 0) > 0;
  const hasClipboardContexts = (clipboardContexts?.length ?? 0) > 0;
  const hasVideoContexts = (videoContexts?.length ?? 0) > 0;
  const hasAudioContexts = (audioContexts?.length ?? 0) > 0;
  // R6 Task 4 — file picker refs (one per kind so MIME accept stays
  // distinct). The buttons below trigger them; the input itself is
  // visually hidden but accessible.
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const handleVideoFile = useCallback(async (file: File) => {
    if (!onAddVideoContext) return;
    setVideoBusy(true);
    setVideoError(null);
    try {
      const result = await onAddVideoContext(file);
      if (!result.ok) setVideoError(result.reason ?? 'video extract failed');
    } finally {
      setVideoBusy(false);
    }
  }, [onAddVideoContext]);
  const handleAudioFile = useCallback(async (file: File) => {
    if (!onAddAudioContext) return;
    setAudioBusy(true);
    setAudioError(null);
    try {
      const result = await onAddAudioContext(file);
      if (!result.ok) setAudioError(result.reason ?? 'audio extract failed');
    } finally {
      setAudioBusy(false);
    }
  }, [onAddAudioContext]);
  const handleAudioTranscriptEdit = useCallback((id: string, current: string) => {
    if (!onUpdateAudioTranscript) return;
    if (typeof window === 'undefined') return;
    const next = window.prompt('Audio transcript:', current);
    if (next === null) return;
    onUpdateAudioTranscript(id, next);
  }, [onUpdateAudioTranscript]);

  // §6.3 — URL input modal state.
  const [urlDraft, setUrlDraft] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlDraftOpen, setUrlDraftOpen] = useState(false);
  const handleUrlSubmit = useCallback(async () => {
    if (!onAddUrlContext) return;
    const u = urlDraft.trim();
    if (!u) {
      setUrlError('url required');
      return;
    }
    setUrlBusy(true);
    setUrlError(null);
    try {
      const result = await onAddUrlContext(u);
      if (result.ok) {
        setUrlDraft('');
        setUrlDraftOpen(false);
      } else {
        setUrlError(result.reason ?? 'fetch failed');
      }
    } finally {
      setUrlBusy(false);
    }
  }, [urlDraft, onAddUrlContext]);

  // §6.3 — Clipboard one-shot pin.
  const [clipBusy, setClipBusy] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);
  const handleClipPin = useCallback(async () => {
    if (!onAddClipboardContext) return;
    setClipBusy(true);
    setClipError(null);
    try {
      const result = await onAddClipboardContext();
      if (!result.ok) setClipError(result.reason ?? 'paste failed');
    } finally {
      setClipBusy(false);
    }
  }, [onAddClipboardContext]);

  return (
    <div className="border-t border-zinc-200/50 bg-zinc-50 px-3 py-2 dark:border-zinc-700/50 dark:bg-zinc-900/40">
      {hasUrlContexts && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-url-context-list"
        >
          <span>url:</span>
          {urlContexts?.map((uc) => (
            <span
              key={uc.id}
              className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-700 dark:bg-zinc-800 dark:text-sky-300"
              data-testid={`showroom-url-chip-${uc.id}`}
              title={`${uc.url}\n\n${uc.text.slice(0, 200)}${uc.text.length > 200 ? '…' : ''}`}
            >
              <span className="max-w-[220px] truncate">{uc.label}</span>
              {onRemoveUrlContext && (
                <button
                  type="button"
                  onClick={() => onRemoveUrlContext(uc.id)}
                  disabled={disabled || busy}
                  className="rounded-full p-0.5 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-sky-900/50"
                  aria-label={`Remove url context ${uc.label}`}
                  data-testid={`showroom-url-remove-${uc.id}`}
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {hasVideoContexts && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-video-context-list"
        >
          <span>video:</span>
          {videoContexts?.map((vc) => (
            <span
              key={vc.id}
              className="inline-flex items-center gap-1 rounded-full border border-purple-300 bg-white px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:border-purple-700 dark:bg-zinc-800 dark:text-purple-300"
              data-testid={`showroom-video-chip-${vc.id}`}
              title={`${vc.filename} · ${vc.widthPx}x${vc.heightPx} · ${vc.durationSec}s`}
            >
              <Film className="size-3" aria-hidden />
              <span className="max-w-[220px] truncate">{vc.label}</span>
              {onRemoveVideoContext && (
                <button
                  type="button"
                  onClick={() => onRemoveVideoContext(vc.id)}
                  disabled={disabled || busy}
                  className="rounded-full p-0.5 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-purple-900/50"
                  aria-label={`Remove video context ${vc.label}`}
                  data-testid={`showroom-video-remove-${vc.id}`}
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {hasAudioContexts && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-audio-context-list"
        >
          <span>audio:</span>
          {audioContexts?.map((ac) => (
            <span
              key={ac.id}
              className="inline-flex items-center gap-1 rounded-full border border-cyan-300 bg-white px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:border-cyan-700 dark:bg-zinc-800 dark:text-cyan-300"
              data-testid={`showroom-audio-chip-${ac.id}`}
              title={`${ac.filename} · ${ac.durationSec}s · ${ac.transcript ? 'transcript present' : 'click to add transcript'}`}
            >
              <FileAudio className="size-3" aria-hidden />
              <button
                type="button"
                onClick={() => handleAudioTranscriptEdit(ac.id, ac.transcript)}
                disabled={disabled || busy || !onUpdateAudioTranscript}
                className="max-w-[220px] truncate hover:underline disabled:cursor-default disabled:no-underline"
                data-testid={`showroom-audio-edit-${ac.id}`}
              >
                {ac.label}
                {ac.transcript ? ' · 📝' : ''}
              </button>
              {onRemoveAudioContext && (
                <button
                  type="button"
                  onClick={() => onRemoveAudioContext(ac.id)}
                  disabled={disabled || busy}
                  className="rounded-full p-0.5 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-cyan-900/50"
                  aria-label={`Remove audio context ${ac.label}`}
                  data-testid={`showroom-audio-remove-${ac.id}`}
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {videoError && (
        <div
          className="mb-2 px-2 py-1 text-[11px] text-purple-700 dark:text-purple-300"
          data-testid="showroom-video-error"
        >
          {videoError}
        </div>
      )}
      {audioError && (
        <div
          className="mb-2 px-2 py-1 text-[11px] text-cyan-700 dark:text-cyan-300"
          data-testid="showroom-audio-error"
        >
          {audioError}
        </div>
      )}
      {hasClipboardContexts && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-clipboard-context-list"
        >
          <span>clip:</span>
          {clipboardContexts?.map((cc) => (
            <span
              key={cc.id}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-700 dark:bg-zinc-800 dark:text-emerald-300"
              data-testid={`showroom-clipboard-chip-${cc.id}`}
              title={cc.text.slice(0, 200)}
            >
              <span className="max-w-[220px] truncate">{cc.label}</span>
              {onRemoveClipboardContext && (
                <button
                  type="button"
                  onClick={() => onRemoveClipboardContext(cc.id)}
                  disabled={disabled || busy}
                  className="rounded-full p-0.5 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-emerald-900/50"
                  aria-label={`Remove clipboard context ${cc.label}`}
                  data-testid={`showroom-clipboard-remove-${cc.id}`}
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {urlDraftOpen && onAddUrlContext && (
        <div className="mb-2 rounded border border-sky-200 bg-sky-50 p-2 dark:border-sky-800 dark:bg-sky-900/20">
          <div className="flex items-center gap-1">
            <input
              type="url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://..."
              disabled={urlBusy}
              className="flex-1 rounded border border-sky-300 bg-white px-2 py-1 text-xs disabled:opacity-60 dark:border-sky-700 dark:bg-zinc-900"
              data-testid="showroom-url-input"
            />
            <button
              type="button"
              onClick={handleUrlSubmit}
              disabled={urlBusy || !urlDraft.trim()}
              className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="showroom-url-fetch"
            >
              {urlBusy ? '…' : 'fetch'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlDraftOpen(false);
                setUrlDraft('');
                setUrlError(null);
              }}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Close url input"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
          {urlError && (
            <p className="mt-1 text-[10px] text-rose-600" data-testid="showroom-url-error">
              {urlError}
            </p>
          )}
        </div>
      )}
      {clipError && (
        <p className="mb-2 text-[10px] text-rose-600" data-testid="showroom-clipboard-error">
          clipboard: {clipError}
        </p>
      )}
      {hasPriorAnswers && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-prior-answer-list"
        >
          <Forward className="size-3" aria-hidden />
          <span>prior:</span>
          {priorAnswers?.map((pa) => {
            // §3.4 — chip click toggles `enabled`. Disabled chips render
            // with reduced opacity + dashed border so the user can tell
            // at a glance which chips will participate in the next
            // broadcast. The remove (X) button is always wired so the
            // user can drop a chip outright.
            const isOn = pa.enabled !== false;
            const baseCls = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity';
            const enabledCls = 'border border-indigo-300 bg-white text-indigo-700 dark:border-indigo-700 dark:bg-zinc-800 dark:text-indigo-300';
            const disabledCls = 'border border-dashed border-zinc-300 bg-zinc-50 text-zinc-400 line-through opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-500';
            return (
              <span
                key={pa.id}
                className={`${baseCls} ${isOn ? enabledCls : disabledCls}`}
                data-testid={`showroom-prior-chip-${pa.id}`}
                data-enabled={isOn ? 'true' : 'false'}
                title={pa.text.slice(0, 200)}
              >
                {onTogglePriorAnswer ? (
                  <button
                    type="button"
                    onClick={() => onTogglePriorAnswer(pa.id)}
                    disabled={disabled || busy}
                    className="max-w-[200px] truncate text-left hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`${isOn ? 'Disable' : 'Enable'} prior answer ${pa.label}`}
                    aria-pressed={isOn}
                    data-testid={`showroom-prior-toggle-${pa.id}`}
                  >
                    {pa.label}
                  </button>
                ) : (
                  <span className="max-w-[200px] truncate">{pa.label}</span>
                )}
                {onRemovePriorAnswer && (
                  <button
                    type="button"
                    onClick={() => onRemovePriorAnswer(pa.id)}
                    disabled={disabled || busy}
                    className="rounded-full p-0.5 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-indigo-900/50"
                    aria-label={`Remove prior answer ${pa.label}`}
                    data-testid={`showroom-prior-remove-${pa.id}`}
                  >
                    <X className="size-2.5" aria-hidden />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {hasTerminalContexts && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-terminal-context-list"
        >
          <TerminalSquare className="size-3" aria-hidden />
          <span>terminal:</span>
          {terminalContexts?.map((tc) => (
            <span
              key={tc.id}
              className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-white px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-700 dark:bg-zinc-800 dark:text-violet-300"
              data-testid={`showroom-terminal-chip-${tc.id}`}
              title={tc.text.slice(0, 200)}
            >
              <span className="max-w-[200px] truncate">{tc.label}</span>
              {onRemoveTerminalContext && (
                <button
                  type="button"
                  onClick={() => onRemoveTerminalContext(tc.id)}
                  disabled={disabled || busy}
                  className="rounded-full p-0.5 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-violet-900/50"
                  aria-label={`Remove terminal context ${tc.label}`}
                  data-testid={`showroom-terminal-remove-${tc.id}`}
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {terminalDraftOpen && onPinTerminalContext && (
        <div
          className="mb-2 rounded-md border border-violet-300 bg-violet-50/40 p-2 dark:border-violet-700 dark:bg-violet-900/20"
          data-testid="showroom-terminal-pin-draft"
        >
          <div className="mb-1 flex items-center justify-between text-[10px] text-violet-700 dark:text-violet-300">
            <span>
              {supportsTerminalsPicker
                ? 'active terminal 선택 또는 paste · Pin 으로 broadcast prefix 추가'
                : 'terminal output 을 paste · Pin 으로 broadcast prefix 추가'}
            </span>
            <button
              type="button"
              onClick={() => {
                setTerminalDraftOpen(false);
                setTerminalDraft('');
              }}
              className="rounded p-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/40"
              aria-label="Cancel pin"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
          {supportsTerminalsPicker && (
            <div
              className="mb-2 rounded border border-violet-200 bg-white/80 p-1.5 dark:border-violet-700 dark:bg-zinc-900/60"
              data-testid="showroom-terminal-picker"
            >
              <div className="mb-1 flex items-center justify-between text-[10px] text-violet-600 dark:text-violet-300">
                <span>
                  active terminals
                  {terminalsListLoading && ' · loading…'}
                  {!terminalsListLoading && activeTerminals.length === 0 && ' · 없음'}
                </span>
                <button
                  type="button"
                  onClick={() => void refreshTerminalsList()}
                  disabled={terminalsListLoading}
                  className="inline-flex items-center gap-0.5 rounded p-0.5 hover:bg-violet-100 disabled:opacity-50 dark:hover:bg-violet-900/40"
                  aria-label="Refresh terminals list"
                  data-testid="showroom-terminal-picker-refresh"
                >
                  <RefreshCw className={`size-3 ${terminalsListLoading ? 'animate-spin' : ''}`} aria-hidden />
                </button>
              </div>
              {terminalsListError && (
                <div className="mb-1 text-[10px] text-rose-600 dark:text-rose-300">
                  {terminalsListError}
                </div>
              )}
              {activeTerminals.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {activeTerminals.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void fetchAndFillScrollback(t.id)}
                      disabled={scrollbackFetching === t.id}
                      className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full border border-violet-300 bg-white px-2 py-0.5 text-[10px] text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-700 dark:bg-zinc-800 dark:text-violet-300 dark:hover:bg-violet-900/40"
                      title={`${t.name || t.id}${t.status ? ` · ${t.status}` : ''}`}
                      data-testid={`showroom-terminal-picker-${t.id}`}
                    >
                      <TerminalSquare className="size-3" aria-hidden />
                      <span className="truncate">
                        {t.name || t.id}
                        {!t.alive && ' (exited)'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <textarea
            value={terminalDraft}
            onChange={(e) => setTerminalDraft(e.target.value)}
            rows={4}
            placeholder="paste terminal output here…"
            className="w-full resize-y rounded-md border border-violet-200 bg-white px-2 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-violet-400 dark:border-violet-700 dark:bg-zinc-900"
            data-testid="showroom-terminal-draft-textarea"
          />
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={pinTerminal}
              disabled={!terminalDraft.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-violet-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="showroom-terminal-pin-confirm"
            >
              <TerminalSquare className="size-3" aria-hidden />
              Pin
            </button>
          </div>
        </div>
      )}
      {hasAttachments && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-attachment-list"
        >
          <Paperclip className="size-3" aria-hidden />
          <span>attached:</span>
          {attachments?.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-700 dark:bg-zinc-800 dark:text-sky-300"
              data-testid={`showroom-attachment-chip-${att.id}`}
            >
              <span className="max-w-[160px] truncate">{att.filename}</span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  disabled={disabled || busy}
                  className="rounded-full p-0.5 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-sky-900/50"
                  aria-label={`Remove attachment ${att.filename}`}
                  data-testid={`showroom-attachment-remove-${att.id}`}
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {panels.length > 0 && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500"
          data-testid="showroom-mention-picker"
        >
          <AtSign className="size-3" aria-hidden />
          <span>mention:</span>
          {panels.map((p) => {
            const dn = panelDisplayName(p, panels);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => insertMention(dn)}
                disabled={disabled || busy}
                className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                data-testid={`showroom-mention-chip-${dn}`}
                aria-label={`Mention ${dn} in input`}
              >
                @{dn}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => insertMention('all')}
            disabled={disabled || busy}
            className="inline-flex items-center rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:bg-zinc-800 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
            data-testid="showroom-mention-chip-all"
            aria-label="Mention all (explicit broadcast)"
          >
            @all
          </button>
        </div>
      )}
      {/* Mention chip viz (hybrid overlay · vision Q4) — read-only chip
          strip showing detected `@mention` tokens in the current text.
          textarea remains source of truth (IME-safe · no contenteditable).
          Hidden when no mentions OR when only @all is the canonical
          dispatch (already implied). */}
      {(detectedMentions.targets.length > 0
        || detectedMentions.broadcastAll
        || detectedMentions.unknown.length > 0) && (
        <div
          className="mb-1 flex flex-wrap items-center gap-1 text-[10px]"
          data-testid="showroom-mention-detected-strip"
          aria-label="Detected mentions in input"
        >
          <span className="text-zinc-500">detected:</span>
          {detectedMentions.broadcastAll && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full border border-emerald-400 bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              data-testid="showroom-mention-detected-all"
              title="explicit broadcast (mute/freeze 무시)"
            >
              <AtSign className="size-2.5" aria-hidden />
              all
            </span>
          )}
          {detectedMentions.targets.map((p) => {
            const dn = panelDisplayName(p, panels);
            const isAgent = p.kind === 'agent';
            return (
              <span
                key={p.id}
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ${
                  isAgent
                    ? 'border border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'border border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                }`}
                data-testid={`showroom-mention-detected-${dn}`}
                title={`${isAgent ? 'agent CLI' : 'chat'} panel · ${p.state}`}
              >
                {isAgent ? (
                  <Bot className="size-2.5" aria-hidden />
                ) : (
                  <AtSign className="size-2.5" aria-hidden />
                )}
                {dn}
              </span>
            );
          })}
          {detectedMentions.unknown.map((u) => (
            <span
              key={`unknown-${u}`}
              className="inline-flex items-center gap-0.5 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
              data-testid={`showroom-mention-detected-unknown-${u}`}
              title="Unknown mention — panel 없음"
            >
              <AtSign className="size-2.5" aria-hidden />
              {u}
            </span>
          ))}
        </div>
      )}
      {typeahead
        && (typeahead.matches.length > 0 || typeahead.allMatches) && (
        <div
          className="mb-1 max-h-32 overflow-y-auto rounded-md border border-zinc-300 bg-white text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          data-testid="showroom-mention-typeahead"
        >
          {typeahead.allMatches && (
            <button
              type="button"
              onClick={() => replaceTypeaheadToken('all')}
              className="block w-full px-3 py-1.5 text-left text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
              data-testid="showroom-mention-typeahead-all"
            >
              <span className="font-medium">@all</span>
              <span className="ml-2 text-[10px] text-zinc-500">explicit broadcast</span>
            </button>
          )}
          {typeahead.matches.map((p, idx) => {
            const dn = panelDisplayName(p, panels);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => replaceTypeaheadToken(dn)}
                className={`block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                  idx === 0 && !typeahead.allMatches
                    ? 'bg-zinc-50 font-medium dark:bg-zinc-700/40'
                    : ''
                }`}
                data-testid={`showroom-mention-typeahead-${dn}`}
              >
                @{dn}
                <span className="ml-2 text-[10px] text-zinc-500">{p.state}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-end gap-2">
        {onPinTerminalContext && (
          <button
            type="button"
            onClick={() => setTerminalDraftOpen((v) => !v)}
            disabled={disabled || busy}
            className="rounded p-1.5 text-violet-600 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-900/40"
            aria-label="Pin terminal context"
            title="Pin terminal output as context"
            aria-pressed={terminalDraftOpen}
            data-testid="showroom-terminal-pin-toggle"
          >
            <TerminalSquare className="size-3.5" aria-hidden />
          </button>
        )}
        {onAddUrlContext && (
          <button
            type="button"
            onClick={() => setUrlDraftOpen((v) => !v)}
            disabled={disabled || busy}
            className="rounded p-1.5 text-sky-600 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-900/40"
            aria-label="Add URL context"
            title="Fetch URL as context"
            aria-pressed={urlDraftOpen}
            data-testid="showroom-url-pin-toggle"
          >
            <Link2 className="size-3.5" aria-hidden />
          </button>
        )}
        {onAddClipboardContext && (
          <button
            type="button"
            onClick={handleClipPin}
            disabled={disabled || busy || clipBusy}
            className="rounded p-1.5 text-emerald-600 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            aria-label="Pin clipboard text"
            title="Read clipboard text as context"
            data-testid="showroom-clipboard-pin"
          >
            <ClipboardPaste className="size-3.5" aria-hidden />
          </button>
        )}
        {onAddVideoContext && (
          <>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              data-testid="showroom-video-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleVideoFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={disabled || busy || videoBusy}
              className="rounded p-1.5 text-purple-600 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-purple-300 dark:hover:bg-purple-900/40"
              aria-label="Pin video file as context"
              title="Pick video file (keyframe extracted via canvas)"
              data-testid="showroom-video-pin"
            >
              <Film className="size-3.5" aria-hidden />
            </button>
          </>
        )}
        {onAddAudioContext && (
          <>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              data-testid="showroom-audio-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAudioFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              disabled={disabled || busy || audioBusy}
              className="rounded p-1.5 text-cyan-600 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-cyan-300 dark:hover:bg-cyan-900/40"
              aria-label="Pin audio file as context"
              title="Pick audio file (metadata + optional transcript)"
              data-testid="showroom-audio-pin"
            >
              <FileAudio className="size-3.5" aria-hidden />
            </button>
          </>
        )}
        {onAttach && (
          <FileAttachButton onAttached={onAttach} />
        )}
        {/* CV-3 mobile-readiness #4 (2026-05-08) — Camera intake.
            Shares the onAttach surface with FileAttachButton when
            the user picks 'Session 첨부'; routes to /v1/intake +
            KGS pipeline when the user picks 'Intake 저장'. */}
        {onAttach && (
          <ShowroomCameraIntake onAttachToSession={(entry) => onAttach([entry])} />
        )}
        {/* CV-3 mobile-readiness #3 (2026-05-08) — Voice intake.
            Long-press → Web Speech API STT → review modal → POST
            /v1/intake. Separate from the existing daemon-side
            voice WS auto-broadcast (which still fires from the
            ShowroomLayout header mic toggle). Gated behind
            `onAttach` so render-contract tests without a
            DaemonProvider don't blow up on useDaemon(). */}
        {onAttach && <ShowroomVoiceIntake />}
        <textarea
          ref={taRef}
          id="showroom-broadcast-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // run typeahead match on next tick (cursor pos updated)
            requestAnimationFrame(refreshTypeahead);
          }}
          onSelect={() => refreshTypeahead()}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // close typeahead on blur (after click on dropdown
            // resolves via mousedown which fires before blur)
            setTimeout(() => setTypeahead(null), 100);
          }}
          rows={2}
          disabled={disabled || busy}
          placeholder={
            liveCount > 0
              ? `${liveCount} live panel 에 broadcast — 또는 @name 으로 targeted (Enter)…`
              : '모든 panel 이 mute · live 로 전환하거나 panel 추가'
          }
          className="flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800"
          aria-label="Showroom broadcast input"
          data-testid="showroom-input"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          aria-label={
            plan.mode === 'broadcast'
              ? 'Broadcast to all live panels'
              : `Targeted send to ${plan.targets.length} panel(s)`
          }
          data-testid="showroom-send"
        >
          <Send className="size-3.5" aria-hidden />
          {sendLabel}
        </button>
      </div>
    </div>
  );
}
