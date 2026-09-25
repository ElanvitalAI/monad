// V2.2-1 (2026-05-12) — LLM token-by-token streaming through the chat
// trigger SSE path. Integration test: a stub `callLLM` calls
// `onPartialChunk` with several deltas, the workflow runtime forwards
// each delta to the chat-source's `onTokenChunk` hook, and the chat
// trigger emits `event: token / data: <raw chunk>` frames interleaved
// with the regular `progress` frames. The HANDOFF V2.2-1 wire format
// is raw text in the SSE `data:` field — the SSE encoder in
// http-server.ts splits multi-line chunks into separate `data:` lines
// per the SSE spec so the receiving EventSource reassembles the
// original string.

import { describe, expect, it } from 'bun:test';
import { createWorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon';
import type { ChatStreamFrame } from '../src/workflow-runtime/triggers/chat-router';
import type { WorkflowDeps, WorkflowEntry } from '../src/workflow-runtime/types';

function wf(name: string, nodes: Array<Record<string, unknown>>): WorkflowEntry {
  return ({
    source: { kind: 'project', source: `${name}.yaml`, path: `${name}.yaml` },
    definition: { name, description: name, nodes },
  } as unknown) as WorkflowEntry;
}

async function collect(stream: AsyncIterable<ChatStreamFrame>): Promise<ChatStreamFrame[]> {
  const out: ChatStreamFrame[] = [];
  for await (const f of stream) out.push(f);
  return out;
}

function buildDeps(chunks: string[]): WorkflowDeps {
  return {
    callLLM: async ({ onPartialChunk }) => {
      // Synchronous deltas — flushed in order before the promise
      // resolves, mirroring how `streamLLM` invokes its onChunk
      // callback as the provider stream advances.
      let full = '';
      for (const c of chunks) {
        full += c;
        onPartialChunk?.(c);
      }
      return full;
    },
    runBash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

describe('chat trigger · LLM token streaming (V2.2-1)', () => {
  it('emits one event: token frame per LLM partial chunk', async () => {
    const chunks = ['Hello', ', ', 'world', '!'];
    const workflow = wf('chat-stream-tokens', [
      { id: 'in', chatTrigger: { path: '/stream', streaming: true } },
      { id: 'reply', prompt: 'unused', depends_on: ['in'] },
    ]);
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [workflow],
      deps: buildDeps(chunks),
    });
    await daemon.start();
    const res = await daemon.dispatchChat({
      path: '/stream',
      body: { message: 'hi' },
    });
    expect(res?.status).toBe(200);
    expect(res?.stream).toBeDefined();
    const frames = await collect(res!.stream!);
    await daemon.stop();

    const tokenFrames = frames.filter(f => f.event === 'token');
    expect(tokenFrames.map(f => f.data)).toEqual(chunks);

    // Ordering: start before any token, and done after every token.
    const events = frames.map(f => f.event);
    const firstTokenIdx = events.indexOf('token');
    const startIdx = events.indexOf('start');
    const doneIdx = events.indexOf('done');
    expect(startIdx).toBe(0);
    expect(firstTokenIdx).toBeGreaterThan(startIdx);
    expect(doneIdx).toBe(events.length - 1);
    for (const i of events.keys()) {
      if (events[i] === 'token') expect(i).toBeLessThan(doneIdx);
    }
  });

  it('preserves raw chunk content including newlines and spaces', async () => {
    // Raw text per HANDOFF V2.2-1 — newlines and leading/trailing
    // whitespace flow through untouched. The SSE encoder in
    // http-server.ts handles multi-line wire encoding; chat-source
    // emits the chunk verbatim.
    const chunks = ['line one\n', 'line two\n', '   indented'];
    const workflow = wf('chat-stream-multiline', [
      { id: 'in', chatTrigger: { path: '/multiline', streaming: true } },
      { id: 'reply', prompt: 'unused', depends_on: ['in'] },
    ]);
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [workflow],
      deps: buildDeps(chunks),
    });
    await daemon.start();
    const res = await daemon.dispatchChat({
      path: '/multiline',
      body: { message: 'hi' },
    });
    const frames = await collect(res!.stream!);
    await daemon.stop();

    expect(frames.filter(f => f.event === 'token').map(f => f.data)).toEqual(chunks);

    // The final done frame carries the buffered full text — workflow
    // executor still buffers via streamLLM, so downstream nodes /
    // output_format keep working unchanged.
    const doneFrame = frames.find(f => f.event === 'done');
    expect(doneFrame).toBeDefined();
    const doneBody = JSON.parse(doneFrame!.data) as { response: string };
    expect(doneBody.response).toBe(chunks.join(''));
  });

  it('omits token frames when streaming flag is absent', async () => {
    // Non-streaming chat triggers go through the synchronous JSON
    // body path — no stream object, callLLM still receives no
    // onPartialChunk consumer, and the response is buffered.
    const workflow = wf('chat-buffer', [
      { id: 'in', chatTrigger: { path: '/buffered' } },
      { id: 'reply', prompt: 'unused', depends_on: ['in'] },
    ]);
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [workflow],
      deps: buildDeps(['x', 'y', 'z']),
    });
    await daemon.start();
    const res = await daemon.dispatchChat({
      path: '/buffered',
      body: { message: 'hi' },
    });
    await daemon.stop();
    expect(res?.status).toBe(200);
    expect(res?.stream).toBeUndefined();
    expect(res?.body).toMatchObject({ ok: true, response: 'xyz' });
  });
});
