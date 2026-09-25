import { describe, expect, it } from 'bun:test';

import { buildTurnOutputTextBlocks } from '../src/input/turn-output-block';
import { buildTurnOutputMediaPreview } from '../src/input/turn-output-media-preview';

describe('turn output media preview alpha', () => {
  it('builds a picture preview from markdown image output', () => {
    const blocks = buildTurnOutputTextBlocks('![architecture](https://example.com/arch.png)');
    expect(buildTurnOutputMediaPreview(blocks)).toEqual({
      kind: 'picture',
      label: 'architecture',
      url: 'https://example.com/arch.png',
    });
  });

  it('builds a video preview from pure video url output', () => {
    const blocks = buildTurnOutputTextBlocks('https://example.com/demo.mp4');
    expect(buildTurnOutputMediaPreview(blocks)).toEqual({
      kind: 'video',
      label: 'https://example.com/demo.mp4',
      url: 'https://example.com/demo.mp4',
    });
  });

  it('returns null when no media block exists', () => {
    const blocks = buildTurnOutputTextBlocks('plain answer');
    expect(buildTurnOutputMediaPreview(blocks)).toBeNull();
  });
});
