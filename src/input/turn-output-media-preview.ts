import type { TurnOutputBlock } from './turn-output-block.js';
import { selectTurnOutputBlockForSink } from './turn-output-sink-registry.js';

export type TurnOutputMediaPreview =
  | { kind: 'picture'; label: string; url: string }
  | { kind: 'video'; label: string; url: string };

export function buildTurnOutputMediaPreview(
  blocks: readonly TurnOutputBlock[],
): TurnOutputMediaPreview | null {
  const picture = selectTurnOutputBlockForSink('picture', blocks);
  if (picture?.kind === 'picture-ref') {
    return {
      kind: 'picture',
      label: picture.text,
      url: picture.url,
    };
  }
  const video = selectTurnOutputBlockForSink('video', blocks);
  if (video?.kind === 'video-ref') {
    return {
      kind: 'video',
      label: video.text,
      url: video.url,
    };
  }
  return null;
}
