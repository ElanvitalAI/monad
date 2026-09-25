// Image-pipeline P3.5 (2026-05-05) — Gemini 3+ multimodal
// functionResponse.parts wire.
//
// Verifies that messagesToGeminiInput emits a `parts` array on the
// functionResponse when the caller opts in (acceptToolImages, set by
// the Gemini provider for gemini-3.x+ per the verified spec at
// `https://ai.google.dev/gemini-api/docs/function-calling`). The
// legacy text-only `response: {output: <text>}` companion stays as
// the textual carrier so the model still sees metadata + the new
// `parts` array delivers the actual image bytes.

import { describe, expect, test } from 'bun:test';
import { messagesToGeminiInput, type LLMMessage } from '../src/llm.js';

function imageBearingMessages(): LLMMessage[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call_42', name: 'WebTerminalScreenshot', input: { terminalId: 'preview-1' } },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_42',
          content: [
            { type: 'text', text: '{"cols":80,"rows":24,"width":640,"height":384}' },
            { type: 'image', mediaType: 'image/png', base64: 'iVBORw0KGgo' },
          ],
        },
      ],
    },
  ];
}

function findFunctionResponse(out: ReturnType<typeof messagesToGeminiInput>): Record<string, unknown> | undefined {
  // tool_result lives in the second message (role: 'user'); the parts
  // we look for are the functionResponse entry inside it.
  for (const c of out.contents) {
    for (const p of c.parts) {
      const fr = (p as { functionResponse?: Record<string, unknown> }).functionResponse;
      if (fr) return fr;
    }
  }
  return undefined;
}

describe('messagesToGeminiInput — functionResponse.parts (Gemini 3+ vision)', () => {
  test('default (acceptToolImages=false) keeps legacy response-only path; no parts field', () => {
    const out = messagesToGeminiInput(imageBearingMessages());
    const fr = findFunctionResponse(out);
    expect(fr).toBeDefined();
    expect(fr!.id).toBe('call_42');
    expect(fr!.name).toBe('WebTerminalScreenshot');
    // response is text-only via stringifyToolResultContent — image
    // collapsed to size-note placeholder.
    const response = fr!.response as { output: string };
    expect(typeof response.output).toBe('string');
    expect(response.output).toContain('{"cols":80');
    expect(response.output).toContain('image: image/png');
    // No `parts` field in the legacy path — preserves wire shape for
    // pre-3.x Gemini that doesn't recognize it.
    expect(fr!.parts).toBeUndefined();
  });

  test('acceptToolImages=true attaches inline_data parts alongside text response', () => {
    const out = messagesToGeminiInput(imageBearingMessages(), { acceptToolImages: true });
    const fr = findFunctionResponse(out);
    expect(fr).toBeDefined();
    // response companion still carries the text metadata (Gemini 3 reads
    // both — response is the JSON pointer / metadata, parts is the
    // actual multimodal payload).
    const response = fr!.response as { output: string };
    expect(typeof response.output).toBe('string');
    expect(response.output).toContain('{"cols":80');
    // parts array carries the FunctionResponsePart entries.
    const parts = fr!.parts as Array<Record<string, unknown>>;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts).toHaveLength(1);
    const inline = (parts[0] as { inlineData: Record<string, unknown> }).inlineData;
    expect(inline).toBeDefined();
    expect(inline.mimeType).toBe('image/png');
    expect(inline.displayName).toBe('call_42-img-1');
    expect(inline.data).toBe('iVBORw0KGgo');
  });

  test('acceptToolImages=true with text-only tool_result emits no parts', () => {
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
    const out = messagesToGeminiInput(msgs, { acceptToolImages: true });
    const fr = findFunctionResponse(out);
    expect(fr).toBeDefined();
    expect(fr!.parts).toBeUndefined();
    const response = fr!.response as { output: string };
    expect(response.output).toBe('file contents here');
  });

  test('acceptToolImages=true with array tool_result lacking images emits no parts', () => {
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
    const out = messagesToGeminiInput(msgs, { acceptToolImages: true });
    const fr = findFunctionResponse(out);
    expect(fr!.parts).toBeUndefined();
    expect((fr!.response as { output: string }).output).toBe('just text');
  });

  test('multiple images — each gets a unique displayName indexed from 1', () => {
    const msgs: LLMMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'multi', name: 'WebTerminalScreenshot', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'multi',
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
    const out = messagesToGeminiInput(msgs, { acceptToolImages: true });
    const fr = findFunctionResponse(out);
    const parts = fr!.parts as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(2);
    const names = parts.map((p) => ((p as { inlineData: Record<string, unknown> }).inlineData.displayName));
    expect(names).toEqual(['multi-img-1', 'multi-img-2']);
    const types = parts.map((p) => ((p as { inlineData: Record<string, unknown> }).inlineData.mimeType));
    expect(types).toEqual(['image/png', 'image/jpeg']);
  });

  test('functionResponse.name still resolves via toolUseNameById map', () => {
    // Regression — make sure adding the parts branch didn't break the
    // pre-existing name resolution that prevents 400 INVALID_ARGUMENT
    // on multi-turn (Gemini matches functionResponse to functionCall
    // by name, not just id).
    const out = messagesToGeminiInput(imageBearingMessages(), { acceptToolImages: true });
    const fr = findFunctionResponse(out);
    expect(fr!.name).toBe('WebTerminalScreenshot');
  });
});

// P-3 §6.9 (2026-05-07) — user-message image gating axis.
describe('messagesToGeminiInput — userMessage image axis (P-3 §6.9 · 2026-05-07)', () => {
  test('default (acceptUserMessageImages=true) — user image stays as inlineData', () => {
    const msgs: LLMMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        { type: 'image', mediaType: 'image/png', base64: 'XYZ' },
      ],
    }];
    const out = messagesToGeminiInput(msgs);
    const parts = out.contents[0]!.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: 'describe' });
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'XYZ' } });
  });

  test('acceptUserMessageImages=false — user image becomes text placeholder', () => {
    const msgs: LLMMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        { type: 'image', mediaType: 'image/jpeg', base64: '/9j/' },
      ],
    }];
    const out = messagesToGeminiInput(msgs, { acceptUserMessageImages: false });
    const parts = out.contents[0]!.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: 'describe' });
    expect(parts[1]).toEqual({ text: '[image: image/jpeg (model not vision-capable)]' });
  });

  test('Q1=B order — text-then-image array preserves order in parts', () => {
    const msgs: LLMMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'compare' },
        { type: 'image', mediaType: 'image/png', base64: 'A' },
        { type: 'image', mediaType: 'image/png', base64: 'B' },
      ],
    }];
    const out = messagesToGeminiInput(msgs);
    const parts = out.contents[0]!.parts;
    expect(parts.map((p) => Object.keys(p)[0])).toEqual(['text', 'inlineData', 'inlineData']);
  });

  test('acceptUserMessageImages=false does NOT affect tool-result image route', () => {
    const out = messagesToGeminiInput(imageBearingMessages(), {
      acceptToolImages: true,
      acceptUserMessageImages: false,
    });
    const fr = findFunctionResponse(out);
    // tool_result image still goes to parts when acceptToolImages=true.
    expect(fr!.parts).toBeDefined();
    expect((fr!.parts as Array<unknown>).length).toBeGreaterThan(0);
  });
});
