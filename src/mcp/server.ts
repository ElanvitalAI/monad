// ── Minimal MCP stdio server (Track I) ──
//
// Exposes the monad ToolRuntime registry to external MCP clients via
// stdin/stdout JSON-RPC. This is a focused implementation — it does
// not depend on @modelcontextprotocol/sdk to keep the footprint
// small; we speak the narrow subset of MCP that tool consumers need:
//
//   initialize           → capabilities handshake
//   tools/list           → enumerate runtimes with MCP surface
//   tools/call           → dispatch a single tool by name
//   notifications/*      → ignored (we don't expect any)
//
// Transport: stdio with line-delimited JSON-RPC 2.0 messages (no
// Content-Length framing — matches Claude Code's stdio MCP client
// expectation). Each request/response is one JSON object per line.
//
// Design: the server is a PURE function of (registry, context) — no
// global state, no singleton, so tests can spin up multiple in a
// single process. `startMcpStdioServer()` is the convenience entry
// point that pipes to process.stdin / process.stdout.

import type { ToolRuntime, ToolSurface, ToolRunResult } from '../tool-runtime/types.js';
import { registerAllDefaultToolRuntimes } from '../tool-runtime/index.js';
import { dispatchToolByName, listToolRuntimes, getToolRuntime } from '../tool-runtime/registry.js';
import { findNativeTool } from '../native-tool-catalog.js';
import { debug } from '../debug/log.js';
import { userIntentLogger } from '../user-intent/index.js';

// ─── JSON-RPC shapes ─────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Canonical latest protocol version monad will speak. Server and client
 *  both read this — do not duplicate the string elsewhere. */
export const MCP_PROTOCOL_VERSION_LATEST = '2025-11-25' as const;

/** Versions monad can speak. `2024-11-05` stays so already-attached
 *  peers keep working; latest is the one new handshakes offer. */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2024-11-05',
  MCP_PROTOCOL_VERSION_LATEST,
] as const;

export type McpSupportedProtocolVersion =
  (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

/** Pure negotiation: echo a supported request, otherwise the latest we
 *  speak. Missing / malformed / unknown values are not JSON-RPC errors
 *  — they fall back, matching the initialize success path. */
export function negotiateMcpProtocolVersion(
  requested: unknown,
): McpSupportedProtocolVersion {
  if (
    typeof requested === 'string' &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested as McpSupportedProtocolVersion;
  }
  return MCP_PROTOCOL_VERSION_LATEST;
}

const SERVER_INFO = { name: 'monad-agent', version: '0.1.0' };

// ─── Handler ─────────────────────────────────────────────────────

export interface McpServerContext {
  /** Which monad surface the remote caller is authenticated as.
   *  Drives listToolRuntimes filter + ctx.surface at dispatch.
   *  Default 'mcp' so tools intended for MCP (catalog surface
   *  contains 'mcp') show up. */
  surface?: ToolSurface;
  /** PFC capture seam origin tag (Post-Closure FU · 2026-05-13). The
   *  outermost transport sets this when handing the request in:
   *    • mcp-http   — POST /v1/mcp   (Streamable HTTP transport)
   *    • mcp-stdio  — `monad mcp serve` stdio JSON-RPC
   *    • rest       — POST /v1/tools/<id>/call (REST shim)
   *  `tools/call` flips the per-call user-intent emit with this tag
   *  so the Patcher / KGS can distinguish where the call originated.
   *  Unset = emit is skipped (preserves backward-compat for any caller
   *  not yet origin-aware). */
  origin?: 'mcp-http' | 'mcp-stdio' | 'rest';
}

/** Emit a `system.mcp.proxy_call` user-intent event for a single
 *  tool dispatch. Best-effort — sink failures swallowed upstream by
 *  `userIntentLogger.emit`, and the outer try/catch keeps the
 *  JSON-RPC contract clean if the singleton itself throws.
 *
 *  Exported so non-MCP transports (REST shim at /v1/tools/<id>/call)
 *  can fan into the same PFC capture seam without duplicating the
 *  event shape. */
export function emitProxyCallIntent(
  toolName: string,
  origin: McpServerContext['origin'],
  success: boolean,
  errorKind?: string,
): void {
  if (!origin) return;
  try {
    userIntentLogger().emit({
      surface: 'tui',
      intent: {
        layer: 'system',
        kind: 'system.mcp.proxy_call',
        target: { kind: 'tool', id: toolName },
        value: { origin },
      },
      outcome: errorKind !== undefined ? { success, error_kind: errorKind } : { success },
    });
  } catch { /* best-effort */ }
}

export async function handleMcpRequest(
  req: JsonRpcRequest,
  ctx: McpServerContext = {},
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  const base = { jsonrpc: '2.0' as const, id };
  try {
    switch (req.method) {
      case 'initialize':
        return {
          ...base,
          result: {
            protocolVersion: negotiateMcpProtocolVersion(req.params?.protocolVersion),
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };

      case 'initialized':
      case 'notifications/initialized':
        return { ...base, result: {} };

      case 'tools/list': {
        ensureDefaultMcpToolRuntimes();
        const surface = ctx.surface ?? 'mcp';
        const runtimes = listToolRuntimes(surface);
        logMcpToolsList(runtimes, surface, ctx.origin);
        return { ...base, result: { tools: runtimes.map(runtimeToMcpTool) } };
      }

      case 'tools/call': {
        ensureDefaultMcpToolRuntimes();
        const name = typeof req.params?.name === 'string' ? req.params.name : '';
        const args = (req.params?.arguments as Record<string, unknown>) ?? {};
        const surface = ctx.surface ?? 'mcp';
        const rt = getToolRuntime(name);
        const isExposedOnSurface = listToolRuntimes(surface).some(runtime => runtime.id === rt?.id);
        if (!rt || !isExposedOnSurface) {
          emitProxyCallIntent(name, ctx.origin, false, 'unknown_tool');
          return {
            ...base,
            error: { code: -32601, message: `unknown tool: ${name}` },
          };
        }
        try {
          const out = await dispatchToolByName(name, args, { surface });
          emitProxyCallIntent(name, ctx.origin, true);
          return { ...base, result: toMcpToolCallResult(out) };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emitProxyCallIntent(name, ctx.origin, false, msg);
          throw err;
        }
      }

      case 'ping':
        return { ...base, result: {} };

      default:
        return {
          ...base,
          error: { code: -32601, message: `method not found: ${req.method}` },
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, error: { code: -32000, message: msg } };
  }
}

/** Ensure direct MCP transports expose monad-owned runtimes even before
 * the daemon's broader boot sequence has registered them. Registration is
 * idempotent, so externally registered proxy runtimes remain untouched. */
function ensureDefaultMcpToolRuntimes(): void {
  if (!getToolRuntime('monad_autopilot_launch')) {
    registerAllDefaultToolRuntimes();
  }
}

function logMcpToolsList(
  runtimes: ToolRuntime[],
  surface: ToolSurface,
  origin: McpServerContext['origin'],
): void {
  try {
    let nativeToolCount = 0;
    for (const runtime of runtimes) {
      if (findNativeTool(runtime.id)) nativeToolCount += 1;
    }
    debug.log('mcp.tools-list', 'responded', {
      surface,
      origin: origin ?? null,
      totalToolCount: runtimes.length,
      nativeToolCount,
      proxyToolCount: runtimes.length - nativeToolCount,
    });
  } catch { /* observability must not break JSON-RPC */ }
}

function runtimeToMcpTool(rt: ToolRuntime): Record<string, unknown> {
  return {
    name: rt.spec.name,
    description: rt.spec.description,
    inputSchema: rt.spec.parameters,
  };
}

function toMcpToolCallResult(out: ToolRunResult): Record<string, unknown> {
  // MCP tool-call result convention: { content: [ { type:'text', text } ] }.
  // For tools whose result has a summary `output` we surface that as
  // the text; the full structured payload lives in `structuredContent`
  // for clients that care.
  const outputText =
    typeof (out as { output?: unknown }).output === 'string'
      ? String((out as { output?: unknown }).output)
      : JSON.stringify(out);
  return {
    content: [{ type: 'text', text: outputText }],
    structuredContent: out as unknown,
  };
}

// ─── Stdio wiring ────────────────────────────────────────────────

export interface McpStdioStream {
  onLine(cb: (line: string) => void): () => void;
  write(line: string): void;
}

export function createMcpStdioServer(
  stream: McpStdioStream,
  ctx: McpServerContext = {},
): { stop: () => void } {
  const dispose = stream.onLine(async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      stream.write(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'parse error' },
      }));
      return;
    }
    const resp = await handleMcpRequest(req, ctx);
    // Notifications (no `id`) are fire-and-forget per JSON-RPC 2.0.
    if (req.id === undefined || req.id === null) return;
    stream.write(JSON.stringify(resp));
  });
  return { stop: () => dispose() };
}

/** Convenience — pipe to process.stdin/stdout. The returned stop()
 *  removes listeners but does NOT close stdin (the caller may still
 *  want other consumers). */
export function startMcpStdioServer(ctx: McpServerContext = {}): { stop: () => void } {
  const listeners = new Set<(line: string) => void>();
  let buffer = '';
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      for (const cb of listeners) { try { cb(line); } catch { /* swallow */ } }
    }
  };
  process.stdin.on('data', onData);
  const stream: McpStdioStream = {
    onLine(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    write(line) { process.stdout.write(line + '\n'); },
  };
  const inner = createMcpStdioServer(stream, ctx);
  return {
    stop: () => {
      process.stdin.off('data', onData);
      inner.stop();
    },
  };
}
