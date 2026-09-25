// PR-S1V.7 (sprint 22 Phase 2) — sentence-segmenter unit tests.
//
// The segmenter is the trickiest piece of auto-TTS — multilingual
// punctuation, code-fence handling, and chunk-split robustness all
// converge here. Test the boundary cases that are easy to regress.

import { describe, expect, it } from 'bun:test';
import { createSentenceSegmenter } from '../src/dashboard/auto-tts/sentence-segmenter.js';

describe('SentenceSegmenter — basics', () => {
  it('emits a sentence on a period followed by space', () => {
    const seg = createSentenceSegmenter();
    expect(seg.feed('Hello world. Next line')).toEqual(['Hello world.']);
    expect(seg.flushRemainder()).toEqual(['Next line']);
  });

  it('treats `?` and `!` as boundaries too', () => {
    const seg = createSentenceSegmenter();
    expect(seg.feed('Are you sure? Yes! Maybe.')).toEqual([
      'Are you sure?',
      'Yes!',
      'Maybe.',
    ]);
  });

  it('handles Korean / CJK fullwidth punctuation', () => {
    const seg = createSentenceSegmenter();
    expect(seg.feed('안녕하세요。 반갑습니다？ 정말！')).toEqual([
      '안녕하세요。',
      '반갑습니다？',
      '정말！',
    ]);
  });

  it('does NOT split a decimal point or version dot', () => {
    const seg = createSentenceSegmenter();
    // No boundary because next char is a digit/letter.
    expect(seg.feed('Version 1.2.3 is out.')).toEqual(['Version 1.2.3 is out.']);
  });

  it('splits on newlines even without sentence punctuation', () => {
    const seg = createSentenceSegmenter();
    expect(seg.feed('- one\n- two\n- three')).toEqual(['- one', '- two']);
    expect(seg.flushRemainder()).toEqual(['- three']);
  });

  it('preserves order across multiple feed() calls', () => {
    const seg = createSentenceSegmenter();
    expect(seg.feed('The first ')).toEqual([]);
    expect(seg.feed('sentence. ')).toEqual(['The first sentence.']);
    expect(seg.feed('And the ')).toEqual([]);
    // The trailing period is followed by end-of-string — segmenter
    // treats EOS as a boundary and emits at feed time. flushRemainder
    // is a no-op afterwards.
    expect(seg.feed('second.')).toEqual(['And the second.']);
    expect(seg.flushRemainder()).toEqual([]);
  });

  it('flushRemainder resets buffer', () => {
    const seg = createSentenceSegmenter();
    seg.feed('partial');
    expect(seg.flushRemainder()).toEqual(['partial']);
    expect(seg.flushRemainder()).toEqual([]);
  });

  it('reset() drops buffer without emitting', () => {
    const seg = createSentenceSegmenter();
    seg.feed('partial');
    seg.reset();
    expect(seg.flushRemainder()).toEqual([]);
  });
});

describe('SentenceSegmenter — code fences', () => {
  it('drops text inside ``` fences', () => {
    const seg = createSentenceSegmenter();
    const out: string[] = [];
    out.push(...seg.feed('Try this: '));
    out.push(...seg.feed('```\nconst x = 1;\nconst y = 2;\n```'));
    out.push(...seg.feed(' OK done.'));
    out.push(...seg.flushRemainder());
    const joined = out.join(' ');
    // The "Try this:" + " OK done." should remain; the code body drops.
    expect(joined).toContain('Try this');
    expect(joined).toContain('OK done');
    expect(joined).not.toContain('const x');
  });

  it('toggle survives chunk split mid-fence', () => {
    const seg = createSentenceSegmenter();
    const out: string[] = [];
    out.push(...seg.feed('Before '));
    out.push(...seg.feed('``'));         // 2/3 of opener
    out.push(...seg.feed('`code'));      // 3rd backtick → fence opens; 'code' is body
    out.push(...seg.feed('inside'));     // still in fence
    out.push(...seg.feed('``'));         // 2/3 of closer
    out.push(...seg.feed('` After.'));   // 3rd backtick → closes; ' After.' is body-after
    out.push(...seg.flushRemainder());
    const joined = out.join(' ');
    expect(joined).toContain('Before');
    expect(joined).toContain('After');
    expect(joined).not.toContain('code');
    expect(joined).not.toContain('inside');
  });

  it('isInCodeFence reflects open fence state', () => {
    const seg = createSentenceSegmenter();
    seg.feed('hi ```');
    expect(seg.isInCodeFence()).toBe(true);
    seg.feed('code```');
    expect(seg.isInCodeFence()).toBe(false);
  });
});

describe('SentenceSegmenter — max length cap', () => {
  it('force-flushes a runaway buffer', () => {
    const seg = createSentenceSegmenter({ maxSentenceChars: 50 });
    // Generate 60 chars without any boundary punctuation.
    const long = 'aaaaaaaaaa'.repeat(6);
    const out = seg.feed(long);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(long);
  });

  it('does not force-flush below the cap', () => {
    const seg = createSentenceSegmenter({ maxSentenceChars: 50 });
    expect(seg.feed('a'.repeat(40))).toEqual([]);
    // Still buffered.
    expect(seg.flushRemainder()).toEqual(['a'.repeat(40)]);
  });
});
