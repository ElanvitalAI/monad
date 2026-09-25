import { describe, expect, mock, test } from 'bun:test';

import { createDashboardVoiceRuntime } from '../src/dashboard/voice-runtime.js';
import type { DashboardVoiceRuntimeLiveSessionEntry } from '../src/dashboard/voice-runtime.js';

function liveEntry(
  id: string,
  brand: string,
  paneId = `${id}-pane`,
): DashboardVoiceRuntimeLiveSessionEntry {
  return {
    session: {
      id,
      launchSpec: { brand },
      send: mock(async (_input: string) => {}),
    },
    paneId,
    windowId: 1,
    ptyId: `${id}-pty`,
  };
}

describe('dashboard voice runtime', () => {
  test('resolveSession matches brand aliases against live embodied sessions', () => {
    const claude = liveEntry('sess-1', 'claude-code');
    const runtime = createDashboardVoiceRuntime({
      listLiveSessions: () => [claude],
      findLiveSessionById: () => undefined,
      findLiveSessionByPaneId: () => undefined,
      getFocusedConversationSessionId: () => null,
      getFocusedVirtualWindowPane: () => ({ vwId: null, paneId: null, paneKind: null }),
      noteUserSubmit: () => {},
      clientSessionSend: async () => {},
      getWorkingFocus: () => 'browser',
      getChatMainInputVisibilityState: () => ({
        workingFocus: 'browser',
        blockingForegroundModalOpen: false,
        pluginActive: false,
        chordArmed: false,
      }),
      chatMainPromptLive: () => false,
      insertIntoChatMainPrompt: () => {},
      appendInputPrefixInline: () => {},
      applyFocusToInputTransition: () => {},
      setPendingInputEntryModePlain: () => {},
      draw: () => {},
    });

    expect(runtime.resolveSession('claude')).toEqual({ sessionId: 'sess-1' });
  });

  test('resolveSession falls back to focused conversation session before VW pane lookup', () => {
    const runtime = createDashboardVoiceRuntime({
      listLiveSessions: () => [],
      findLiveSessionById: () => undefined,
      findLiveSessionByPaneId: () => undefined,
      getFocusedConversationSessionId: () => 'conv-1',
      getFocusedVirtualWindowPane: () => ({ vwId: 9, paneId: 'pane-1', paneKind: 'pty-tail' }),
      noteUserSubmit: () => {},
      clientSessionSend: async () => {},
      getWorkingFocus: () => 'browser',
      getChatMainInputVisibilityState: () => ({
        workingFocus: 'browser',
        blockingForegroundModalOpen: false,
        pluginActive: false,
        chordArmed: false,
      }),
      chatMainPromptLive: () => false,
      insertIntoChatMainPrompt: () => {},
      appendInputPrefixInline: () => {},
      applyFocusToInputTransition: () => {},
      setPendingInputEntryModePlain: () => {},
      draw: () => {},
    });

    expect(runtime.resolveSession(null)).toEqual({ sessionId: 'conv-1' });
  });

  test('submitToSession appends newline for PTY embodied sessions', async () => {
    const entry = liveEntry('pty-1', 'codex');
    const runtime = createDashboardVoiceRuntime({
      listLiveSessions: () => [],
      findLiveSessionById: (id) => (id === 'pty-1' ? entry : undefined),
      findLiveSessionByPaneId: () => undefined,
      getFocusedConversationSessionId: () => null,
      getFocusedVirtualWindowPane: () => ({ vwId: null, paneId: null, paneKind: null }),
      noteUserSubmit: () => {},
      clientSessionSend: async () => {},
      getWorkingFocus: () => 'browser',
      getChatMainInputVisibilityState: () => ({
        workingFocus: 'browser',
        blockingForegroundModalOpen: false,
        pluginActive: false,
        chordArmed: false,
      }),
      chatMainPromptLive: () => false,
      insertIntoChatMainPrompt: () => {},
      appendInputPrefixInline: () => {},
      applyFocusToInputTransition: () => {},
      setPendingInputEntryModePlain: () => {},
      draw: () => {},
    });

    await runtime.submitToSession('pty-1', 'hello');

    expect(entry.session.send).toHaveBeenCalledWith('hello\n');
  });

  test('submitToSession routes ACP sessions through noteUserSubmit plus client send', async () => {
    const noteUserSubmit = mock(() => {});
    const clientSessionSend = mock(async (_opts: { sessionId: string; message: string }) => {});
    const runtime = createDashboardVoiceRuntime({
      listLiveSessions: () => [],
      findLiveSessionById: () => undefined,
      findLiveSessionByPaneId: () => undefined,
      getFocusedConversationSessionId: () => null,
      getFocusedVirtualWindowPane: () => ({ vwId: null, paneId: null, paneKind: null }),
      noteUserSubmit,
      clientSessionSend,
      getWorkingFocus: () => 'browser',
      getChatMainInputVisibilityState: () => ({
        workingFocus: 'browser',
        blockingForegroundModalOpen: false,
        pluginActive: false,
        chordArmed: false,
      }),
      chatMainPromptLive: () => false,
      insertIntoChatMainPrompt: () => {},
      appendInputPrefixInline: () => {},
      applyFocusToInputTransition: () => {},
      setPendingInputEntryModePlain: () => {},
      draw: () => {},
    });

    await runtime.submitToSession('acp-1', 'hello');

    expect(noteUserSubmit).toHaveBeenCalledWith('acp-1', 'hello');
    expect(clientSessionSend).toHaveBeenCalledWith({ sessionId: 'acp-1', message: 'hello' });
  });

  test('dictateTranscript inserts directly into a live chat-main prompt', () => {
    const insertIntoChatMainPrompt = mock((_text: string) => {});
    const draw = mock(() => {});
    const runtime = createDashboardVoiceRuntime({
      listLiveSessions: () => [],
      findLiveSessionById: () => undefined,
      findLiveSessionByPaneId: () => undefined,
      getFocusedConversationSessionId: () => null,
      getFocusedVirtualWindowPane: () => ({ vwId: null, paneId: null, paneKind: null }),
      noteUserSubmit: () => {},
      clientSessionSend: async () => {},
      getWorkingFocus: () => 'input',
      getChatMainInputVisibilityState: () => ({
        workingFocus: 'input',
        blockingForegroundModalOpen: false,
        pluginActive: false,
        chordArmed: false,
      }),
      chatMainPromptLive: () => true,
      insertIntoChatMainPrompt,
      appendInputPrefixInline: () => {},
      applyFocusToInputTransition: () => {},
      setPendingInputEntryModePlain: () => {},
      draw,
    });

    expect(runtime.dictateTranscript('hello world')).toBe(true);
    expect(insertIntoChatMainPrompt).toHaveBeenCalledWith('hello world');
    expect(draw).toHaveBeenCalled();
  });

  test('dictateTranscript late-binds applyFocusToInputTransition / draw via lazy wrappers (boot-order regression guard)', () => {
    // Regression guard for PR #1111: the dashboard's voiceRuntime deps
    // must look up `applyFocusToInputTransition` (declared as `const`
    // further down in showDashboard) and `draw` (declared as a `let`
    // placeholder no-op that's reassigned to the real renderer later)
    // at *call time*, not at deps-object-construction time. A shorthand
    // property like `applyFocusToInputTransition,` would either (a)
    // crash with a TDZ ReferenceError during boot or (b) silently
    // capture the placeholder. This test simulates the production
    // pattern (lazy wrapper that re-reads the outer reference on every
    // call) and proves that reassigning the references after voiceRuntime
    // is built still flows through to the deps callbacks.
    let liveApply = mock((_transition: unknown) => {});
    let liveDraw = mock(() => {});

    const runtime = createDashboardVoiceRuntime({
      listLiveSessions: () => [],
      findLiveSessionById: () => undefined,
      findLiveSessionByPaneId: () => undefined,
      getFocusedConversationSessionId: () => null,
      getFocusedVirtualWindowPane: () => ({ vwId: null, paneId: null, paneKind: null }),
      noteUserSubmit: () => {},
      clientSessionSend: async () => {},
      getWorkingFocus: () => 'browser',
      getChatMainInputVisibilityState: () => ({
        workingFocus: 'browser',
        blockingForegroundModalOpen: false,
        pluginActive: false,
        chordArmed: false,
      }),
      chatMainPromptLive: () => false,
      insertIntoChatMainPrompt: () => {},
      appendInputPrefixInline: () => {},
      // Lazy wrappers mirror dashboard/index.ts:4614-4616 — the deps
      // value is a closure that re-reads the outer `let` on every call
      // instead of capturing it at construction time.
      applyFocusToInputTransition: (transition) => liveApply(transition),
      setPendingInputEntryModePlain: () => {},
      draw: () => liveDraw(),
    });

    // Reassign — simulates the dashboard scope finishing its const
    // initialization between voiceRuntime construction and the first
    // dictation. With shorthand properties these mocks would never see
    // a call.
    const reassignedApply = mock((_transition: unknown) => {});
    const reassignedDraw = mock(() => {});
    liveApply = reassignedApply;
    liveDraw = reassignedDraw;

    expect(runtime.dictateTranscript('hello world')).toBe(true);

    // The reassigned mocks fire — proving the deps callbacks defer
    // their name lookup until the actual call.
    expect(reassignedApply).toHaveBeenCalledTimes(1);
    expect(reassignedDraw).toHaveBeenCalled();
  });

  test('dictateTranscript queues prefix text and opens input when chat-main is not live', () => {
    const appendInputPrefixInline = mock((_text: string) => {});
    const applyFocusToInputTransition = mock((_transition: unknown) => {});
    const draw = mock(() => {});
    const runtime = createDashboardVoiceRuntime({
      listLiveSessions: () => [],
      findLiveSessionById: () => undefined,
      findLiveSessionByPaneId: () => undefined,
      getFocusedConversationSessionId: () => null,
      getFocusedVirtualWindowPane: () => ({ vwId: null, paneId: null, paneKind: null }),
      noteUserSubmit: () => {},
      clientSessionSend: async () => {},
      getWorkingFocus: () => 'browser',
      getChatMainInputVisibilityState: () => ({
        workingFocus: 'browser',
        blockingForegroundModalOpen: false,
        pluginActive: false,
        chordArmed: false,
      }),
      chatMainPromptLive: () => false,
      insertIntoChatMainPrompt: () => {},
      appendInputPrefixInline,
      applyFocusToInputTransition,
      setPendingInputEntryModePlain: () => {},
      draw,
    });

    expect(runtime.dictateTranscript('hello world')).toBe(true);
    expect(appendInputPrefixInline).toHaveBeenCalledWith('hello world');
    expect(applyFocusToInputTransition).toHaveBeenCalled();
    expect(draw).toHaveBeenCalled();
  });
});
