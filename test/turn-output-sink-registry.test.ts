import { describe, expect, it } from 'bun:test';
import {
  canTurnOutputSinkConsume,
  getTurnOutputSinkDescriptor,
  selectTurnOutputBlockForSink,
  selectTurnOutputTextForSink,
} from '../src/input/turn-output-sink-registry';
import { buildTurnOutputTextBlocks } from '../src/input/turn-output-block';

describe('turn output sink registry alpha', () => {
  it('declares audio-tts as a speakable-text consumer', () => {
    expect(getTurnOutputSinkDescriptor('audio-tts')).toEqual({
      kind: 'audio-tts',
      consumes: ['speakable-text'],
    });
    expect(canTurnOutputSinkConsume('audio-tts', 'speakable-text')).toBe(true);
    expect(canTurnOutputSinkConsume('audio-tts', 'text')).toBe(false);
  });

  it('declares code sink as a code-text consumer', () => {
    expect(getTurnOutputSinkDescriptor('code')).toEqual({
      kind: 'code',
      consumes: ['code-text', 'text'],
    });
    expect(canTurnOutputSinkConsume('code', 'code-text')).toBe(true);
  });

  it('declares picture/video sinks as media-ref consumers', () => {
    expect(getTurnOutputSinkDescriptor('picture').consumes).toEqual([
      'picture-ref',
      'link-text',
      'text',
    ]);
    expect(getTurnOutputSinkDescriptor('video').consumes).toEqual([
      'video-ref',
      'link-text',
      'text',
    ]);
  });

  it('declares fan-out sinks as text plus speakable-text consumers', () => {
    expect(getTurnOutputSinkDescriptor('fan-out-discord').consumes).toEqual([
      'text',
      'speakable-text',
    ]);
    expect(canTurnOutputSinkConsume('fan-out-pwa', 'text')).toBe(true);
    expect(canTurnOutputSinkConsume('fan-out-telegram', 'speakable-text')).toBe(true);
  });

  it('declares browser-open and editor-open as typed path/link consumers', () => {
    expect(getTurnOutputSinkDescriptor('browser-open').consumes).toEqual([
      'link-text',
      'path-text',
      'text',
    ]);
    expect(getTurnOutputSinkDescriptor('editor-open').consumes).toEqual([
      'path-text',
      'text',
    ]);
    expect(canTurnOutputSinkConsume('browser-open', 'path-text')).toBe(true);
    expect(canTurnOutputSinkConsume('browser-open', 'link-text')).toBe(true);
  });

  it('selects sink text according to consume order', () => {
    const blocks = buildTurnOutputTextBlocks('경로는 /tmp/demotxt 입니다.');
    expect(selectTurnOutputTextForSink('audio-tts', blocks)).toBe('경로는 path 입니다.');
    expect(selectTurnOutputTextForSink('fan-out-discord', blocks)).toBe('경로는 /tmp/demotxt 입니다.');
  });

  it('prefers path-text for browser-open and editor-open sinks', () => {
    const blocks = buildTurnOutputTextBlocks('/Users/me/project/src/index.ts');
    expect(selectTurnOutputTextForSink('browser-open', blocks)).toBe('/Users/me/project/src/index.ts');
    expect(selectTurnOutputTextForSink('editor-open', blocks)).toBe('/Users/me/project/src/index.ts');
  });

  it('prefers link-text for browser-open sinks', () => {
    const blocks = buildTurnOutputTextBlocks('https://example.com/docs?id=42');
    expect(selectTurnOutputTextForSink('browser-open', blocks)).toBe('https://example.com/docs?id=42');
  });

  it('prefers code-text for code sink', () => {
    const blocks = buildTurnOutputTextBlocks('```ts\nconst x = 1;\n```');
    expect(selectTurnOutputTextForSink('code', blocks)).toBe('const x = 1;');
  });

  it('selects typed media blocks for picture/video sinks', () => {
    const pictureBlocks = buildTurnOutputTextBlocks('![architecture](https://example.com/arch.png)');
    const videoBlocks = buildTurnOutputTextBlocks('https://example.com/demo.mp4');
    expect(selectTurnOutputBlockForSink('picture', pictureBlocks)).toMatchObject({
      kind: 'picture-ref',
      url: 'https://example.com/arch.png',
    });
    expect(selectTurnOutputBlockForSink('video', videoBlocks)).toMatchObject({
      kind: 'video-ref',
      url: 'https://example.com/demo.mp4',
    });
  });
});
