import { askValidated, validateDiscordToken, validateTelegramToken } from '../onboarding/validators.js';
import { defaultIO, type WizardIO } from '../onboarding.js';
import { setSecretAsync } from '../nexus/config/secrets/index.js';
import { patchUserConfig, writeSwitchValue } from '../nexus/config/user-config.js';
import { makeSecretRef } from '../nexus/config/types.js';
import {
  DISCORD_TOKEN_SWITCH_ID,
  TELEGRAM_TOKEN_SWITCH_ID,
} from '../nexus/config/builtins/tab-channel.js';

export type ChannelBotSetupPlatform = 'telegram' | 'discord';

export interface ChannelBotSetupDeps {
  platform: ChannelBotSetupPlatform;
  io?: WizardIO;
  setSecretFn?: (id: string, value: string) => Promise<void>;
  saveSwitchFn?: (switchId: string, value: string) => void;
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface ChannelBotSetupResult {
  exitCode: number;
  switchId?: string;
  secretId?: string;
}

function secretInfo(platform: ChannelBotSetupPlatform): {
  switchId: string;
  secretId: string;
  title: string;
  hint: string[];
  prompt: string;
  validate: ReturnType<typeof validateTelegramToken> | ReturnType<typeof validateDiscordToken>;
} {
  if (platform === 'telegram') {
    return {
      switchId: TELEGRAM_TOKEN_SWITCH_ID,
      secretId: 'telegram-bot-1',
      title: 'Telegram bot setup',
      hint: [
        'Get a token from BotFather (/newbot).',
        'Paste the token below. It will be stored in the NEXUS secret store.',
      ],
      prompt: '  Bot token (from @BotFather): ',
      validate: validateTelegramToken(),
    };
  }
  return {
    switchId: DISCORD_TOKEN_SWITCH_ID,
    secretId: 'discord-bot-1',
    title: 'Discord bot setup',
    hint: [
      'Get a bot token from the Discord developer portal.',
      'Paste the token below. It will be stored in the NEXUS secret store.',
    ],
    prompt: '  Bot token (from Discord developer portal): ',
    validate: validateDiscordToken(),
  };
}

export async function runChannelBotSetup(opts: ChannelBotSetupDeps): Promise<ChannelBotSetupResult> {
  const ownIo = opts.io === undefined;
  const io = opts.io ?? defaultIO();
  const out = opts.out ?? console;
  const meta = secretInfo(opts.platform);
  const setSecretFn = opts.setSecretFn ?? setSecretAsync;
  const saveSwitchFn = opts.saveSwitchFn ?? ((switchId: string, value: string) => {
    patchUserConfig((cfg) => writeSwitchValue(cfg, switchId, value));
  });

  try {
    io.print('');
    io.print(`  ${meta.title}`);
    for (const line of meta.hint) io.print(`  ${line}`);
    io.print('');
    const token = (await askValidated(io, meta.prompt, meta.validate, {
      secret: true,
      maxAttempts: 3,
    })).trim();
    const validationError = await Promise.resolve(meta.validate(token));
    if (validationError) {
      out.error(`channel-bot setup: ${validationError}`);
      return { exitCode: 1 };
    }
    await setSecretFn(meta.secretId, token);
    saveSwitchFn(meta.switchId, makeSecretRef(meta.secretId));
    out.log(`✓ ${opts.platform}: token saved (secret=${meta.secretId})`);
    out.log('  Tab will start on next `elanous nexus` boot.');
    return { exitCode: 0, switchId: meta.switchId, secretId: meta.secretId };
  } catch (err) {
    out.error(`channel-bot setup failed: ${(err as Error).message}`);
    return { exitCode: 1 };
  } finally {
    if (ownIo) io.close();
  }
}
