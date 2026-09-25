import type { InputSourceRef } from '../../input/input-source-kind.js';
import type { SurfaceKind } from './types.js';

export type SurfaceKindResolutionReason = 'resolved' | 'absent' | 'unmapped';

export interface SurfaceKindResolution {
  surface: SurfaceKind;
  reason: SurfaceKindResolutionReason;
}

export function resolveSurfaceKindFromInputSource(
  source: InputSourceRef | null | undefined,
): SurfaceKindResolution {
  if (source == null) return { surface: 'unknown', reason: 'absent' };

  switch (source.kind) {
    case 'native':
      if (source.platform === 'android') return { surface: 'android', reason: 'resolved' };
      if (source.platform === 'ios') return { surface: 'ios', reason: 'resolved' };
      return { surface: 'unknown', reason: 'unmapped' };
    case 'pwa':
    case 'telegram':
    case 'discord':
      return { surface: source.kind, reason: 'resolved' };
    case 'terminal':
      return { surface: 'tui', reason: 'resolved' };
    case 'daemon-api':
      return { surface: 'acp', reason: 'resolved' };
    default:
      return { surface: 'unknown', reason: 'unmapped' };
  }
}
