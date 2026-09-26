// T2.A — ChannelBotSetupCard contract test.
//
// React Testing isn't wired in the PWA bun test environment (per the
// existing convention). Behaviour parity with the TUI side is exercised
// by test/nexus-channel-bot-setup-card.test.ts (TUI text) and the
// deriveSetupHint export keeps the copy in lockstep.

import { describe, expect, test } from 'bun:test';

import { ChannelBotSetupCard, deriveSetupHint } from './ChannelBotSetupCard';

describe('ChannelBotSetupCard — T2.A', () => {
  test('exports a ChannelBotSetupCard component', () => {
    expect(typeof ChannelBotSetupCard).toBe('function');
  });

  test('telegram hint references BotFather + token env + wizard cmd', () => {
    const h = deriveSetupHint('telegram');
    expect(h.tokenEnvName).toBe('ELANOUS_TELEGRAM_BOT_TOKEN');
    expect(h.wizardCmd).toBe('elanous setup telegram');
    expect(h.tokenSource).toContain('BotFather');
    expect(h.wizardOnlyNote).toContain('Allowlist');
  });

  test('discord hint references developer portal + guild note', () => {
    const h = deriveSetupHint('discord');
    expect(h.tokenEnvName).toBe('ELANOUS_DISCORD_BOT_TOKEN');
    expect(h.wizardCmd).toBe('elanous setup discord');
    expect(h.tokenSource).toContain('discord.com');
    expect(h.wizardOnlyNote).toContain('Guild');
  });
});
