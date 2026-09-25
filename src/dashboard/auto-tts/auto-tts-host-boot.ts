// PR-S1V.7 (sprint 22 Phase 2 · 2026-04-29) — Boot helper for the
// auto-TTS controller.
//
// Mirrors the shape of `voice-host-boot.ts` and `capture-source-provider-
// boot.ts` — `bootDashboardAutoTts(deps)` returns a small bag of values
// the dashboard wires into its existing dispatch path:
//
//   const autoTts = bootDashboardAutoTts({ ... });
//   dispatchDashboardChatMainAcpSend({
//     ...,
//     autoTtsHooks: autoTts.hooks,
//   });
//   abortCtrl.signal.addEventListener('abort', () => autoTts.controller.cancel());
//
// `MONAD_AUTO_TTS=1` flips `initiallyEnabled` on at boot. `MONAD_AUTO_TTS_MAX_LENGTH`
// caps segmenter buffer growth. Provider id resolves through the same
// `resolveTTSProviderIdFromEnv` used by `scripts/tts-test.ts` so a user
// running with `TTS_PROVIDER=edge-tts` gets free TTS on Phase 2 too.

import { createAudioPlayer, type AudioPlayer } from '../../voice/playback/audio-player.js';
import {
  createTTSProvider,
  resolveTTSProviderIdFromEnv,
  type TTSProvider,
  type TTSProviderConfig,
  type TTSProviderId,
} from '../../voice/tts/tts-provider.js';
import {
  createAutoTtsController,
  type AutoTtsController,
} from './auto-tts-controller.js';

export interface BootDashboardAutoTtsOpts {
  /** When omitted, looks at `process.env.MONAD_AUTO_TTS` ("1" / "true"
   *  / "on" enables, anything else disables). Tests pass an explicit
   *  bool so they don't depend on env state. Dashboard reads this
   *  from `getUserConfig().voice.tts.auto`. */
  initiallyEnabled?: boolean;
  /** When omitted, falls back to `MONAD_AUTO_TTS_MAX_LENGTH` env or
   *  segmenter default. Dashboard reads from
   *  `getUserConfig().voice.tts.maxSentenceChars`. */
  maxSentenceChars?: number;
  /** Override the provider — tests pass an in-memory mock. Production
   *  reads `TTS_PROVIDER` env via `resolveTTSProviderIdFromEnv`. */
  createProvider?: () => Promise<TTSProvider>;
  /** Override the audio player — tests inject a fake. */
  createAudioPlayer?: () => AudioPlayer;
  /** Hook invoked when the controller's enabled-state flips. Wire to
   *  the dashboard status bar / toast. */
  onEnabledChange?: (enabled: boolean) => void;
  /** TTS provider id override. Highest precedence; when omitted,
   *  resolves from `TTS_PROVIDER` env then default `'openai-tts'`.
   *  Dashboard reads from `getUserConfig().voice.tts.provider`. */
  providerId?: TTSProviderId;
}

export interface BootDashboardAutoTtsResult {
  controller: AutoTtsController;
  /** Pre-bound hooks ready to drop into the chat dispatch deps. */
  hooks: {
    pushChunk: (delta: string) => void;
    commit: () => Promise<void>;
    cancel: () => Promise<void>;
  };
  /** Provider id the controller will create on first use — surface in
   *  the status bar / `/auto-tts status` slash. */
  providerId: TTSProviderId;
}

export function bootDashboardAutoTts(
  opts: BootDashboardAutoTtsOpts = {},
): BootDashboardAutoTtsResult {
  const initiallyEnabled = opts.initiallyEnabled ?? readEnvFlag('MONAD_AUTO_TTS');
  const maxFromEnv = readEnvInt('MONAD_AUTO_TTS_MAX_LENGTH');
  const maxSentenceChars = opts.maxSentenceChars ?? maxFromEnv;

  // Priority: opts.providerId (= user-config from dashboard) > env > default.
  const providerId = resolveTTSProviderIdFromEnv(undefined, {
    ...(opts.providerId ? { configOverride: opts.providerId } : {}),
  });
  const createProvider = opts.createProvider ?? (() => createTTSProvider(buildProviderConfig(providerId)));

  const controller = createAutoTtsController({
    createProvider,
    createAudioPlayer: opts.createAudioPlayer ?? (() => createAudioPlayer()),
    initiallyEnabled,
    ...(maxSentenceChars !== undefined ? { maxSentenceChars } : {}),
    ...(opts.onEnabledChange ? { onEnabledChange: opts.onEnabledChange } : {}),
  });

  return {
    controller,
    hooks: {
      pushChunk: (delta) => controller.pushChunk(delta),
      commit: () => controller.commit(),
      cancel: () => controller.cancel(),
    },
    providerId,
  };
}

function buildProviderConfig(id: TTSProviderId): TTSProviderConfig {
  switch (id) {
    case 'openai-tts':
      return { id: 'openai-tts' };
    case 'elevenlabs-tts':
      return { id: 'elevenlabs-tts' };
    case 'edge-tts':
      return { id: 'edge-tts' };
    case 'macos-say':
      return { id: 'macos-say' };
  }
}

function readEnvFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

function readEnvInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

// ── Slash-command handler factory ──────────────────────────────────

/** Map a `/auto-tts <subcommand>` invocation to controller actions.
 *  Returns a status string for the dashboard to surface (toast / chat
 *  log). Used both by the slash router and by tests. */
export function handleAutoTtsSlash(
  controller: AutoTtsController,
  providerId: TTSProviderId,
  args: readonly string[],
): string {
  const sub = (args[0] ?? 'status').toLowerCase();
  switch (sub) {
    case 'on':
    case 'enable': {
      controller.enable();
      return `auto-TTS on (provider: ${providerId})`;
    }
    case 'off':
    case 'disable': {
      controller.disable();
      return 'auto-TTS off';
    }
    case 'toggle': {
      const now = controller.toggle();
      return `auto-TTS ${now ? 'on' : 'off'} (provider: ${providerId})`;
    }
    case 'status':
    case '': {
      const e = controller.isEnabled();
      const s = controller.isSpeaking();
      return `auto-TTS ${e ? 'on' : 'off'} · provider=${providerId}${s ? ' · speaking' : ''}`;
    }
    default:
      return `auto-TTS: unknown subcommand "${sub}". use on/off/toggle/status`;
  }
}
