// R-OCR.1.4 follow-up — createNotesPolishCallable contract.

import { describe, expect, test } from 'bun:test';

import {
  createNotesPolishCallable,
  isVisionPolishAvailable,
} from '../src/notes/polish-callable.js';
import type { LLMMessage } from '../src/llm.js';

const VISION_PROVIDER = {
  name: 'anthropic',
  defaultModel: 'claude-3-5-sonnet-latest',
  available: () => true,
};
const TEXT_ONLY_PROVIDER = {
  // local brand + a non-vision model id (qwen3-7b is text-only;
  // qwen3-vl-* would match the vision allowlist).
  name: 'local',
  defaultModel: 'qwen3-7b-instruct',
  available: () => true,
};
const UNAVAILABLE_PROVIDER = {
  name: 'anthropic',
  defaultModel: 'claude-3-5-sonnet-latest',
  available: () => false,
};

const sampleImage = { mediaType: 'image/png', base64: 'aGVsbG8=' };

describe('isVisionPolishAvailable', () => {
  test('vision-capable model + available provider → true', () => {
    expect(isVisionPolishAvailable({ resolveProvider: () => VISION_PROVIDER })).toBe(true);
  });

  test('text-only model → false', () => {
    expect(isVisionPolishAvailable({ resolveProvider: () => TEXT_ONLY_PROVIDER })).toBe(false);
  });

  test('unavailable provider → false', () => {
    expect(isVisionPolishAvailable({ resolveProvider: () => UNAVAILABLE_PROVIDER })).toBe(false);
  });

  test('resolveProvider throws → false (defensive)', () => {
    expect(isVisionPolishAvailable({
      resolveProvider: () => { throw new Error('no provider'); },
    })).toBe(false);
  });
});

describe('createNotesPolishCallable · happy path', () => {
  test('returns polished markdown from stub LLM', async () => {
    const polish = createNotesPolishCallable({
      resolveProvider: () => VISION_PROVIDER,
      llm: async () => '## 회고\n\nclean text',
    });
    const result = await polish({ rawMarkdown: 'raw text', image: sampleImage });
    expect(result).toBe('## 회고\n\nclean text');
  });

  test('forwards image + raw markdown + prompt in user message', async () => {
    let captured: LLMMessage[] | null = null;
    const polish = createNotesPolishCallable({
      resolveProvider: () => VISION_PROVIDER,
      llm: async (messages: LLMMessage[]) => {
        captured = messages;
        return 'polished';
      },
    });
    await polish({ rawMarkdown: 'raw_x', image: sampleImage });
    expect(captured).not.toBeNull();
    expect(captured!.length).toBe(1);
    const content = captured![0]!.content;
    if (typeof content === 'string') throw new Error('expected array');
    expect(content.length).toBe(2);
    const img = content[0]!;
    if (img.type !== 'image') throw new Error('expected image block');
    expect(img.mediaType).toBe('image/png');
    expect(img.base64).toBe('aGVsbG8=');
    const txt = content[1]!;
    if (txt.type !== 'text') throw new Error('expected text block');
    expect(txt.text).toContain('raw_x');
    expect(txt.text).toContain('OCR raw markdown');
  });

  test('language hint embedded in user text when provided', async () => {
    let captured = '';
    const polish = createNotesPolishCallable({
      resolveProvider: () => VISION_PROVIDER,
      llm: async (messages: LLMMessage[]) => {
        const c = messages[0]!.content;
        if (Array.isArray(c)) {
          const t = c.find((b) => b.type === 'text');
          if (t && t.type === 'text') captured = t.text;
        }
        return 'polished';
      },
    });
    await polish({ rawMarkdown: 'raw', image: sampleImage, language: 'ko' });
    expect(captured).toContain('언어 hint: ko');
  });

  test('custom prompt opt honored', async () => {
    let captured = '';
    const polish = createNotesPolishCallable({
      resolveProvider: () => VISION_PROVIDER,
      prompt: 'CUSTOM_POLISH_PROMPT',
      llm: async (messages: LLMMessage[]) => {
        const c = messages[0]!.content;
        if (Array.isArray(c)) {
          const t = c.find((b) => b.type === 'text');
          if (t && t.type === 'text') captured = t.text;
        }
        return 'ok';
      },
    });
    await polish({ rawMarkdown: 'raw', image: sampleImage });
    expect(captured).toContain('CUSTOM_POLISH_PROMPT');
  });
});

describe('createNotesPolishCallable · failure modes', () => {
  test('vision unavailable → throws', async () => {
    const polish = createNotesPolishCallable({
      resolveProvider: () => TEXT_ONLY_PROVIDER,
      llm: async () => 'should not run',
    });
    await expect(polish({ rawMarkdown: 'r', image: sampleImage }))
      .rejects.toThrow(/vision_polish_unavailable/);
  });

  test('empty image bytes → throws', async () => {
    const polish = createNotesPolishCallable({
      resolveProvider: () => VISION_PROVIDER,
      llm: async () => 'ok',
    });
    await expect(polish({
      rawMarkdown: 'r',
      image: { mediaType: 'image/png', base64: '' },
    })).rejects.toThrow(/polish_empty_image/);
  });

  test('LLM returns empty string → throws (caller degrades to raw)', async () => {
    const polish = createNotesPolishCallable({
      resolveProvider: () => VISION_PROVIDER,
      llm: async () => '   \n   ',
    });
    await expect(polish({ rawMarkdown: 'r', image: sampleImage }))
      .rejects.toThrow(/polish_empty_response/);
  });

  test('LLM throws → propagates (handler swallows)', async () => {
    const polish = createNotesPolishCallable({
      resolveProvider: () => VISION_PROVIDER,
      llm: async () => { throw new Error('rate limit'); },
    });
    await expect(polish({ rawMarkdown: 'r', image: sampleImage }))
      .rejects.toThrow(/rate limit/);
  });
});
