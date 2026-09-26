// T2.A — channel-bot setup-needed card.
// Classification: moved — 25ef579f96ef87118fff6e002c6d383d7e0be935
// feat(nexus): delete kind-detail-view + trim 3 kind TabView funcs (U3 · PLAN-nexus-shell-followup) (#2853)
// removed the TUI static view. Keep buildChannelBotSetupHint as its SSoT; the PWA
// ChannelBotSetupCard test now owns rendered-card behavior while Bun executes this unit.

import { describe, expect, test } from 'bun:test';

import { buildChannelBotSetupHint } from '../src/nexus/kinds/channel-bot.js';

describe('T2.A · buildChannelBotSetupHint SSoT', () => {
  test('telegram hint includes BotFather URL + 3 setup paths', () => {
    const hint = buildChannelBotSetupHint('telegram');
    expect(hint.tokenEnvName).toBe('ELANOUS_TELEGRAM_BOT_TOKEN');
    expect(hint.pwaPath).toContain('PWA Settings');
    expect(hint.wizardCmd).toBe('elanous setup telegram');
    expect(hint.envSnippet).toContain('ELANOUS_TELEGRAM_BOT_TOKEN');
    expect(hint.tokenSource).toContain('BotFather');
    expect(hint.wizardOnlyNote).toContain('Allowlist');
  });

  test('discord hint points to developer portal + guild note', () => {
    const hint = buildChannelBotSetupHint('discord');
    expect(hint.tokenEnvName).toBe('ELANOUS_DISCORD_BOT_TOKEN');
    expect(hint.tokenSource).toContain('discord.com/developers');
    expect(hint.wizardOnlyNote).toContain('Guild');
  });
});
