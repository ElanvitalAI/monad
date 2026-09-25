import { describe, expect, it } from 'bun:test';
import {
  buildSpeakableOutputText,
  buildTurnOutputTextVariants,
} from '../src/input/turn-output-text';

describe('buildSpeakableOutputText', () => {
  it('drops markdown links, urls, code fences, and unix paths', () => {
    const input = [
      '요약입니다.',
      '```ts',
      "console.log('debug')",
      '```',
      '참고: [docs](https://example.com/docs)',
      '경로는 /Users/me/source/axon/monad-agent/src/index.ts 입니다.',
    ].join('\n');
    expect(buildSpeakableOutputText(input)).toBe('요약입니다. 참고: docs 경로는 path 입니다.');
  });

  it('caps overly long speech text', () => {
    const input = 'a'.repeat(600);
    const output = buildSpeakableOutputText(input);
    expect(output.length).toBeLessThanOrEqual(480);
    expect(output.endsWith('...')).toBe(true);
  });

  it('speaks headings and bullet lists as plain sentences', () => {
    const input = [
      '# Summary',
      '- first item',
      '- second item with **bold** text',
      '1. numbered item',
      '| col | val |',
      '| --- | --- |',
      '| a | b |',
    ].join('\n');
    expect(buildSpeakableOutputText(input)).toBe('Summary. first item. second item with bold text. numbered item. col val. a b');
  });

  it('normalizes checkbox lists, shell prompts, and env-style tokens', () => {
    const input = [
      '- [x] OPENAI_API_KEY 확인',
      '- [ ] 다음 단계 진행',
      '$ bun test ./src/example.ts',
      'user@host:~/repo$ echo done',
    ].join('\n');
    expect(buildSpeakableOutputText(input)).toBe('setting 확인. 다음 단계 진행. bun test path. echo done');
  });

  it('softens cli long options and env assignments for speech', () => {
    const input = [
      '$ OPENAI_API_KEY=secret bun run --dry-run --max-tokens 5',
    ].join('\n');
    expect(buildSpeakableOutputText(input)).toBe('setting secret bun run option dry run option max tokens 5');
  });

  it('softens json-like and image markdown structures for speech', () => {
    const input = [
      '![diagram](https://example.com/diagram.png)',
      '{"status":"done","next_step":"review"}',
      'Priority: high',
    ].join('\n');
    expect(buildSpeakableOutputText(input)).toBe('diagram. status : done next_step : review. Priority: high');
  });

  it('keeps pure urls and empty-alt images audible', () => {
    const input = [
      'https://example.com/docs?id=42',
      '![](https://example.com/preview.png)',
    ].join('\n');
    expect(buildSpeakableOutputText(input)).toBe('link image');
  });

  it('keeps code-only replies speakable as a placeholder', () => {
    const input = [
      '```ts',
      'const x = 1;',
      'console.log(x);',
      '```',
    ].join('\n');
    expect(buildSpeakableOutputText(input)).toBe('code block');
  });
});

describe('buildTurnOutputTextVariants', () => {
  it('preserves raw text alongside speakable text', () => {
    const text = '읽어줄 때는 `const x = 1` 과 https://example.com/test 그리고 /tmp/demo.txt 는 줄여주세요.';
    expect(buildTurnOutputTextVariants(text)).toEqual({
      text,
      speakableText: '읽어줄 때는 const x = 1 과 link 그리고 path 는 줄여주세요.',
    });
  });
});
