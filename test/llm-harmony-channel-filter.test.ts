// HarmonyChannelFilter behaviour tests (2026-05-14).
//
// Spec source: https://developers.openai.com/cookbook/articles/openai-harmony
//              https://github.com/openai/harmony
// Cross-checked via omni-crawl (grok-web + firecrawl) on 2026-05-14.
//
// The filter sits between `parseOpenAISSELines` raw `delta.content`
// and the emitted `LLMStreamEvent` so non-Harmony streams pass through
// unchanged, while Harmony streams route channel content correctly:
//   `final`       → text
//   `analysis`    → reasoning (CoT)
//   `thought`     → reasoning (alias for analysis seen on gemma-4-a4b)
//   `commentary`  → reasoning (tool-call body; the tool call itself
//                   comes via `tool_calls` API path, not here)
//   unknown       → reasoning (safer than discarding novel channels)
//
// We test the filter end-to-end via `parseOpenAISSELines` rather than
// reaching into the private class — that's the seam external callers
// observe and the easiest signal that a regression has shipped.

import { describe, test, expect } from 'bun:test';

import { parseOpenAISSELines } from '../src/llm.js';
import type { LLMStreamEvent } from '../src/llm.js';

async function collect(lines: string[]): Promise<LLMStreamEvent[]> {
  const out: LLMStreamEvent[] = [];
  for await (const ev of parseOpenAISSELines(lines)) out.push(ev);
  return out;
}

function ssline(delta: { content?: string; reasoning_content?: string }): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta }],
  })}`;
}

describe('HarmonyChannelFilter · non-Harmony streams pass through', () => {
  test('plain text deltas emit unchanged as text', async () => {
    const events = await collect([
      ssline({ content: 'Hello' }),
      ssline({ content: ', ' }),
      ssline({ content: 'world!' }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Hello, world!');
    // No reasoning emitted for pure-text streams.
    expect(events.filter((e) => e.type === 'reasoning')).toHaveLength(0);
  });

  test('legacy reasoning_content path stays separate from Harmony', async () => {
    const events = await collect([
      ssline({ reasoning_content: 'pondering...' }),
      ssline({ content: 'Answer: 42' }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Answer: 42');
    expect(reasoning).toBe('pondering...');
  });
});

describe('HarmonyChannelFilter · final channel → user-facing text', () => {
  test('single-delta basic final message', async () => {
    const events = await collect([
      ssline({ content: '<|channel|>final<|message|>Hi there!<|return|>' }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Hi there!');
  });

  test('analysis followed by final — only final reaches text', async () => {
    const events = await collect([
      ssline({
        content:
          '<|start|>assistant<|channel|>analysis<|message|>Computing 2+2=4.<|end|>' +
          '<|start|>assistant<|channel|>final<|message|>4<|return|>',
      }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('4');
    expect(reasoning).toBe('Computing 2+2=4.');
  });
});

describe('HarmonyChannelFilter · split-marker streaming', () => {
  test('marker tokens split across deltas still parse', async () => {
    // Split mid-token boundaries that DO straddle a marker — e.g.
    // `<|cha` in one chunk, `nnel|>final<|message|>` in the next.
    const events = await collect([
      ssline({ content: '<|cha' }),
      ssline({ content: 'nnel|>final<|messa' }),
      ssline({ content: 'ge|>Sure thing<|retur' }),
      ssline({ content: 'n|>' }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Sure thing');
  });

  test('content delta split across boundaries reassembles in order', async () => {
    const events = await collect([
      ssline({ content: '<|channel|>final<|message|>The answer ' }),
      ssline({ content: 'is forty-' }),
      ssline({ content: 'two.<|return|>' }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('The answer is forty-two.');
  });
});

describe('HarmonyChannelFilter · non-final channels route to reasoning', () => {
  test('analysis content → reasoning', async () => {
    const events = await collect([
      ssline({ content: '<|channel|>analysis<|message|>internal trace<|end|>' }),
      'data: [DONE]',
    ]);
    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(reasoning).toBe('internal trace');
  });

  test('thought alias (non-OpenAI fine-tunes) → reasoning', async () => {
    // gemma-4-a4b on LM Studio (2026-05-14 dogfood) emits
    // `<|channel|>thought` instead of `analysis`.
    const events = await collect([
      ssline({ content: '<|channel|>thought<|message|>let me think<|end|>' }),
      'data: [DONE]',
    ]);
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(reasoning).toBe('let me think');
    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
  });

  test('commentary to=functions.X → decoded as a tool call (not reasoning)', async () => {
    // gemma-4 / gpt-oss route tool calls through the `commentary
    // to=functions.X` channel + `<|call|>` terminator as *content*
    // (not the native tool_calls field for these LM Studio builds).
    // The filter must decode them into tool_call events, else the args
    // JSON leaks into the reasoning pane and the call never executes.
    const events = await collect([
      ssline({
        content:
          '<|channel|>commentary to=functions.get_weather<|constrain|>json' +
          '<|message|>{"city":"Seoul"}<|call|>',
      }),
      'data: [DONE]',
    ]);
    const toolCalls = events.filter(
      (e): e is Extract<LLMStreamEvent, { type: 'tool_call' }> => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('get_weather');
    expect(toolCalls[0]!.args).toEqual({ city: 'Seoul' });
    // Args JSON must NOT leak into reasoning text.
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(reasoning).not.toContain('city');
  });

  test('commentary WITHOUT a recipient still routes to reasoning', async () => {
    // Plain `commentary` (preamble, no `to=`) stays reasoning — only a
    // `to=functions.X` target turns the body into a tool call.
    const events = await collect([
      ssline({ content: '<|channel|>commentary<|message|>let me plan the steps<|end|>' }),
      'data: [DONE]',
    ]);
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(0);
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(reasoning).toBe('let me plan the steps');
  });

  test('tool call split across SSE chunks reassembles', async () => {
    // Streaming may split the header / args JSON / terminator across
    // deltas — the filter buffers until the call completes.
    const events = await collect([
      ssline({ content: '<|channel|>commentary to=functions.Write' }),
      ssline({ content: '<|message|>{"path":"/tmp/x",' }),
      ssline({ content: '"content":"hi"}<|call|>' }),
      'data: [DONE]',
    ]);
    const toolCalls = events.filter(
      (e): e is Extract<LLMStreamEvent, { type: 'tool_call' }> => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('Write');
    expect(toolCalls[0]!.args).toEqual({ path: '/tmp/x', content: 'hi' });
  });

  test('bare to=NAME (no functions. prefix) still decodes', async () => {
    const events = await collect([
      ssline({ content: '<|channel|>commentary to=Bash<|message|>{"cmd":"ls"}<|call|>' }),
      'data: [DONE]',
    ]);
    const toolCalls = events.filter(
      (e): e is Extract<LLMStreamEvent, { type: 'tool_call' }> => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('Bash');
    expect(toolCalls[0]!.args).toEqual({ cmd: 'ls' });
  });

  test('unknown channel still routes to reasoning (no silent drop)', async () => {
    const events = await collect([
      ssline({ content: '<|channel|>foobar<|message|>novel channel body<|end|>' }),
      'data: [DONE]',
    ]);
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(reasoning).toBe('novel channel body');
  });
});

describe('HarmonyChannelFilter · gemma-4 broken-token variants (2026-05-14)', () => {
  test('broken-open `<|channel>` + broken-close `<channel|>` → routes to reasoning', async () => {
    // Actual stream observed from mlx-community/gemma-4-26b-a4b-it
    // on LM Studio (2026-05-14 daemon log): the model emits
    // `<|channel>thought\n<channel|>` instead of the spec
    // `<|channel|>thought<|message|>...<|end|>`. The tolerant filter
    // must consume both variants so the markers don't leak into the
    // chat bubble.
    const events = await collect([
      ssline({ content: '<|channel>thought\nlet me think hard<channel|>' }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('');
    expect(reasoning).toBe('let me think hard');
    // Critical: no marker leakage in either sink.
    expect(text + reasoning).not.toContain('<|');
    expect(text + reasoning).not.toContain('|>');
    expect(text + reasoning).not.toContain('channel');
  });

  test('empty body between broken open/close still consumes markers cleanly', async () => {
    // Repro: gemma-4 sometimes emits the open/close pair with no body
    // between them, just the channel name + a newline. The filter
    // must consume everything and emit zero output.
    const events = await collect([
      ssline({ content: '<|channel>thought\n<channel|>' }),
      'data: [DONE]',
    ]);
    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
    // Reasoning sink also gets nothing (body was empty).
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(reasoning).toBe('');
  });

  test('mixed proper + broken markers in same stream', async () => {
    // A stream that mixes spec-compliant and gemma-4 variants — for
    // example, the model started with the right tokens and degraded.
    // Both kinds must route correctly.
    const events = await collect([
      ssline({ content: '<|channel|>final<|message|>Hello<|end|>' }),
      ssline({ content: '<|channel>thought\nmore reasoning<channel|>' }),
      ssline({ content: '<|channel|>final<|message|> world!<|return|>' }),
      'data: [DONE]',
    ]);
    const text = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Hello world!');
    expect(reasoning).toBe('more reasoning');
  });

  test('broken-open with channel name split across deltas', async () => {
    // The `<|channel>thought` payload itself can split across
    // delta boundaries — the tail of the channel name has to land
    // in header_broken state on the second delta.
    const events = await collect([
      ssline({ content: '<|channel>tho' }),
      ssline({ content: 'ught\nbody text<channel|>' }),
      'data: [DONE]',
    ]);
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    expect(reasoning).toBe('body text');
  });
});

describe('HarmonyChannelFilter · gemma-4-a4b iOS dogfood replay (2026-05-14)', () => {
  test('thought-only stream with no final yields zero user text', async () => {
    // What the user actually saw — 6 turns of `<|channel|>thought`
    // headers with no `<|channel|>final<|message|>...<|return|>`. The
    // filter routes everything to reasoning so the chat bubble stays
    // clean and the tool-loop fallback (`[NO FINAL SYNTHESIS]`)
    // takes the visible synthesis duty.
    const turns = Array.from({ length: 6 }, (_, i) =>
      ssline({
        content:
          `<|start|>assistant<|channel|>thought<|message|>turn ${i} reasoning<|end|>`,
      }),
    );
    const events = await collect([...turns, 'data: [DONE]']);
    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
    const reasoning = events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'reasoning'; kind: 'inline_delta' }> =>
        e.type === 'reasoning' && e.kind === 'inline_delta')
      .map((e) => e.delta)
      .join('');
    // Six concatenated reasoning bodies, no markers leaked.
    expect(reasoning).toBe(
      'turn 0 reasoningturn 1 reasoningturn 2 reasoningturn 3 reasoningturn 4 reasoningturn 5 reasoning',
    );
    expect(reasoning).not.toContain('<|');
    expect(reasoning).not.toContain('thought');
  });
});
