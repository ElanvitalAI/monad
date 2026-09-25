// V2.2-2 (2026-05-12) — minimal SSE + REST client for the hosted
// chat page. Lives outside the daemon's primary ACP-coupled chat
// stack (`chat-runtime.ts`) because the hosted page targets the
// workflow runtime daemon's `/v1/workflows/chat/<path>` surface and
// renders only assistant-text frames — no tool calls, no compaction,
// no persistence beyond local component state.
//
// We can't use `EventSource` for the streaming case because it
// doesn't allow custom `Authorization` headers, so we fall back to
// `fetch` + a manual SSE parser. The wire format mirrors what
// `http-server.ts` emits (one `event:` line + one or more `data:`
// lines + blank line · `data:` multi-line splitting per V2.2-1).

export interface HostedChatConfig {
  workflowName: string;
  nodeId: string;
  path: string;
  streaming: boolean;
  sessionMode: 'stateless' | 'per-session';
  hostedUi: { enabled: boolean; requiresBearer: boolean };
}

export interface HostedChatFrame {
  event: string;
  data: string;
}

/** Fetch the workflow's chat-config metadata. Returns null when the
 *  workflow isn't found / doesn't have hostedUi enabled (404 from
 *  the daemon). Throws on network errors so the page can surface a
 *  connection-failed state distinct from "wrong workflow name." */
export async function fetchChatConfig(
  workflowName: string,
  opts: { fetchImpl?: typeof fetch; origin?: string } = {},
): Promise<HostedChatConfig | null> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.origin ?? ''}/v1/workflows/${encodeURIComponent(workflowName)}/chat-config`;
  const res = await f(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`chat-config ${res.status}`);
  return (await res.json()) as HostedChatConfig;
}

/** Send a message through the chat router. Returns the parsed JSON
 *  body for the non-streaming case or an async iterable of SSE
 *  frames for the streaming case. The caller decides how to render
 *  each frame (typewriter merge for `event: token` · status chips
 *  for `event: progress` · finalize on `event: done` / `event:
 *  error`). */
export interface SendMessageOpts {
  /** Chat trigger path (from chat-config). Already includes leading `/`. */
  chatPath: string;
  message: string;
  sessionId?: string;
  bearer?: string;
  streaming: boolean;
  fetchImpl?: typeof fetch;
  origin?: string;
  signal?: AbortSignal;
}

export interface SendMessageBufferedResult {
  kind: 'buffered';
  response: string;
  runId: string;
}

export interface SendMessageStreamingResult {
  kind: 'streaming';
  frames: AsyncIterable<HostedChatFrame>;
}

export async function sendChatMessage(
  opts: SendMessageOpts,
): Promise<SendMessageBufferedResult | SendMessageStreamingResult> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.origin ?? ''}/v1/workflows/chat${opts.chatPath}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer && opts.bearer.length > 0) headers['authorization'] = `Bearer ${opts.bearer}`;
  const body: { message: string; sessionId?: string } = { message: opts.message };
  if (opts.sessionId) body.sessionId = opts.sessionId;
  const res = await f(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`chat ${res.status}${text ? ': ' + text : ''}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream') && res.body) {
    return { kind: 'streaming', frames: parseSseStream(res.body) };
  }
  const parsed = (await res.json()) as { response?: string; runId?: string };
  return {
    kind: 'buffered',
    response: parsed.response ?? '',
    runId: parsed.runId ?? '',
  };
}

/** Parse a `text/event-stream` ReadableStream into per-event frames.
 *  Mirrors the encoder in `src/nexus/api/http-server.ts` — one event
 *  block separated by a blank line · each `data:` line concatenated
 *  with `\n` per the SSE spec so multi-line token chunks reassemble. */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<HostedChatFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Split on blank-line boundary. SSE events are `field:value`
      // lines + a trailing blank line. Use \n\n (LF) — modern
      // ReadableStream from `fetch` normalizes CRLF.
      let idx = buf.indexOf('\n\n');
      while (idx !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const frame = parseEventBlock(block);
        if (frame) yield frame;
        idx = buf.indexOf('\n\n');
      }
    }
    // Flush a trailing block without a terminating blank line (the
    // daemon always closes with one, but be defensive).
    if (buf.trim().length > 0) {
      const frame = parseEventBlock(buf);
      if (frame) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventBlock(block: string): HostedChatFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(':')) continue; // comment per SSE spec
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    // Per SSE spec, a single space after the colon is stripped.
    const value = line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
