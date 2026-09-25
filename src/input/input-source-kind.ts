export type InputSourceKind =
  | 'keyboard'
  | 'mouse'
  | 'voice'
  | 'browser'
  | 'terminal'
  | 'telegram'
  | 'discord'
  | 'pwa'
  | 'daemon-api'
  | 'native'
  | 'scheduled'
  | 'llm-tool'
  | 'glass';

export const INPUT_SOURCE_KINDS: readonly InputSourceKind[] = [
  'keyboard',
  'mouse',
  'voice',
  'browser',
  'terminal',
  'telegram',
  'discord',
  'pwa',
  'daemon-api',
  'native',
  'scheduled',
  'llm-tool',
  'glass',
] as const;

export type CommunicationInputSourceProvider =
  | 'telegram'
  | 'discord'
  | 'whatsapp'
  | 'teams'
  | 'imessage'
  | 'sms';

export type CommunicationInputSourceEntry =
  | 'text'
  | 'voice-message'
  | 'voice-call'
  | 'ambient'
  | 'slash'
  | 'mention'
  | 'thread-reply'
  | 'command';

export type CommunicationInputSourceRelay =
  | 'native-bot'
  | 'daemon-bridge'
  | 'phone-app-bridge';

export function isInputSourceKind(value: unknown): value is InputSourceKind {
  return typeof value === 'string'
    && (INPUT_SOURCE_KINDS as readonly string[]).includes(value);
}

export type InputSourceRef =
  | {
      kind: 'keyboard';
      surface?: string;
    }
  | {
      kind: 'mouse';
      surface?: string;
    }
  | {
      kind: 'voice';
      surface?: string;
      mode?: 'multi-turn' | 'dictation' | 'voice-message' | 'voice-channel';
      transcriptSource?: 'voice' | 'audio';
      channel?: 'dashboard' | 'telegram' | 'discord' | 'pwa';
    }
  | {
      kind: 'browser';
      provider?: 'cdp' | 'playwright';
      deviceId?: string;
      sessionId?: string;
      capabilities?: Array<'observe' | 'act' | 'verify' | 'render'>;
    }
  | {
      kind: 'terminal';
      provider?: 'pty' | 'tui';
      deviceId?: string;
      sessionId?: string;
      capabilities?: Array<'observe' | 'act' | 'verify' | 'render'>;
    }
  | {
      kind: 'telegram';
      family?: 'communication';
      provider?: 'telegram';
      chatId?: string;
      threadId?: string;
      userId?: string;
      entry?: CommunicationInputSourceEntry;
      relay?: CommunicationInputSourceRelay;
    }
  | {
      kind: 'discord';
      family?: 'communication';
      provider?: 'discord';
      channelId?: string;
      guildId?: string;
      userId?: string;
      entry?: CommunicationInputSourceEntry | 'voice-channel';
      relay?: CommunicationInputSourceRelay;
    }
  | {
      kind: 'pwa';
      sessionId?: string;
      deviceId?: string;
      entry?: 'text' | 'voice' | 'scratch';
    }
  | {
      kind: 'daemon-api';
      clientId?: string;
      route?: string;
    }
  | {
      kind: 'native';
      platform?: 'ios' | 'android';
      deviceId?: string;
      sessionId?: string;
    }
  | {
      kind: 'scheduled';
      jobId?: string;
    }
  | {
      kind: 'llm-tool';
      toolName?: string;
    }
  | {
      kind: 'glass';
      deviceId?: string;
      entry?: string;
    };

export type IntakeLikeSource =
  | 'tui-scratch'
  | 'web-scratch'
  | 'mobile-scratch'
  | 'voice'
  | 'telegram'
  | 'discord'
  | 'api';

export function canonicalInputSourceKindFromIntakeSource(
  source: IntakeLikeSource,
): InputSourceKind {
  switch (source) {
    case 'tui-scratch':
      return 'keyboard';
    case 'web-scratch':
    case 'mobile-scratch':
      return 'pwa';
    case 'voice':
      return 'voice';
    case 'telegram':
      return 'telegram';
    case 'discord':
      return 'discord';
    case 'api':
      return 'daemon-api';
  }
}

export function buildTelegramTextInputSourceRef(args: {
  chatId?: string;
  threadId?: string;
  userId?: string;
  relay?: CommunicationInputSourceRelay;
} = {}): Extract<InputSourceRef, { kind: 'telegram' }> {
  return buildCommunicationTextInputSourceRef({
    kind: 'telegram',
    provider: 'telegram',
    relay: args.relay,
    ...(args.chatId ? { chatId: args.chatId } : {}),
    ...(args.threadId ? { threadId: args.threadId } : {}),
    ...(args.userId ? { userId: args.userId } : {}),
  });
}

export function buildDiscordTextInputSourceRef(args: {
  channelId?: string;
  guildId?: string;
  userId?: string;
  relay?: CommunicationInputSourceRelay;
} = {}): Extract<InputSourceRef, { kind: 'discord' }> {
  return buildCommunicationTextInputSourceRef({
    kind: 'discord',
    provider: 'discord',
    relay: args.relay,
    ...(args.channelId ? { channelId: args.channelId } : {}),
    ...(args.guildId ? { guildId: args.guildId } : {}),
    ...(args.userId ? { userId: args.userId } : {}),
  });
}

function buildCommunicationTextInputSourceRef<T extends Extract<InputSourceRef, { kind: 'telegram' | 'discord' }>>(
  args: T & {
    provider: CommunicationInputSourceProvider;
    relay?: CommunicationInputSourceRelay;
  },
): T {
  return {
    ...args,
    family: 'communication',
    entry: 'text',
    relay: args.relay ?? 'native-bot',
  };
}

export function buildPwaScratchInputSourceRef(args: {
  deviceId?: string;
  sessionId?: string;
} = {}): Extract<InputSourceRef, { kind: 'pwa' }> {
  return {
    kind: 'pwa',
    ...(args.deviceId ? { deviceId: args.deviceId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    entry: 'scratch',
  };
}

export function buildDaemonApiInputSourceRef(args: {
  clientId?: string;
  route?: string;
} = {}): Extract<InputSourceRef, { kind: 'daemon-api' }> {
  return {
    kind: 'daemon-api',
    ...(args.clientId ? { clientId: args.clientId } : {}),
    ...(args.route ? { route: args.route } : {}),
  };
}

export function buildBrowserObservationInputSourceRef(args: {
  provider?: 'cdp' | 'playwright';
  deviceId?: string;
  sessionId?: string;
  capabilities?: Array<'observe' | 'act' | 'verify' | 'render'>;
} = {}): Extract<InputSourceRef, { kind: 'browser' }> {
  return {
    kind: 'browser',
    ...(args.provider ? { provider: args.provider } : {}),
    ...(args.deviceId ? { deviceId: args.deviceId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(args.capabilities?.length ? { capabilities: args.capabilities } : {}),
  };
}

export function buildTerminalObservationInputSourceRef(args: {
  provider?: 'pty' | 'tui';
  deviceId?: string;
  sessionId?: string;
  capabilities?: Array<'observe' | 'act' | 'verify' | 'render'>;
} = {}): Extract<InputSourceRef, { kind: 'terminal' }> {
  return {
    kind: 'terminal',
    ...(args.provider ? { provider: args.provider } : {}),
    ...(args.deviceId ? { deviceId: args.deviceId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(args.capabilities?.length ? { capabilities: args.capabilities } : {}),
  };
}
