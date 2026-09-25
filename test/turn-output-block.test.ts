import { describe, expect, it } from 'bun:test';
import {
  buildTurnOutputTextBlocks,
  selectCodeTextBlock,
  selectPictureRefBlock,
  selectPathTextBlock,
  selectPrimaryTextBlock,
  selectSpeakableTextBlock,
  selectVideoRefBlock,
} from '../src/input/turn-output-block';

describe('buildTurnOutputTextBlocks', () => {
  it('emits both raw text and speakable-text blocks', () => {
    expect(buildTurnOutputTextBlocks('경로는 /tmp/demotxt 입니다.')).toEqual([
      { kind: 'text', text: '경로는 /tmp/demotxt 입니다.' },
      { kind: 'speakable-text', text: '경로는 path 입니다.', source: 'rewrite' },
    ]);
  });

  it('marks speakable-text as direct when unchanged', () => {
    expect(buildTurnOutputTextBlocks('안녕하세요.')).toEqual([
      { kind: 'text', text: '안녕하세요.' },
      { kind: 'speakable-text', text: '안녕하세요.', source: 'direct' },
    ]);
  });

  it('selects primary and speakable text blocks', () => {
    const blocks = buildTurnOutputTextBlocks('경로는 /tmp/demotxt 입니다.');
    expect(selectPrimaryTextBlock(blocks)).toBe('경로는 /tmp/demotxt 입니다.');
    expect(selectSpeakableTextBlock(blocks)).toBe('경로는 path 입니다.');
  });

  it('emits path-text for pure path payloads', () => {
    const blocks = buildTurnOutputTextBlocks('/Users/me/project/src/index.ts');
    expect(blocks).toEqual([
      { kind: 'text', text: '/Users/me/project/src/index.ts' },
      { kind: 'path-text', text: '/Users/me/project/src/index.ts' },
      { kind: 'speakable-text', text: 'path', source: 'rewrite' },
    ]);
    expect(selectPathTextBlock(blocks)).toBe('/Users/me/project/src/index.ts');
  });

  it('emits link-text for pure URL payloads', () => {
    expect(buildTurnOutputTextBlocks('https://example.com/docs?id=42')).toEqual([
      { kind: 'text', text: 'https://example.com/docs?id=42' },
      { kind: 'link-text', text: 'https://example.com/docs?id=42' },
      { kind: 'speakable-text', text: 'link', source: 'rewrite' },
    ]);
  });

  it('emits picture-ref for markdown image payloads', () => {
    const blocks = buildTurnOutputTextBlocks('![architecture](https://example.com/arch.png)');
    expect(selectPictureRefBlock(blocks)).toEqual({
      kind: 'picture-ref',
      text: 'architecture',
      url: 'https://example.com/arch.png',
      source: 'markdown-image',
    });
  });

  it('emits picture-ref for markdown image data urls', () => {
    const blocks = buildTurnOutputTextBlocks('![sample](data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E)');
    expect(selectPictureRefBlock(blocks)).toEqual({
      kind: 'picture-ref',
      text: 'sample',
      url: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E',
      source: 'markdown-image',
    });
  });

  it('emits video-ref for pure video urls', () => {
    const blocks = buildTurnOutputTextBlocks('https://example.com/demo.mp4');
    expect(selectVideoRefBlock(blocks)).toEqual({
      kind: 'video-ref',
      text: 'https://example.com/demo.mp4',
      url: 'https://example.com/demo.mp4',
      source: 'url',
    });
  });

  it('emits code-text for fenced code payloads', () => {
    const blocks = buildTurnOutputTextBlocks('설명입니다.\n```ts\nconst x = 1;\nconsole.log(x);\n```\n끝.');
    expect(blocks).toEqual([
      { kind: 'text', text: '설명입니다.\n```ts\nconst x = 1;\nconsole.log(x);\n```\n끝.' },
      { kind: 'code-text', text: 'const x = 1;\nconsole.log(x);', source: 'fenced' },
      { kind: 'speakable-text', text: '설명입니다. 끝.', source: 'rewrite' },
    ]);
    expect(selectCodeTextBlock(blocks)).toBe('const x = 1;\nconsole.log(x);');
  });
});
