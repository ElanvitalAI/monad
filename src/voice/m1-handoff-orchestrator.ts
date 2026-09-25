// ── M1 (Phase 2 Bundle 4 hero) — Multi-modal autonomous handoff ──
//
// HANDOFF Phase 2 §4 / ROADMAP §5: 출퇴근길 음성 한 마디로 *전체 fix loop*
// 자율 진행 후 음성 보고. M1 = 가장 강력한 hero scenario · Premium Tier
// v1 paid candidate.
//
// 흐름:
//   [Telegram voice] "어제 build 실패 봐줘"
//     ↓ STT
//     ↓ V2 voice-orchestrator (Bundle 2) — classify → spawn → await → speak
//     ↓ ACP H3 #6 background subagent — 사용자 telegram 끊어도 계속
//     ↓ shell 실패 시 PFC reverse-feedback (T1) + voice (V1) + capture (X4)
//     ↓ V2 가 fix candidate apply (capability gate 통과 시)
//     ↓ Telegram voice 응답: "stack trace 분석 + fix 적용 + 재실행 결과 보고"
//
// M1 의 차별 가치:
//   • Channel handoff — 사용자가 Telegram 으로 시작했지만 노트북 켰을 때
//     같은 session 으로 follow-up 가능 (`migrateChannel`)
//   • ETA report — long-running task 진행 중간에 정기 음성 보고 (`scheduleEta`)
//   • Channel-aware speak — 같은 utterance 라도 Telegram (voice msg) vs
//     TUI (auto-tts) vs PWA (WS) 별 sink 호출
//
// Pure orchestrator — host 가 channel adapter / scheduler / 세션 store 주입.

import type { VoiceOrchestrator, VoiceOrchestrationResult } from './voice-orchestrator.js';

/** Channel identity — host adapters use this to route input/output. */
export type M1ChannelKind = 'telegram' | 'tui' | 'pwa' | 'discord' | 'webhook';

export interface M1ChannelAddress {
  readonly kind: M1ChannelKind;
  /** Channel-specific id (telegram chat id / TUI session id / PWA conn id). */
  readonly id: string;
}

export interface M1Session {
  readonly id: string;
  readonly transcript: string;
  /** Channel where the session originated. */
  readonly originChannel: M1ChannelAddress;
  /** Currently active channel — equals origin until `migrateChannel`. */
  readonly activeChannel: M1ChannelAddress;
  /** Subagent spawned by V2. Null until classify+spawn succeed. */
  readonly subagentId: string | null;
  /** ISO timestamp. */
  readonly startedAt: string;
  /** Final outcome — null while running. */
  readonly finalOutcome: VoiceOrchestrationResult['outcome'] | null;
}

export interface M1HandoffOrchestratorDeps {
  /** V2 voice orchestrator (Bundle 2). */
  voiceOrchestrator: VoiceOrchestrator;
  /** Session store — persist across process restarts ideally. */
  sessionStore: {
    create(session: M1Session): Promise<void>;
    update(id: string, patch: Partial<M1Session>): Promise<void>;
    get(id: string): Promise<M1Session | null>;
    list(): Promise<readonly M1Session[]>;
  };
  /** Channel-specific speak adapter. Lookup by channel kind. */
  channelSpeak: (channel: M1ChannelAddress, sentence: string) => Promise<void>;
  /** Optional ETA scheduler — periodic mid-task voice reports. */
  scheduleEta?: (sessionId: string, intervalMs: number, fire: () => Promise<void>) => () => void;
  /** Test seam — defaults to randomUUID. */
  newSessionId?: () => string;
  /** Test seam — defaults to new Date().toISOString(). */
  now?: () => string;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface M1HandoffOrchestrator {
  /** Start a new autonomous session. Resolves when V2 completes (or
   *  fails). Mid-session ETA reports fire to the active channel. */
  start(input: {
    transcript: string;
    originChannel: M1ChannelAddress;
    etaIntervalMs?: number;
  }): Promise<M1Session>;
  /** Migrate the active channel for an in-flight session. New voice
   *  output will go to the new channel. Used when user switches
   *  device mid-task ("phone → laptop"). */
  migrateChannel(sessionId: string, channel: M1ChannelAddress): Promise<boolean>;
  /** Snapshot a session by id. */
  get(sessionId: string): Promise<M1Session | null>;
  /** Snapshot all sessions. */
  list(): Promise<readonly M1Session[]>;
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m1-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createM1HandoffOrchestrator(
  deps: M1HandoffOrchestratorDeps,
): M1HandoffOrchestrator {
  const newId = deps.newSessionId ?? defaultId;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  return {
    async start({ transcript, originChannel, etaIntervalMs }) {
      const id = newId();
      const session: M1Session = {
        id,
        transcript,
        originChannel,
        activeChannel: originChannel,
        subagentId: null,
        startedAt: now(),
        finalOutcome: null,
      };
      await deps.sessionStore.create(session);
      log('m1.handoff.start', id, { channel: originChannel });

      // Channel-aware speak — route the V2 utterance to whichever
      // channel is currently active for this session.
      const speak = async (sentence: string): Promise<void> => {
        const live = await deps.sessionStore.get(id);
        const target = live?.activeChannel ?? originChannel;
        try { await deps.channelSpeak(target, sentence); } catch (err) {
          log('m1.handoff.speak-throw', id, { error: String(err) });
        }
      };

      // Optional ETA scheduler — mid-task progress utterance.
      let cancelEta: (() => void) | null = null;
      if (deps.scheduleEta && etaIntervalMs && etaIntervalMs > 0) {
        cancelEta = deps.scheduleEta(id, etaIntervalMs, async () => {
          await speak('아직 작업 중이에요. 곧 결과를 알려드릴게요.');
        });
      }

      // Wrap V2's run with our channel-aware speak. Replace the speak
      // dep on a per-call basis by injecting a custom orchestrator?
      // V2 takes speak as a constructor dep — we can't override per
      // call. Use a different approach: V2 already has a speak fn.
      // We trust the caller wired it so V2 already knows how to
      // speak. Instead, M1 *augments* by speaking the final outcome
      // to the active channel.
      let result: VoiceOrchestrationResult;
      try {
        result = await deps.voiceOrchestrator.run({ transcript });
      } finally {
        if (cancelEta) cancelEta();
      }

      // Final speak via M1's channel-aware route — V2 already spoke
      // once via its own dep, but M1's speak goes to the *current*
      // active channel (handoff-aware). This double-speak is by design
      // — V2's speak fired at task completion; M1's may go to a
      // different device after migration.
      const liveSession = await deps.sessionStore.get(id);
      const subagentId = result.subagentId ?? null;
      const finalOutcome = result.outcome;
      const updated: M1Session = {
        id,
        transcript,
        originChannel,
        activeChannel: liveSession?.activeChannel ?? originChannel,
        subagentId,
        startedAt: session.startedAt,
        finalOutcome,
      };
      await deps.sessionStore.update(id, {
        subagentId,
        finalOutcome,
      });

      // Final boundary speak — only when the final channel differs
      // from origin (handoff happened). Otherwise V2's own speak is
      // enough and double-speak is noise.
      if (
        result.utterance &&
        liveSession &&
        liveSession.activeChannel.id !== originChannel.id
      ) {
        log('m1.handoff.final-speak-on-handoff', id, {
          from: originChannel,
          to: liveSession.activeChannel,
        });
        try {
          await deps.channelSpeak(liveSession.activeChannel, result.utterance);
        } catch (err) {
          log('m1.handoff.final-speak-throw', id, { error: String(err) });
        }
      }

      log('m1.handoff.complete', id, { outcome: finalOutcome });
      return updated;
    },

    async migrateChannel(sessionId, channel) {
      const session = await deps.sessionStore.get(sessionId);
      if (!session) {
        log('m1.handoff.migrate.no-session', sessionId);
        return false;
      }
      if (session.finalOutcome !== null) {
        log('m1.handoff.migrate.already-done', sessionId, { outcome: session.finalOutcome });
        return false;
      }
      await deps.sessionStore.update(sessionId, { activeChannel: channel });
      log('m1.handoff.migrate.ok', sessionId, { from: session.activeChannel, to: channel });
      return true;
    },

    get(sessionId) {
      return deps.sessionStore.get(sessionId);
    },

    list() {
      return deps.sessionStore.list();
    },
  };
}
