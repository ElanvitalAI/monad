// Sprint 22 follow-up (2026-04-30) — Discord voice transcript mirror.
//
// Mirrors a voice-channel session into a Discord text channel:
//   - partial STT → one editable "hearing…" line
//   - final STT   → settles the hearing line into a final transcript
//   - assistant   → one editable assistant line

import { buildTurnOutputTextBlocks } from '../../input/turn-output-block.js';
import { selectTurnOutputTextForSink } from '../../input/turn-output-sink-registry.js';

export interface DiscordVoiceTextMirrorDeps {
  sendMessage: (text: string) => Promise<{ id: string } | null>;
  editMessage: (messageId: string, text: string) => Promise<void>;
  editGapMs?: number;
}

interface StreamState {
  messageId: string | null;
  lastSentAt: number;
  pendingText: string | null;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface DiscordVoiceTextMirror {
  setListening(text?: string): void;
  pushPartial(text: string): void;
  commitFinal(text: string): Promise<void>;
  pushAssistant(fullText: string): void;
  reset(): void;
}

const DEFAULT_EDIT_GAP_MS = 1100;

export function createDiscordVoiceTextMirror(
  deps: DiscordVoiceTextMirrorDeps,
): DiscordVoiceTextMirror {
  const editGapMs = deps.editGapMs ?? DEFAULT_EDIT_GAP_MS;
  const partialState: StreamState = {
    messageId: null,
    lastSentAt: 0,
    pendingText: null,
    inFlight: false,
    timer: null,
  };
  const assistantState: StreamState = {
    messageId: null,
    lastSentAt: 0,
    pendingText: null,
    inFlight: false,
    timer: null,
  };

  function clearTimer(state: StreamState): void {
    if (!state.timer) return;
    clearTimeout(state.timer);
    state.timer = null;
  }

  async function sendOrEdit(
    state: StreamState,
    text: string,
  ): Promise<void> {
    if (!text.trim()) return;
    if (!state.messageId) {
      const posted = await deps.sendMessage(text);
      state.messageId = posted?.id ?? null;
      state.lastSentAt = Date.now();
      return;
    }
    await deps.editMessage(state.messageId, text);
    state.lastSentAt = Date.now();
  }

  async function flush(
    state: StreamState,
    render: (text: string) => string,
  ): Promise<void> {
    if (state.inFlight || state.pendingText === null) return;
    clearTimer(state);
    const nextText = state.pendingText;
    state.pendingText = null;
    state.inFlight = true;
    try {
      await sendOrEdit(state, render(nextText));
    } finally {
      state.inFlight = false;
      if (state.pendingText !== null) {
        scheduleFlush(state, render);
      }
    }
  }

  function scheduleFlush(
    state: StreamState,
    render: (text: string) => string,
  ): void {
    if (state.inFlight || state.pendingText === null) return;
    const waitMs = Math.max(0, state.lastSentAt + editGapMs - Date.now());
    if (waitMs > 0) {
      if (!state.timer) {
        state.timer = setTimeout(() => {
          state.timer = null;
          void flush(state, render);
        }, waitMs);
      }
      return;
    }
    void flush(state, render);
  }

  function pushPartial(text: string): void {
    partialState.pendingText = selectTurnOutputTextForSink(
      'fan-out-discord',
      buildTurnOutputTextBlocks(text),
    ) ?? text;
    scheduleFlush(partialState, (v) => `🎙️ Hearing: ${v}`);
  }

  function setListening(text: string = 'Listening…'): void {
    partialState.pendingText = text;
    scheduleFlush(partialState, (v) => `👂 ${v}`);
  }

  async function commitFinal(text: string): Promise<void> {
    partialState.pendingText = null;
    clearTimer(partialState);
    const mirrorText = selectTurnOutputTextForSink(
      'fan-out-discord',
      buildTurnOutputTextBlocks(text),
    ) ?? text;
    await sendOrEdit(partialState, `🎙️ User: ${mirrorText}`);
  }

  function pushAssistant(fullText: string): void {
    assistantState.pendingText = selectTurnOutputTextForSink(
      'fan-out-discord',
      buildTurnOutputTextBlocks(fullText),
    ) ?? fullText;
    scheduleFlush(assistantState, (v) => `🤖 ${v}`);
  }

  function reset(): void {
    partialState.pendingText = null;
    assistantState.pendingText = null;
    partialState.inFlight = false;
    assistantState.inFlight = false;
    clearTimer(partialState);
    clearTimer(assistantState);
  }

  return {
    setListening,
    pushPartial,
    commitFinal,
    pushAssistant,
    reset,
  };
}
