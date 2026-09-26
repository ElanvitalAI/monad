// NEXUS · channel-bot tab SwitchRegistry built-ins (Phase N-3 PR μ)
//
// Migrates the N-2 env-direct token sourcing to a SwitchRegistry
// secret-ref. Backwards-compat path:
//   - If `tabs.<id>.tokenRef` is set → use the referenced secret.
//   - Else fall back to `ELANOUS_TELEGRAM_BOT_TOKEN` / `ELANOUS_DISCORD_BOT_TOKEN`
//     env (legacy · auto-migration on boot writes a secret then sets the
//     ref so the env can be removed in a future release).

import type { SwitchSpec } from '../types.js';

export const TELEGRAM_TOKEN_SWITCH_ID = 'tabs.telegram:1.tokenRef';
export const DISCORD_TOKEN_SWITCH_ID = 'tabs.discord:1.tokenRef';

export const CHANNEL_SWITCHES: SwitchSpec[] = [
  {
    id: TELEGRAM_TOKEN_SWITCH_ID,
    scope: 'tab',
    appliesTo: ['channel-bot'],
    kind: 'secret-ref',
    label: 'Telegram bot token',
    description: 'BotFather 에서 발급한 token. PWA secret modal 에서 입력 권장.',
    default: '',
    hotApplicable: false,
    restartTabs: ['telegram:1'],
    pwaPreferred: true,
    redactInLogs: true,
    envName: 'ELANOUS_TELEGRAM_BOT_TOKEN',
    legacyEnvName: 'ELANOUS_TELEGRAM_BOT_TOKEN',
  },
  {
    id: DISCORD_TOKEN_SWITCH_ID,
    scope: 'tab',
    appliesTo: ['channel-bot'],
    kind: 'secret-ref',
    label: 'Discord bot token',
    description: 'Discord developer portal 에서 발급한 token.',
    default: '',
    hotApplicable: false,
    restartTabs: ['discord:1'],
    pwaPreferred: true,
    redactInLogs: true,
    envName: 'ELANOUS_DISCORD_BOT_TOKEN',
    legacyEnvName: 'ELANOUS_DISCORD_BOT_TOKEN',
  },
];
