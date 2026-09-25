import { describe, expect, it } from 'bun:test';

import { parsePromptSseStream, type PromptStreamHandlers } from './daemon-client';

function resultEvent(data: unknown): string {
  return `event: tool-result\ndata: ${JSON.stringify(data)}\n\n`;
}

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

type ToolResult = Parameters<NonNullable<PromptStreamHandlers['onToolResult']>>[0];

async function parseToolResults(chunks: string[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  await parsePromptSseStream(stream([
    ...chunks,
    'event: turn-end\ndata: {}\n\n',
  ]), { onToolResult: (result) => results.push(result) });
  return results;
}

describe('parsePromptSseStream tool-result metadata', () => {
  it('forwards rawOutput unchanged and preserves the four existing fields', async () => {
    const rawOutput = { answer: ['one', { two: true }] };
    const [result] = await parseToolResults([
      resultEvent({ id: 'tool-1', name: 'inspect', ok: true, summary: 'done', result: rawOutput }),
    ]);

    expect(result).toEqual({
      id: 'tool-1',
      name: 'inspect',
      ok: true,
      summary: 'done',
      rawOutput,
    });
    expect(result!.rawOutput).toEqual(rawOutput);
  });

  it('selects the nested MCP Apps resource URI', async () => {
    const [result] = await parseToolResults([
      resultEvent({
        id: 'nested', name: 'inspect', ok: true,
        result: { _meta: { ui: { resourceUri: 'ui://nested' } } },
      }),
    ]);

    expect(result).toMatchObject({ resourceUri: 'ui://nested' });
  });

  it('falls back to the flat resource URI when nested URI is absent or invalid', async () => {
    const results = await parseToolResults([
      resultEvent({
        id: 'flat', name: 'inspect', ok: true,
        result: { 'ui/resourceUri': 'ui://flat' },
      }),
      resultEvent({
        id: 'fallback', name: 'inspect', ok: true,
        result: {
          _meta: { ui: { resourceUri: 42 } },
          'ui/resourceUri': 'ui://fallback',
        },
      }),
    ]);

    expect(results.map((result) => result.resourceUri)).toEqual(['ui://flat', 'ui://fallback']);
  });

  it('prefers the nested resource URI when both protocol forms exist', async () => {
    const [result] = await parseToolResults([
      resultEvent({
        id: 'both', name: 'inspect', ok: true,
        result: {
          _meta: { ui: { resourceUri: 'ui://nested' } },
          'ui/resourceUri': 'ui://flat',
        },
      }),
    ]);

    expect(result).toMatchObject({ resourceUri: 'ui://nested' });
  });

  // ── 이름 불일치 회귀 (2026-08-20 · 실제로 어긋나 있었다) ──
  //
  // ⛔ 이 갈래('tool-result')의 발신 이름은 `result` 다. ACP 갈래('tool_call_update')의
  //    `rawOutput` 과 «다른 경로»이고, 한동안 여기서 `rawOutput` 을 읽어 값이 «안 왔다».
  it('⭐ 발신 이름은 `result` 다 — `rawOutput` 으로 보내면 «안 온다»', async () => {
    const [viaResult] = await parseToolResults([
      resultEvent({ id: 'a', name: 'x', ok: true, result: { hit: 1 } }),
    ]);
    expect(viaResult!.rawOutput).toEqual({ hit: 1 });

    const [viaWrongName] = await parseToolResults([
      resultEvent({ id: 'b', name: 'x', ok: true, rawOutput: { hit: 1 } } as never),
    ]);
    expect(viaWrongName).not.toHaveProperty('rawOutput');
  });

  it('⭐ 「왜 빠졌나」는 발신 쪽이 «아는» 사실이므로 그대로 나른다', async () => {
    const [r] = await parseToolResults([
      resultEvent({ id: 'c', name: 'x', ok: true, resultOmittedReason: 'too_large' } as never),
    ]);
    expect(r!.resultOmittedReason).toBe('too_large');
    expect(r).not.toHaveProperty('rawOutput');
  });

  it('does not leak a top-level resource URI when rawOutput has no valid URI', async () => {
    const [result] = await parseToolResults([
      resultEvent({
        id: 'top-level-uri', name: 'inspect', ok: true,
        resourceUri: 'ui://must-not-leak',
        result: { answer: 'no URI here' },
      }),
    ]);

    expect(result).toEqual({
      id: 'top-level-uri',
      name: 'inspect',
      ok: true,
      rawOutput: { answer: 'no URI here' },
    });
    expect(result).not.toHaveProperty('resourceUri');
  });

  it('omits rawOutput and resourceUri when absent, and omits only resourceUri for invalid values', async () => {
    const results = await parseToolResults([
      resultEvent({ id: 'absent', name: 'inspect', ok: true }),
      resultEvent({ id: 'null', name: 'inspect', ok: true, result: null }),
      resultEvent({ id: 'text', name: 'inspect', ok: true, result: 'text' }),
      resultEvent({ id: 'array', name: 'inspect', ok: true, result: [] }),
      resultEvent({
        id: 'invalid', name: 'inspect', ok: true,
        result: { _meta: null, 'ui/resourceUri': 42 },
      }),
    ]);

    for (const result of results) expect(result).not.toHaveProperty('resourceUri');
    expect(results[0]).not.toHaveProperty('rawOutput');
    expect(results.slice(1).map((result) => result.rawOutput)).toEqual([
      null,
      'text',
      [],
      { _meta: null, 'ui/resourceUri': 42 },
    ]);
  });

  it('skips malformed and null notifications and continues forwarding later tool results', async () => {
    const [result] = await parseToolResults([
      'event: tool-result\ndata: {broken\n\n',
      resultEvent(null),
      resultEvent({ id: 'after-malformed', name: 'next', ok: true, summary: 'still works' }),
    ]);

    expect(result).toEqual({
      id: 'after-malformed',
      name: 'next',
      ok: true,
      summary: 'still works',
    });
  });
});
