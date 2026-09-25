// Regression test — Codex Responses API path must forward image
// blocks as `input_image`, not silently drop them.
//
// Before this fix, Telegram users who sent a photo while the active
// provider was `openai-codex` saw the bot say "I can't see the image"
// because messagesToResponsesInput only extracted type:'text' blocks.
// The wire payload to /responses never carried the base64 data.

import { describe, it, expect } from 'bun:test';
import { messagesToResponsesInput, type LLMMessage } from '../src/llm.js';

describe('messagesToResponsesInput — image passthrough', () => {
  it('preserves plain text input_text for user messages', () => {
    const out = messagesToResponsesInput([{ role: 'user', content: 'hello' }]);
    expect(out.input).toHaveLength(1);
    expect(out.input[0]!.role).toBe('user');
    expect(out.input[0]!.content).toEqual([{ type: 'input_text', text: 'hello' }]);
  });

  it('assistant messages use output_text, not input_text', () => {
    const out = messagesToResponsesInput([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello back' },
    ]);
    expect(out.input[0]!.content[0]!.type).toBe('input_text');
    expect(out.input[1]!.content[0]!.type).toBe('output_text');
  });

  it('system messages fold into the instructions string', () => {
    const out = messagesToResponsesInput([
      { role: 'system', content: 'You are a pirate.' },
      { role: 'user', content: 'hi' },
    ]);
    expect(out.instructions).toBe('You are a pirate.');
    // system message should NOT appear in input[]
    expect(out.input).toHaveLength(1);
    expect(out.input[0]!.role).toBe('user');
  });

  it('image block in a user ContentBlock[] becomes input_image', () => {
    const msgs: LLMMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'image', mediaType: 'image/png', base64: 'iVBORw0' },
      ],
    }];
    const out = messagesToResponsesInput(msgs);
    expect(out.input).toHaveLength(1);
    const content = out.input[0]!.content;
    // Both text AND image should be present — no silent drop.
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'input_text', text: 'describe this' });
    expect(content[1]!.type).toBe('input_image');
    const img = content[1] as { type: 'input_image'; image_url: string; detail: string };
    expect(img.image_url).toBe('data:image/png;base64,iVBORw0');
    expect(img.detail).toBe('auto');
  });

  it('image-only message (no caption) still ships the image_url', () => {
    const msgs: LLMMessage[] = [{
      role: 'user',
      content: [
        { type: 'image', mediaType: 'image/jpeg', base64: '/9j/4AAQ' },
      ],
    }];
    const out = messagesToResponsesInput(msgs);
    const content = out.input[0]!.content;
    // One content block: the image. (The empty-text fallback doesn't
    // kick in because the image is non-empty content.)
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('input_image');
  });

  it('multiple images concatenate — all preserved', () => {
    const msgs: LLMMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'compare A and B' },
        { type: 'image', mediaType: 'image/png', base64: 'AAAA' },
        { type: 'image', mediaType: 'image/png', base64: 'BBBB' },
      ],
    }];
    const out = messagesToResponsesInput(msgs);
    const content = out.input[0]!.content;
    expect(content).toHaveLength(3);
    expect(content.filter(c => c.type === 'input_image')).toHaveLength(2);
  });

  it('assistant image (unusual) downgrades to "[image]" placeholder text', () => {
    // Assistant role can't carry input_image — Responses API rejects
    // mixed input/output content types. Our code downgrades to keep
    // the wire payload valid instead of 400-ing.
    const msgs: LLMMessage[] = [{
      role: 'assistant',
      content: [
        { type: 'text', text: 'here you go' },
        { type: 'image', mediaType: 'image/png', base64: 'AAAA' },
      ],
    }];
    const out = messagesToResponsesInput(msgs);
    const content = out.input[0]!.content;
    // Image gone, but its presence recorded as text. Type stays output_text.
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('output_text');
    expect((content[0] as any).text).toContain('[image]');
    expect((content[0] as any).text).toContain('here you go');
  });

  it('empty content blocks still produce a valid single-block payload', () => {
    // Responses API rejects an empty content array — the helper must
    // insert a fallback empty text block.
    const msgs: LLMMessage[] = [{ role: 'user', content: [] }];
    const out = messagesToResponsesInput(msgs);
    expect(out.input[0]!.content).toHaveLength(1);
    expect(out.input[0]!.content[0]).toEqual({ type: 'input_text', text: '' });
  });

  // P-3 §6.9 (2026-05-07) — user-message image gating axis.
  describe('acceptUserMessageImages (P-3 §6.9 · 2026-05-07)', () => {
    it('default (true) — user image stays as input_image', () => {
      const msgs: LLMMessage[] = [{
        role: 'user',
        content: [{ type: 'image', mediaType: 'image/png', base64: 'AAA' }],
      }];
      const out = messagesToResponsesInput(msgs);
      expect(out.input[0]!.content[0]!.type).toBe('input_image');
    });

    it('acceptUserMessageImages=false — user image becomes text placeholder', () => {
      const msgs: LLMMessage[] = [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image', mediaType: 'image/jpeg', base64: '/9j/' },
        ],
      }];
      const out = messagesToResponsesInput(msgs, { acceptUserMessageImages: false });
      const content = out.input[0]!.content;
      // image collapsed into the textBuf — single input_text block holds both.
      expect(content).toHaveLength(1);
      expect(content[0]!.type).toBe('input_text');
      expect((content[0] as { text: string }).text).toContain('describe');
      expect((content[0] as { text: string }).text).toContain(
        '[image: image/jpeg (model not vision-capable)]',
      );
    });

    it('acceptUserMessageImages=false does NOT affect tool-result image route', () => {
      // tool_result with image stays controlled by acceptToolImages (P3),
      // not by the user-message gate.
      const msgs: LLMMessage[] = [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-1', name: 'screenshot', input: {} }],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: [
              { type: 'text', text: 'screenshot ok' },
              { type: 'image', mediaType: 'image/png', base64: 'IMG' },
            ],
          }],
        },
      ];
      const out = messagesToResponsesInput(msgs, {
        acceptToolImages: true,
        acceptUserMessageImages: false,
      });
      const fnOut = out.input.find((it) => 'type' in it && it.type === 'function_call_output');
      expect(fnOut).toBeDefined();
      // tool_result still emits the array form when acceptToolImages=true.
      const fnOutput = (fnOut as { output: unknown }).output;
      expect(Array.isArray(fnOutput)).toBe(true);
    });
  });

  it('empty messages list gets a sentinel user turn', () => {
    const out = messagesToResponsesInput([]);
    expect(out.input).toHaveLength(1);
    expect(out.input[0]!.role).toBe('user');
    expect(out.input[0]!.content[0]).toEqual({ type: 'input_text', text: '' });
  });
});

// Image-pipeline P3 (2026-05-05) — function_call_output ContentItem[]
// wire. WT-C-2 WebTerminalScreenshot returns `{mediaType, dataB64}`;
// when the LLM provider is gpt-5 family Codex Responses, the tool
// result must reach the model as actual image bytes (not a size note).
describe('messagesToResponsesInput — function_call_output image wire (P3)', () => {
  function imageBearingMessages(): LLMMessage[] {
    return [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'WebTerminalScreenshot', input: { terminalId: 'preview-1' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'c1',
            content: [
              { type: 'text', text: '{"cols":80,"rows":24,"width":640,"height":384}' },
              { type: 'image', mediaType: 'image/png', base64: 'iVBORw0KGgo' },
            ],
          },
        ],
      },
    ];
  }

  it('default (acceptToolImages=false) collapses image to text fallback', () => {
    const out = messagesToResponsesInput(imageBearingMessages());
    // Find the function_call_output item.
    const fco = out.input.find(
      (it) => 'type' in it && it.type === 'function_call_output',
    ) as { type: 'function_call_output'; call_id: string; output: unknown } | undefined;
    expect(fco).toBeDefined();
    expect(typeof fco!.output).toBe('string');
    expect(fco!.output as string).toContain('{"cols":80');
    // The image collapses to a size-note placeholder; bytes are gone
    // but the model still sees that visual content was produced.
    expect(fco!.output as string).toContain('image: image/png');
    expect(fco!.output as string).toContain('metadata only');
  });

  it('acceptToolImages=true emits ContentItem[] with input_image entry', () => {
    const out = messagesToResponsesInput(imageBearingMessages(), { acceptToolImages: true });
    const fco = out.input.find(
      (it) => 'type' in it && it.type === 'function_call_output',
    ) as { type: 'function_call_output'; call_id: string; output: unknown } | undefined;
    expect(fco).toBeDefined();
    expect(Array.isArray(fco!.output)).toBe(true);
    const items = fco!.output as Array<{ type: string }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ type: 'input_text', text: '{"cols":80,"rows":24,"width":640,"height":384}' });
    const img = items[1] as { type: 'input_image'; image_url: string; detail: string };
    expect(img.type).toBe('input_image');
    expect(img.image_url).toBe('data:image/png;base64,iVBORw0KGgo');
    expect(img.detail).toBe('auto');
  });

  it('acceptToolImages=true with text-only tool_result still uses string output', () => {
    const msgs: LLMMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'Read', input: { path: 'README.md' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'file contents here' },
        ],
      },
    ];
    const out = messagesToResponsesInput(msgs, { acceptToolImages: true });
    const fco = out.input.find(
      (it) => 'type' in it && it.type === 'function_call_output',
    ) as { type: 'function_call_output'; output: unknown } | undefined;
    expect(fco).toBeDefined();
    expect(typeof fco!.output).toBe('string');
    expect(fco!.output as string).toBe('file contents here');
  });

  it('acceptToolImages=true with array tool_result lacking images uses string fallback', () => {
    const msgs: LLMMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'Read', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'c1',
            content: [{ type: 'text', text: 'just text' }],
          },
        ],
      },
    ];
    const out = messagesToResponsesInput(msgs, { acceptToolImages: true });
    const fco = out.input.find(
      (it) => 'type' in it && it.type === 'function_call_output',
    ) as { type: 'function_call_output'; output: unknown } | undefined;
    expect(fco).toBeDefined();
    // No image present → fall through to legacy string form.
    expect(typeof fco!.output).toBe('string');
    expect(fco!.output).toBe('just text');
  });

  it('multi-image tool_result emits multiple input_image entries in order', () => {
    const msgs: LLMMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'WebTerminalScreenshot', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'c1',
            content: [
              { type: 'text', text: 'before' },
              { type: 'image', mediaType: 'image/png', base64: 'AAAA' },
              { type: 'image', mediaType: 'image/jpeg', base64: 'BBBB' },
              { type: 'text', text: 'after' },
            ],
          },
        ],
      },
    ];
    const out = messagesToResponsesInput(msgs, { acceptToolImages: true });
    const fco = out.input.find(
      (it) => 'type' in it && it.type === 'function_call_output',
    ) as { type: 'function_call_output'; output: Array<{ type: string }> } | undefined;
    expect(fco).toBeDefined();
    const types = fco!.output.map((it) => it.type);
    expect(types).toEqual(['input_text', 'input_image', 'input_image', 'input_text']);
  });
});

