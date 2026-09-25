// ── C5 (Phase 3 Bundle 3) — persona ambient (posture trigger) ──
//
// HANDOFF Phase 3 / ROADMAP §6 C5: "persona ambient (posture trigger)".
// monad 가 Discord 채널에 ambient observer 로 가만히 있다가, substrate
// posture 변화 (특히 user-interactive → unavailable, 즉 shell 죽음) 을
// 감지하면 channel 에 자동 메시지.
//
// T1 (PFC reverse-feedback) 와 비슷하지만 sink 가 chat-line 대신 Discord
// channel post. C2 의 persona capability gate 통과 후 적절한 persona ID
// 로 post.

import type {
  ShellPostureEvent,
  ShellRegistry,
  Unsubscribe,
} from '../shell-runner/types.js';
import type { TerminalUserExposure } from '../terminal/posture.js';
import type { ChannelPost, DiscordChannel } from './shell-channel-orchestrator.js';
import type { PersonaCapabilityRouter } from './persona-capability-router.js';

export interface AmbientObserverDeps {
  registry: ShellRegistry;
  /** Channels to observe. Empty = no observation (runtime stop). */
  channels: readonly DiscordChannel[];
  /** Persona used for ambient posts — must have 'read' capability. */
  observerPersona: string;
  /** Persona router — gate check before posting. */
  personaRouter: PersonaCapabilityRouter;
  channelPost: (post: ChannelPost) => Promise<void>;
  /** Compose post message — defaults to terse 한국어 form. */
  composeMessage?: (event: AmbientPostureEvent) => string;
  /** Throttle — 같은 channel + shellId 의 연속 이벤트 cap. Default 5s. */
  throttleMs?: number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface AmbientPostureEvent {
  readonly channel: DiscordChannel;
  readonly shellId: string;
  readonly prev: TerminalUserExposure | null;
  readonly next: TerminalUserExposure | null;
  /** Whether this transitioned to 'unavailable' (death). */
  readonly isDeath: boolean;
}

export interface AmbientObserver {
  /** Diagnostic — events processed since start. */
  count(): number;
  /** Stop observation. Idempotent. */
  stop(): void;
}

const DEFAULT_THROTTLE_MS = 5000;

function defaultCompose(event: AmbientPostureEvent): string {
  if (event.isDeath) {
    return `🪦 \`${event.shellId}\` 종료 (#${event.channel.name})`;
  }
  return `📡 \`${event.shellId}\` ${event.prev ?? '?'} → ${event.next ?? '?'}`;
}

export function createAmbientObserver(deps: AmbientObserverDeps): AmbientObserver {
  let unsubscribe: Unsubscribe | null = null;
  let processed = 0;
  const compose = deps.composeMessage ?? defaultCompose;
  const throttle = deps.throttleMs ?? DEFAULT_THROTTLE_MS;
  const lastPost = new Map<string, number>(); // key = channelId::shellId

  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  const dispatch = (postureEvent: ShellPostureEvent): void => {
    if (deps.channels.length === 0) return;

    // Capability gate — observer persona must have 'read' for THIS context.
    for (const channel of deps.channels) {
      const decision = deps.personaRouter.decide({
        persona: deps.observerPersona,
        action: 'read',
        channelId: channel.id,
        shellId: postureEvent.shellId,
      });
      if (!decision.allowed) {
        log('discord.ambient.gate-blocked', postureEvent.shellId, {
          channel: channel.id,
          reason: decision.reason,
        });
        continue;
      }

      // Throttle
      const key = `${channel.id}::${postureEvent.shellId}`;
      const now = Date.now();
      const last = lastPost.get(key);
      if (last !== undefined && now - last < throttle) {
        log('discord.ambient.throttled', postureEvent.shellId, { channelId: channel.id });
        continue;
      }
      lastPost.set(key, now);

      const isDeath = postureEvent.next?.userExposure === 'unavailable'
        && postureEvent.prev?.userExposure !== 'unavailable';

      const event: AmbientPostureEvent = {
        channel,
        shellId: postureEvent.shellId,
        prev: postureEvent.prev?.userExposure ?? null,
        next: postureEvent.next?.userExposure ?? null,
        isDeath,
      };

      const message = compose(event);
      void deps.channelPost({ channelId: channel.id, message }).catch((err) => {
        log('discord.ambient.post-throw', postureEvent.shellId, {
          channel: channel.id,
          error: String(err),
        });
      });
      processed += 1;
      log('discord.ambient.posted', postureEvent.shellId, {
        channel: channel.id,
        isDeath,
      });
    }
  };

  unsubscribe = deps.registry.subscribePosture(dispatch);

  return {
    count() {
      return processed;
    },
    stop() {
      if (unsubscribe) {
        try { unsubscribe(); } catch { /* idempotent */ }
        unsubscribe = null;
      }
    },
  };
}
