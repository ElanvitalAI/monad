import type { InputSourceRef } from './input-source-kind.js';

export type InputSurfaceFamily =
  | 'direct'
  | 'communication'
  | 'embodied'
  | 'automation'
  | 'wearable';

export function classifyInputSurfaceFamily(source: InputSourceRef): InputSurfaceFamily {
  switch (source.kind) {
    case 'telegram':
    case 'discord':
      return 'communication';
    case 'browser':
    case 'terminal':
      return 'embodied';
    case 'scheduled':
    case 'llm-tool':
    case 'daemon-api':
      return 'automation';
    case 'glass':
      return 'wearable';
    case 'keyboard':
    case 'mouse':
    case 'voice':
    case 'pwa':
    case 'native':
      return 'direct';
  }
}

export function formatInputSourceLine(source: InputSourceRef): string {
  const detailParts: string[] = [];
  if ('entry' in source && typeof source.entry === 'string' && source.entry.length > 0) {
    detailParts.push(`entry=${source.entry}`);
  }
  if ('channel' in source && typeof source.channel === 'string' && source.channel.length > 0) {
    detailParts.push(`channel=${source.channel}`);
  }
  if ('mode' in source && typeof source.mode === 'string' && source.mode.length > 0) {
    detailParts.push(`mode=${source.mode}`);
  }
  if ('provider' in source && typeof source.provider === 'string' && source.provider.length > 0) {
    detailParts.push(`provider=${source.provider}`);
  }
  if ('relay' in source && typeof source.relay === 'string' && source.relay.length > 0) {
    detailParts.push(`relay=${source.relay}`);
  }
  if (
    'capabilities' in source
    && Array.isArray(source.capabilities)
    && source.capabilities.length > 0
  ) {
    detailParts.push(`capabilities=${source.capabilities.join('+')}`);
  }
  const details = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : '';
  return `Input source kind: ${source.kind}${details}`;
}
