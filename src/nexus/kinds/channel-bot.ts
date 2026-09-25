// NEXUS · channel-bot kind (Phase N-2 PR θ)
//
// Wraps the telegram / discord ACP-attach bots as supervisor-managed tabs.
// The bot connects to the daemon (`monad serve`) over the unix socket
// using `--gateway-mode` (i.e., the existing `--via-daemon` pattern):
//   spawn:    [<monad>, 'telegram'|'discord', '--gateway-mode']
//   health:   ipc-ping every 30s (PR ε's default backend currently maps
//             this to process-alive; full IPC roundtrip is a follow-up
//             once Bun.spawn IPC is wired into the bot binary)
//   restart:  on-crash · backoff [10s, 30s, 60s] · maxPerHour 10
//   halt:     [401, 403, Unauthorized, "Invalid token"] — auth failures
//             never auto-recover; user must rotate the token first
//   grace:    3000ms
//
// Token sourcing per OQ2 (N-3 SwitchRegistry 까지 임시):
//   telegram → MONAD_TELEGRAM_BOT_TOKEN
//   discord  → MONAD_DISCORD_BOT_TOKEN
// If the env var is missing, the spec is still created but `meta.disabled`
// is set so the supervisor + sidebar can show the user a clear hint
// instead of looping on auth failures.
//
// External detection mirrors PR ζ daemon: if telegram.lock / discord.lock
// is alive but pid != tab.pid → status='external'.

import type { TabKind, TabSpec } from './types.js';
import { getMonadConfigDir } from '../../monad-config-dir.js';
import { defaultLockPath as defaultTelegramLockPath } from '../../telegram-lock.js';
import { defaultDiscordLockPath } from '../../discord-lock.js';
import {
  detectExternalLock,
  type DetectExternalLockResult,
} from '../supervisor/external-detect.js';
import type { TabRegistry } from '../state/tab-registry.js';
import type { NexusState } from '../state/state.js';
// PLAN-nexus-shell-followup U3 (2026-05-16) — kind-detail-view trim.
// createChannelBotTabView · summarizeChannelBot · haltHintChannelBot ·
// staticChannelBotView 모두 외부 caller 없음 (TUI sidebar 의 dead path).

export type ChannelBotPlatform = 'telegram' | 'discord';

export const CHANNEL_BOT_KIND: TabKind = 'channel-bot';
export const CHANNEL_BOT_HALT_PATTERNS = [
  '\\b401\\b',
  '\\b403\\b',
  'Unauthorized',
  'Invalid token',
] as const;

export interface ChannelBotTabOpts {
  platform: ChannelBotPlatform;
  /** Default = `<platform>:1` (e.g., `telegram:1`). */
  id?: string;
  label?: string;
  /** Argv override · default = `[<monad>, <platform>, '--gateway-mode']`. */
  command?: string[];
  cwd?: string;
  /** Extra env merged over process.env at spawn time. The platform's
   *  token env is always read from process.env at spec-creation time
   *  and surfaced in `meta.disabled` if missing — this `env` field is
   *  for non-token overrides only. */
  env?: Record<string, string>;
  /** Override the telegram/discord lock path (tests). */
  lockPath?: string;
  /** Override token env name (tests). */
  tokenEnvName?: string;
}

const TOKEN_ENV: Record<ChannelBotPlatform, string> = {
  telegram: 'MONAD_TELEGRAM_BOT_TOKEN',
  discord: 'MONAD_DISCORD_BOT_TOKEN',
};

function defaultMonadCommand(): string {
  const bin = process.argv[1];
  return bin && bin.length > 0 ? bin : 'monad';
}

function defaultLockPathFor(platform: ChannelBotPlatform): string {
  // 로컬 config-dir 스코프 lock 경로 — getMonadConfigDir() 치환 prod 동치(~/.monad) + --config-dir 정합.
  const configDir = getMonadConfigDir();
  return platform === 'telegram'
    ? defaultTelegramLockPath(configDir)
    : defaultDiscordLockPath(configDir);
}

export interface ChannelBotMeta {
  platform: ChannelBotPlatform;
  tokenEnvName: string;
  /** True when the relevant token env was missing at spec-creation time.
   *  Supervisor must not call startTab on a disabled spec. */
  disabled: boolean;
  /** Why disabled (when disabled=true). */
  disabledReason?: string;
  lockPath: string;
}

export function createChannelBotTabSpec(opts: ChannelBotTabOpts): TabSpec {
  const platform = opts.platform;
  const id = opts.id ?? `${platform}:1`;
  const tokenEnvName = opts.tokenEnvName ?? TOKEN_ENV[platform];
  const tokenValue = process.env[tokenEnvName];
  const disabled = !tokenValue || tokenValue.trim().length === 0;
  const command = opts.command ?? [defaultMonadCommand(), platform, '--gateway-mode'];
  const lockPath = opts.lockPath ?? defaultLockPathFor(platform);

  const meta: ChannelBotMeta = {
    platform,
    tokenEnvName,
    disabled,
    ...(disabled ? { disabledReason: `${tokenEnvName} not set` } : {}),
    lockPath,
  };

  // When token is missing we still register the spec so the sidebar
  // shows the user a clear "set MONAD_TELEGRAM_BOT_TOKEN" hint instead
  // of silently dropping the tab. Spawn fields stay populated so a
  // later config flip + restart can re-enable the kind without re-register.
  return {
    id,
    kind: CHANNEL_BOT_KIND,
    label: opts.label ?? id,
    spawn: {
      command,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      env: {
        ...(opts.env ?? {}),
        // Forward the token explicitly so child sees a clean inject
        // even if `process.env` filtering is enabled by the spawn
        // backend.
        ...(tokenValue ? { [tokenEnvName]: tokenValue } : {}),
      },
    },
    health: {
      kind: 'ipc-ping',
      intervalMs: 30_000,
      timeoutMs: 2_000,
      staleAfterMs: 90_000,
    },
    restart: {
      policy: 'on-crash',
      backoffMs: [10_000, 30_000, 60_000],
      maxPerHour: 10,
      graceMs: 3_000,
      haltPatterns: [...CHANNEL_BOT_HALT_PATTERNS],
    },
    meta: meta as unknown as Record<string, unknown>,
  };
}

// PLAN-nexus-shell-followup U3 (2026-05-16) — createChannelBotTabView +
// CreateChannelBotTabViewOpts + summarizeChannelBot + haltHintChannelBot
// + staticChannelBotView 모두 외부 caller 없음 (TUI sidebar 의 dead path).
// buildSetupCardLines 는 보존 — PWA `ChannelBotSetupCard` 가 mirror.

// ---------------------------------------------------------------------------
// T2.A — setup card lines (token-missing guidance · TUI + PWA mirror)
// ---------------------------------------------------------------------------
//
// 3 setup paths + how-to-get-a-token hint. Surface가 token 미설정인 채로
// silent 비활성된 채널-봇 탭을 사용자가 발견할 때 "왜 안 떠?" 의문을
// inline 안내로 해소. PWA `ChannelBotSetupCard` 가 같은 정보를 카드로
// mirror — TUI 와 PWA 양쪽 SSoT 는 본 build*Lines 함수.

const TOKEN_HINT_URL: Record<ChannelBotPlatform, string> = {
  telegram: 'https://t.me/BotFather  (/newbot · /token)',
  discord: 'https://discord.com/developers/applications',
};

export interface ChannelBotSetupHint {
  platform: ChannelBotPlatform;
  tokenEnvName: string;
  /** PWA Settings 의 Secret modal · 또는 Quick Setup 의 token 칸. */
  pwaPath: string;
  /** Desktop wizard 진입 명령. */
  wizardCmd: string;
  /** Env-var direct path. */
  envSnippet: string;
  /** Where to obtain a fresh token. */
  tokenSource: string;
  /** Wizard-only fields (allowlist · home channel · voice 등). */
  wizardOnlyNote: string;
}

export function buildChannelBotSetupHint(
  platform: ChannelBotPlatform,
  meta?: Partial<ChannelBotMeta>,
): ChannelBotSetupHint {
  const tokenEnvName = meta?.tokenEnvName ?? TOKEN_ENV[platform];
  return {
    platform,
    tokenEnvName,
    pwaPath: `PWA Settings → Secret modal → ${tokenEnvName}`,
    wizardCmd: `monad setup ${platform}`,
    envSnippet: `export ${tokenEnvName}=…`,
    tokenSource: TOKEN_HINT_URL[platform],
    wizardOnlyNote:
      platform === 'telegram'
        ? 'Allowlist · home channel 등은 wizard 에서.'
        : 'Guild · voice channel 등은 wizard 에서.',
  };
}

// PLAN-nexus-shell-followup U3 (2026-05-16) — buildSetupCardLines 제거.
// staticChannelBotView 의 fallback render 에서만 사용됐는데 그 함수도
// 같이 trim 됨. PWA `ChannelBotSetupCard` 는 buildChannelBotSetupHint
// 직접 사용 (위 export 보존).

// ---------------------------------------------------------------------------
// External-process detection — thin wrapper around the generic helper
// ---------------------------------------------------------------------------

export interface DetectExternalChannelBotOpts {
  state: NexusState;
  registry: TabRegistry;
  tabId: string;
  /** Tests inject. Default reads the spec's meta.lockPath. */
  readLockOverride?: Parameters<typeof detectExternalLock>[0]['readLock'];
  isAliveOverride?: Parameters<typeof detectExternalLock>[0]['isAlive'];
}

export function detectExternalChannelBot(opts: DetectExternalChannelBotOpts): DetectExternalLockResult {
  const tab = opts.registry.get(opts.tabId);
  if (!tab) return { outcome: 'no-tab' };
  const meta = (tab.spec.meta ?? {}) as Partial<ChannelBotMeta>;
  const lockPath = meta.lockPath;
  if (!lockPath) return { outcome: 'available' };
  return detectExternalLock({
    state: opts.state,
    registry: opts.registry,
    tabId: opts.tabId,
    lockPath,
    ...(opts.readLockOverride ? { readLock: opts.readLockOverride } : {}),
    ...(opts.isAliveOverride ? { isAlive: opts.isAliveOverride } : {}),
    reasonLabel: `external-${meta.platform ?? 'channel-bot'}`,
  });
}
