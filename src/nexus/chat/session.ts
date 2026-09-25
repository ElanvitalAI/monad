// NEXUS · chat session (N-1 cleanup PR b).
//
// Per-tab thin session: holds the message log, drives the ACP agent
// loop, exposes a callback subscription so the SidebarTabSurface
// detail view can re-render on each chunk. Lighter than the
// dashboard's `DashboardAcpChat` (657 LOC · sticky multi-backend
// state · plan model · tool-call table · streaming-buffer tuning) —
// each NEXUS chat tab targets a single resolved backend, so the
// session here owns a single ACP agent + a single sessionId.
//
// What lands in PR b vs deferred:
//   - PR b: lifecycle (idle → streaming → idle/error), message log
//     append, lazy ACP agent attach + session creation,
//     sendUserMessage(text) → prompt + chunk accumulation.
//   - PR c: input wiring (`monad nexus` TUI key dispatch), slash
//     pickers, attachment, esc-cancel binding.
//   - Future: tool-call rendering, plan model, thought chunks.
//
// Test seam: every dependency that touches global state can be DI'd
// (`opts.agentManager`, `opts.now`). The default delegates to
// `globalAcpAgentManager()`.

import type { ContentBlock, SessionUpdate } from '@agentclientprotocol/sdk';

import { globalAcpAgentManager } from '../../acp/agent-manager.js';
import {
  nexusBackendToAcpId,
  type AcpBackendIdLike,
} from './backend-mapping.js';
import type { ChatBackendKind } from './backend-resolver.js';

export type ChatSessionStatus = 'inert' | 'idle' | 'attaching' | 'streaming' | 'error';

export type ChatMessageRole = 'user' | 'assistant' | 'system';

/** M4 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
 *  FeedbackEnvelope-derived ASCII block. TUI is a dumb renderer, so
 *  we ride entirely on the envelope's `asciiFallback` lines — the
 *  daemon-side bridge has already pre-formatted glyphs + metrics for
 *  us. Same `blockId` semantics as the PWA: phase=start/delta/end
 *  upsert by id so a long-running thinking / search-hit stream
 *  collapses into one entry. */
export interface AsciiFeedbackBlock {
  blockId: string;
  /** Envelope kind (e.g. `agent.thinking`, `tool.diff`) — kept as a
   *  free-form string so a future kind expansion (e.g. `perf.tick`)
   *  doesn't force a TUI patch. */
  kind: string;
  /** ASCII-fallback lines the daemon emitted. Empty array is valid
   *  (envelope had no line representation) — the formatter renders
   *  nothing in that case but still surfaces the block id for
   *  diagnostics. */
  lines: readonly string[];
  /** Mirror of envelope.phase. Renderer may use this to dim or fade
   *  finalized blocks. */
  phase: 'start' | 'delta' | 'update' | 'end';
  /** Block ts — set on first envelope, NOT updated on subsequent
   *  phases so the position in the log stays stable. */
  ts: number;
}

export interface ChatMessage {
  role: ChatMessageRole;
  /** Text content. Tool / plan / thought updates land in `system`-role
   *  notes for now (`PR c` may surface them in their own pane). */
  text: string;
  /** Epoch ms — set at append time. Tests inject `opts.now`. */
  ts: number;
  /** Streaming flag — true while the assistant message is still
   *  receiving chunks. Flipped to false on prompt resolve / error. */
  streaming?: boolean;
  /** M4 PR 2 — FeedbackEnvelope-derived ASCII blocks attached to
   *  this turn. Renderer interleaves them under the message text.
   *  Optional + sparse: absent on legacy messages, empty when the
   *  envelope wire is up but no feedback fired for this turn. */
  feedbackBlocks?: AsciiFeedbackBlock[];
}

/** M4 PR 2 — minimal envelope shape the session consumes. Subset of
 *  `src/feedback/envelope.ts` FeedbackEnvelope — kept structural so
 *  the session module doesn't depend on the full envelope module's
 *  re-exports (and tests can construct plain literals). */
export interface ChatFeedbackEnvelopeLike {
  blockId: string;
  kind: string;
  phase: 'start' | 'delta' | 'update' | 'end';
  asciiFallback: readonly string[];
}

/** Minimal AcpAgent surface NexusChatSession needs. Mirrors the live
 *  `AcpAgent` class but typed structurally so tests can inject a
 *  fake without subclassing. */
export interface AcpAgentLike {
  newSession(): Promise<string>;
  prompt(
    sessionId: string,
    blocks: ContentBlock[],
    onUpdate: (update: SessionUpdate) => void,
    meta?: Record<string, unknown>,
  ): Promise<{ stopReason: string }>;
  cancel(sessionId: string): Promise<void>;
}

export interface NexusChatAgentManagerLike {
  getAgent(
    backendId: string,
    opts?: { cwd?: string },
  ): Promise<AcpAgentLike>;
}

export interface NexusChatSessionOpts {
  /** Resolved backend kind (from `resolveChatBackend` / TabSpec.meta).
   *  When 'none' the session boots inert — sendUserMessage rejects
   *  cleanly with a documented error. */
  backend: ChatBackendKind;
  /** Working dir handed to the ACP agent at attach time. Defaults to
   *  `process.cwd()` — production callers pass the nexus working dir
   *  or a per-tab cwd switch (future). */
  cwd?: string;
  /** Agent manager DI. Production omits + we delegate to the global
   *  singleton; tests pass a fake. */
  agentManager?: NexusChatAgentManagerLike;
  /** Wall-clock seam for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Soft error sink — invoked when the prompt loop fails so the host
   *  view can surface a banner. The session also records the error in
   *  `getLastError()`. Optional — no-op when omitted. */
  onError?: (err: Error) => void;
}

/** Per-tab chat session — one resolved backend, one ACP session id,
 *  growing message log. Re-rendering hooks (`subscribe`) fire after
 *  every mutation so the view stays current without polling.
 *
 *  Lifecycle:
 *
 *    new NexusChatSession({backend: 'claude-code'})
 *      → status='inert' if backend='none', else 'idle'
 *
 *    sendUserMessage("hi")
 *      → status='attaching' (first turn lazily creates the agent)
 *      → status='streaming' (chunks flow into the trailing assistant msg)
 *      → status='idle' on stopReason
 *
 *    cancel()
 *      → fires agent.cancel(sessionId); the in-flight prompt resolves
 *        with stopReason='cancelled'; status returns to 'idle'.
 */
export class NexusChatSession {
  private readonly opts: NexusChatSessionOpts;
  private readonly acpId: AcpBackendIdLike | null;
  private readonly messages: ChatMessage[] = [];
  private readonly subscribers = new Set<() => void>();
  private status: ChatSessionStatus;
  private agent: AcpAgentLike | null = null;
  private sessionId: string | null = null;
  private lastError: Error | null = null;
  /** PR c — compose buffer for the user's pending message. The TUI
   *  key dispatcher appends printable chars + handles backspace; the
   *  view footer renders the buffer with a caret hint. submitCompose()
   *  is the atomic flush. Kept inside the session (vs. a free-floating
   *  state in the TUI loop) so a future external trigger (e.g. push
   *  notification with a queued reply) can use the same primitive. */
  private composeBuffer = '';

  constructor(opts: NexusChatSessionOpts) {
    this.opts = opts;
    this.acpId = nexusBackendToAcpId(opts.backend);
    this.status = this.acpId === null ? 'inert' : 'idle';
  }

  // ── public read API ─────────────────────────────────────────────

  getStatus(): ChatSessionStatus {
    return this.status;
  }

  getMessages(): readonly ChatMessage[] {
    return this.messages;
  }

  getBackend(): ChatBackendKind {
    return this.opts.backend;
  }

  /** Last soft error (cleared on successful sendUserMessage). */
  getLastError(): Error | null {
    return this.lastError;
  }

  /** ACP session id once `attach()` has minted one. Useful for
   *  PR c's input wiring (e.g. status bar pill). */
  getAcpSessionId(): string | null {
    return this.sessionId;
  }

  // ── compose buffer (PR c) ───────────────────────────────────────

  /** Current pending user input (rendered as the chat view's footer).
   *  Empty string when the buffer is clear. */
  getCompose(): string {
    return this.composeBuffer;
  }

  /** Append a printable character or string to the compose buffer.
   *  Empty input is a no-op. Notifies subscribers so the view footer
   *  re-renders. */
  appendCompose(text: string): void {
    if (text.length === 0) return;
    this.composeBuffer += text;
    this.notify();
  }

  /** Drop the trailing character. No-op when the buffer is empty.
   *  Returns the number of chars actually removed (0 or 1) so callers
   *  can decide whether to fall through to other handlers. */
  backspaceCompose(): number {
    if (this.composeBuffer.length === 0) return 0;
    this.composeBuffer = this.composeBuffer.slice(0, -1);
    this.notify();
    return 1;
  }

  /** Clear the buffer without sending. Used by Esc when no turn is
   *  in flight + by submitCompose internally. */
  clearCompose(): void {
    if (this.composeBuffer.length === 0) return;
    this.composeBuffer = '';
    this.notify();
  }

  /** Atomic flush: snapshot the buffer, clear it, then send via
   *  sendUserMessage. Returns null when the buffer is empty (or
   *  whitespace-only) so callers don't fire a no-op turn. The buffer
   *  is cleared in *both* paths (sent and skipped) so Enter always
   *  consumes the user's keystroke — leaving stale whitespace would
   *  surprise the next keypress. Errors propagate from
   *  sendUserMessage; the buffer stays cleared (intentional —
   *  re-typing is the right UX after a soft error). */
  async submitCompose(): Promise<{ stopReason: string } | null> {
    const text = this.composeBuffer.trim();
    if (this.composeBuffer.length > 0) {
      this.composeBuffer = '';
      this.notify();
    }
    if (text.length === 0) return null;
    return this.sendUserMessage(text);
  }

  // ── subscription ────────────────────────────────────────────────

  /** Re-render hook. Caller registers once; the closure fires after
   *  every status / message-log mutation. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }

  private notify(): void {
    for (const fn of this.subscribers) {
      try { fn(); } catch { /* observer must not break the session */ }
    }
  }

  // ── mutation API ────────────────────────────────────────────────

  /** Append a system note (e.g., status banner from PR c). Returns
   *  the index for callers that want to update it later. */
  appendSystemNote(text: string): number {
    const idx = this.messages.length;
    this.messages.push({ role: 'system', text, ts: this.now() });
    this.notify();
    return idx;
  }

  /** M4 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
   *  Apply a FeedbackEnvelope to the currently-streaming assistant
   *  message (or the most recent assistant message if no turn is in
   *  flight). Upserts the block list by envelope.blockId so multi-
   *  phase envelopes (thinking start → delta → end · search-hit
   *  delta append) collapse into one entry.
   *
   *  Returns `'applied'` when the block list mutated, `'skipped'`
   *  when there was no assistant message to attach to (e.g. envelope
   *  arrived before the first user turn). Never throws — wire glue
   *  must not break the chat session.
   *
   *  Caller (process-wide envelope bus subscriber, when wired in a
   *  follow-up) routes envelopes to the right session by sessionId.
   *  The session itself does not subscribe — keeping the dependency
   *  surface minimal and testable. */
  applyFeedbackEnvelope(env: ChatFeedbackEnvelopeLike): 'applied' | 'skipped' {
    if (typeof env.blockId !== 'string' || env.blockId.length === 0) {
      return 'skipped';
    }
    // Attach to the latest assistant message — streaming first, else
    // the most recent assistant entry. If neither exists, the
    // envelope is dropped (the user hasn't started a turn yet; a
    // future caller can append a synthetic placeholder if needed).
    let target = this.findStreamingAssistantIdx();
    if (target === -1) target = this.findLastAssistantIdx();
    if (target === -1) return 'skipped';
    const msg = this.messages[target]!;
    const blocks = msg.feedbackBlocks ?? [];
    const idx = blocks.findIndex((b) => b.blockId === env.blockId);
    const existingTs = idx === -1 ? this.now() : blocks[idx]!.ts;
    const next: AsciiFeedbackBlock = {
      blockId: env.blockId,
      kind: env.kind,
      phase: env.phase,
      lines: env.asciiFallback.slice(),
      ts: existingTs,
    };
    const nextBlocks = idx === -1
      ? [...blocks, next]
      : blocks.map((b, i) => (i === idx ? next : b));
    msg.feedbackBlocks = nextBlocks;
    this.notify();
    return 'applied';
  }

  private findStreamingAssistantIdx(): number {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const m = this.messages[i]!;
      if (m.role === 'assistant' && m.streaming) return i;
    }
    return -1;
  }

  private findLastAssistantIdx(): number {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i]!.role === 'assistant') return i;
    }
    return -1;
  }

  /** Send a user message and stream the assistant reply. Resolves
   *  when the agent's prompt resolves (stopReason set). Errors
   *  surface via `getLastError()` + the optional `onError` hook +
   *  trailing system note in the log. */
  async sendUserMessage(text: string): Promise<{ stopReason: string }> {
    if (this.acpId === null) {
      const err = new Error(
        'chat backend is "none" — set global.chat.defaultBackend (or tabs.<id>.backend) to claude-code|codex',
      );
      this.recordError(err);
      throw err;
    }
    if (this.status === 'streaming' || this.status === 'attaching') {
      const err = new Error('chat session already has a turn in flight');
      this.recordError(err);
      throw err;
    }
    this.lastError = null;

    // 1. push the user message synchronously so the view can paint
    //    immediately; the assistant placeholder follows.
    this.messages.push({ role: 'user', text, ts: this.now() });
    const assistantIdx = this.messages.length;
    this.messages.push({ role: 'assistant', text: '', ts: this.now(), streaming: true });
    this.notify();

    // 2. lazy attach + session-create on the first turn so the boot
    //    cost (subprocess spawn) only hits when the user actually
    //    sends something.
    let agent: AcpAgentLike;
    let sessionId: string;
    try {
      this.status = 'attaching';
      this.notify();
      agent = await this.ensureAgent();
      sessionId = await this.ensureSession(agent);
    } catch (err) {
      this.markAssistantNotStreaming(assistantIdx);
      this.recordError(err as Error);
      throw err;
    }

    // 3. stream the prompt. Chunk handler accumulates text into the
    //    placeholder assistant message; non-text update kinds are
    //    ignored at this PR (PR c will surface tool-call / plan /
    //    thought as system notes).
    this.status = 'streaming';
    this.notify();
    try {
      const result = await agent.prompt(
        sessionId,
        [{ type: 'text', text }],
        (update) => this.onSessionUpdate(update, assistantIdx),
      );
      this.markAssistantNotStreaming(assistantIdx);
      this.status = 'idle';
      this.notify();
      return result;
    } catch (err) {
      this.markAssistantNotStreaming(assistantIdx);
      this.recordError(err as Error);
      throw err;
    }
  }

  /** Cancel the in-flight turn. Resolves immediately; the prompt's
   *  awaiter resolves with stopReason='cancelled'. No-op when idle. */
  async cancel(): Promise<void> {
    if (this.status !== 'streaming' && this.status !== 'attaching') return;
    if (!this.agent || !this.sessionId) return;
    try { await this.agent.cancel(this.sessionId); }
    catch (err) { this.recordError(err as Error); }
  }

  // ── internal ────────────────────────────────────────────────────

  private async ensureAgent(): Promise<AcpAgentLike> {
    if (this.agent) return this.agent;
    if (this.acpId === null) throw new Error('inert session has no agent');
    const manager = this.opts.agentManager
      ?? (globalAcpAgentManager() as unknown as NexusChatAgentManagerLike);
    const cwd = this.opts.cwd ?? process.cwd();
    this.agent = await manager.getAgent(this.acpId, { cwd });
    return this.agent;
  }

  private async ensureSession(agent: AcpAgentLike): Promise<string> {
    if (this.sessionId) return this.sessionId;
    this.sessionId = await agent.newSession();
    return this.sessionId;
  }

  private onSessionUpdate(update: SessionUpdate, assistantIdx: number): void {
    // Only `agent_message_chunk` (text) is wired in PR b. Other kinds
    // (tool_call, plan, agent_thought_chunk, …) are accepted but
    // ignored so the prompt still resolves cleanly when the agent
    // emits them — PR c routes them into a dedicated render path.
    if (update.sessionUpdate !== 'agent_message_chunk') return;
    const c = (update as { content?: unknown }).content as
      | { type?: string; text?: string }
      | undefined;
    if (!c || c.type !== 'text' || typeof c.text !== 'string') return;
    const msg = this.messages[assistantIdx];
    if (!msg) return;
    msg.text += c.text;
    this.notify();
  }

  private markAssistantNotStreaming(idx: number): void {
    const msg = this.messages[idx];
    if (msg && msg.streaming) {
      msg.streaming = false;
      this.notify();
    }
  }

  private recordError(err: Error): void {
    this.lastError = err;
    this.status = 'error';
    this.messages.push({
      role: 'system',
      text: `error: ${err.message}`,
      ts: this.now(),
    });
    this.notify();
    try { this.opts.onError?.(err); }
    catch { /* swallow */ }
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }
}

/** PR c — registry that runNexus / shell / tui-render share so the
 *  per-tab chat session can be looked up by spec id without circular
 *  imports. A bare Map alias keeps the intent obvious in signatures
 *  without adding a class wrapper that has no behavior of its own. */
export type NexusChatSessionRegistry = Map<string, NexusChatSession>;
