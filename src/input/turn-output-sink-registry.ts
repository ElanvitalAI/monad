import type { TurnOutputBlock } from './turn-output-block.js';

export type TurnOutputSinkKind =
  | 'text'
  | 'code'
  | 'picture'
  | 'video'
  | 'audio-tts'
  | 'hud-phase'
  | 'log'
  | 'fan-out-discord'
  | 'fan-out-telegram'
  | 'fan-out-pwa'
  | 'browser-open'
  | 'editor-open'
  | 'clipboard'
  | 'file-write';

export interface TurnOutputSinkDescriptor {
  kind: TurnOutputSinkKind;
  consumes: readonly TurnOutputBlock['kind'][];
}

const TURN_OUTPUT_SINK_REGISTRY: Record<TurnOutputSinkKind, TurnOutputSinkDescriptor> = {
  text: { kind: 'text', consumes: ['text'] },
  code: { kind: 'code', consumes: ['code-text', 'text'] },
  picture: { kind: 'picture', consumes: ['picture-ref', 'link-text', 'text'] },
  video: { kind: 'video', consumes: ['video-ref', 'link-text', 'text'] },
  'audio-tts': { kind: 'audio-tts', consumes: ['speakable-text'] },
  'hud-phase': { kind: 'hud-phase', consumes: ['text'] },
  log: { kind: 'log', consumes: ['text'] },
  'fan-out-discord': { kind: 'fan-out-discord', consumes: ['text', 'speakable-text'] },
  'fan-out-telegram': { kind: 'fan-out-telegram', consumes: ['text', 'speakable-text'] },
  'fan-out-pwa': { kind: 'fan-out-pwa', consumes: ['text', 'speakable-text'] },
  'browser-open': { kind: 'browser-open', consumes: ['link-text', 'path-text', 'text'] },
  'editor-open': { kind: 'editor-open', consumes: ['path-text', 'text'] },
  clipboard: { kind: 'clipboard', consumes: ['text'] },
  'file-write': { kind: 'file-write', consumes: ['text'] },
};

export function getTurnOutputSinkDescriptor(kind: TurnOutputSinkKind): TurnOutputSinkDescriptor {
  return TURN_OUTPUT_SINK_REGISTRY[kind];
}

export function canTurnOutputSinkConsume(
  kind: TurnOutputSinkKind,
  blockKind: TurnOutputBlock['kind'],
): boolean {
  return getTurnOutputSinkDescriptor(kind).consumes.includes(blockKind);
}

export function selectTurnOutputBlockForSink(
  kind: TurnOutputSinkKind,
  blocks: readonly TurnOutputBlock[],
): TurnOutputBlock | null {
  const descriptor = getTurnOutputSinkDescriptor(kind);
  for (const blockKind of descriptor.consumes) {
    const block = blocks.find((candidate) => candidate.kind === blockKind);
    if (block) return block;
  }
  return null;
}

export function selectTurnOutputTextForSink(
  kind: TurnOutputSinkKind,
  blocks: readonly TurnOutputBlock[],
): string | null {
  return selectTurnOutputBlockForSink(kind, blocks)?.text ?? null;
}
