import { debug } from '../debug/log.js';
import type { FocusToInputTransition } from './input/focus-transition.js';
import {
  isChatMainInputForegroundActive,
  type ChatMainInputVisibilityState,
} from './input/chat-main-visibility.js';
import {
  resolveDashboardVoiceDictationAction,
} from './input/voice-dictation.js';
import type { VoiceBrand } from '../voice/voice-prefix-router.js';
import type { SessionResolution } from '../voice/voice-input-bridge.js';

export interface DashboardVoiceRuntimeSession {
  id: string;
  launchSpec: { brand: string };
  send(input: string): Promise<void>;
}

export interface DashboardVoiceRuntimeLiveSessionEntry {
  session: DashboardVoiceRuntimeSession;
  paneId: string;
  windowId: number;
  ptyId: string;
}

export interface DashboardVoiceRuntimeDeps {
  listLiveSessions: () => readonly DashboardVoiceRuntimeLiveSessionEntry[];
  findLiveSessionById: (sessionId: string) => DashboardVoiceRuntimeLiveSessionEntry | undefined;
  findLiveSessionByPaneId: (paneId: string) => DashboardVoiceRuntimeLiveSessionEntry | undefined;
  getFocusedConversationSessionId: () => string | null | undefined;
  getFocusedVirtualWindowPane: () => {
    vwId: number | null;
    paneId: string | null;
    paneKind: string | null;
  };
  noteUserSubmit: (sessionId: string, text: string) => void;
  // Result is awaited-and-discarded here, so accept any resolution value
  // (the concrete manager returns Promise<ClientSessionSendResult>).
  clientSessionSend: (opts: { sessionId: string; message: string }) => Promise<unknown>;
  getWorkingFocus: () => ChatMainInputVisibilityState['workingFocus'];
  getChatMainInputVisibilityState: () => ChatMainInputVisibilityState;
  chatMainPromptLive: () => boolean;
  insertIntoChatMainPrompt: (text: string) => void;
  appendInputPrefixInline: (text: string) => void;
  applyFocusToInputTransition: (transition: FocusToInputTransition) => void;
  setPendingInputEntryModePlain: () => void;
  draw: () => void;
}

export interface DashboardVoiceRuntime {
  resolveSession: (brand: VoiceBrand | null) => SessionResolution | null;
  submitToSession: (sessionId: string, text: string) => Promise<void>;
  dictateTranscript: (text: string) => boolean;
}

const VOICE_BRAND_ALIASES: Readonly<Record<VoiceBrand, readonly string[]>> = {
  claude: ['claude-code', 'claude'],
  codex:  ['codex'],
  gemini: ['gemini'],
  elanous:  ['elanous', 'elanous-child'],
};

export function createDashboardVoiceRuntime(
  deps: DashboardVoiceRuntimeDeps,
): DashboardVoiceRuntime {
  const resolveSession = (brand: VoiceBrand | null): SessionResolution | null => {
    const live = deps.listLiveSessions();
    if (brand) {
      const candidates = VOICE_BRAND_ALIASES[brand];
      const match = live.find((entry) => {
        const launchBrand = entry.session.launchSpec.brand;
        return candidates.some((c) => launchBrand === c || launchBrand.startsWith(c));
      });
      if (debug.enabled) {
        debug.log('voice.resolve', 'brand', {
          brand,
          candidates,
          liveCount: live.length,
          liveBrands: live.map((e) => e.session.launchSpec.brand),
          matched: match?.session.id ?? null,
        });
      }
      return match ? { sessionId: match.session.id } : null;
    }

    const focusedConv = deps.getFocusedConversationSessionId();
    if (debug.enabled) {
      debug.log('voice.resolve', 'fallback.a.conv-popup', {
        focusedConv: focusedConv ?? null,
        liveCount: live.length,
      });
    }
    if (focusedConv) return { sessionId: focusedConv };

    try {
      const pane = deps.getFocusedVirtualWindowPane();
      const entry = pane.paneId ? deps.findLiveSessionByPaneId(pane.paneId) : undefined;
      if (debug.enabled) {
        debug.log('voice.resolve', 'fallback.c.vw-pane', {
          vwId: pane.vwId,
          paneId: pane.paneId,
          paneKind: pane.paneKind,
          matchedSessionId: entry?.session.id ?? null,
        });
      }
      if (entry) return { sessionId: entry.session.id };
    } catch (err) {
      if (debug.enabled) {
        debug.log('voice.resolve', 'fallback.c.error', {
          err: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }

    if (debug.enabled) {
      debug.log('voice.resolve', 'exhausted', {
        liveCount: live.length,
        liveSessions: live.map((e) => ({ id: e.session.id, brand: e.session.launchSpec.brand })),
      });
    }
    return null;
  };

  const submitToSession = async (sessionId: string, text: string): Promise<void> => {
    const entry = deps.findLiveSessionById(sessionId);
    if (entry) {
      const submitText = text.endsWith('\n') ? text : `${text}\n`;
      await entry.session.send(submitText);
      return;
    }
    try {
      deps.noteUserSubmit(sessionId, text);
    } catch (err) {
      if (debug.enabled) {
        debug.log('voice.submit', 'noteUserSubmit-error', {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
    await deps.clientSessionSend({ sessionId, message: text });
  };

  const dictateTranscript = (text: string): boolean => {
    const action = resolveDashboardVoiceDictationAction({
      text,
      workingFocus: deps.getWorkingFocus(),
      chatMainForegroundActive: isChatMainInputForegroundActive(
        deps.getChatMainInputVisibilityState(),
      ),
      chatMainPromptLive: deps.chatMainPromptLive(),
    });
    if (action.kind === 'skip') return false;
    if (action.kind === 'insert-live-chat-main') {
      deps.insertIntoChatMainPrompt(action.text);
      deps.draw();
      return true;
    }
    deps.appendInputPrefixInline(action.text);
    if (action.transition) {
      deps.applyFocusToInputTransition(action.transition);
    } else {
      deps.setPendingInputEntryModePlain();
    }
    deps.draw();
    return true;
  };

  return {
    resolveSession,
    submitToSession,
    dictateTranscript,
  };
}
