// ── B (H1) (Phase 4 Bundle 2) — ACP native shell API generalization ──
//
// HANDOFF Phase 4 / ROADMAP §7 B: "ACP native shell API". A1 (Phase 2)
// 의 monad-specific JSON-RPC method 들을 일반화 — 모든 ACP server 가 따를
// 수 있는 표준 surface 와 typed interfaces 정의.
//
// A1 = monad/shell.{spawn,write,read,close} (monad-namespaced)
// B  = acp/shell.* (ACP standard 후보)
//
// 차이:
//   - Surface-agnostic — vw / modal / bg / inline 모두 동일 RPC
//   - Pagination · streaming · cursor 지원 (큰 output)
//   - Capability negotiation 표준 — server 가 spawn 시 가능한 actions list 광고

import type { ShellMode, ShellRegistry, ShellRequest } from '../shell-runner/types.js';
import type {
  MonadShellRpcDeps,
  MonadShellRpcHandlers,
  ShellSpawnRequest,
  ShellSpawnResponse,
  ShellWriteRequest,
  ShellWriteResponse,
  ShellReadRequest,
  ShellReadResponse,
  ShellCloseRequest,
  ShellCloseResponse,
} from './monad-shell-rpc.js';
import { createMonadShellRpcHandlers } from './monad-shell-rpc.js';

// ── Standard JSON-RPC method namespace ──────────────────────────────

export const ACP_SHELL_RPC_METHODS = {
  spawn: 'acp/shell.spawn',
  write: 'acp/shell.write',
  read: 'acp/shell.read',
  list: 'acp/shell.list',          // NEW (B 일반화)
  capabilities: 'acp/shell.capabilities',  // NEW
  close: 'acp/shell.close',
} as const;

// ── Capability discovery (B 신규) ──────────────────────────────────

export type AcpShellAction = 'spawn' | 'write' | 'read' | 'close' | 'list' | 'capabilities';

export interface ShellCapabilityDescriptor {
  /** What actions does this server support. */
  readonly supportedActions: readonly AcpShellAction[];
  /** Which shell modes can spawn. */
  readonly supportedModes: readonly ShellMode[];
  /** Server identifier (예: 'monad', 'cursor-acp', 'zed-acp'). */
  readonly serverName: string;
  /** Server version. */
  readonly serverVersion?: string;
  /** Whether the server can stream output (vs poll). */
  readonly streamingSupported: boolean;
  /** Max bytes per read response. */
  readonly maxReadBytes: number;
}

// ── List (B 신규) ──────────────────────────────────────────────────

export interface ShellListRequest {
  /** Pagination cursor (server-issued). */
  readonly cursor?: string;
  /** Max items per page. Default 20. */
  readonly limit?: number;
  /** Filter — only specific status. */
  readonly statusFilter?: 'running' | 'completed' | 'killed' | 'backgrounded';
}

export interface ShellListEntry {
  readonly shellId: string;
  readonly mode: ShellMode;
  readonly status: string;
  readonly description?: string;
}

export interface ShellListResponse {
  readonly entries: readonly ShellListEntry[];
  /** When set, more pages exist — caller passes back as cursor. */
  readonly nextCursor?: string;
}

// ── Re-exports of A1 shapes (B uses same types) ────────────────────

export type {
  ShellSpawnRequest, ShellSpawnResponse,
  ShellWriteRequest, ShellWriteResponse,
  ShellReadRequest, ShellReadResponse,
  ShellCloseRequest, ShellCloseResponse,
};

// ── Native handlers (B = A1 + list + capabilities) ──────────────────

export interface AcpNativeShellHandlers extends MonadShellRpcHandlers {
  list(req: ShellListRequest): Promise<ShellListResponse>;
  capabilities(): Promise<ShellCapabilityDescriptor>;
}

export interface AcpNativeShellDeps extends MonadShellRpcDeps {
  /** Server descriptor. */
  serverName: string;
  serverVersion?: string;
  /** Default capabilities — overrideable per call. */
  defaultCapabilities?: Partial<ShellCapabilityDescriptor>;
}

const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_MAX_READ = 16 * 1024;

export function createAcpNativeShellHandlers(
  deps: AcpNativeShellDeps,
): AcpNativeShellHandlers {
  const a1Handlers = createMonadShellRpcHandlers(deps);

  const capabilities = async (): Promise<ShellCapabilityDescriptor> => ({
    supportedActions: deps.defaultCapabilities?.supportedActions ?? ['spawn', 'read', 'list', 'capabilities'],
    supportedModes: deps.defaultCapabilities?.supportedModes ?? ['vw', 'inline', 'bg'],
    serverName: deps.serverName,
    ...(deps.serverVersion !== undefined ? { serverVersion: deps.serverVersion } : {}),
    streamingSupported: deps.defaultCapabilities?.streamingSupported ?? false,
    maxReadBytes: deps.defaultCapabilities?.maxReadBytes ?? DEFAULT_MAX_READ,
  });

  const list = async (req: ShellListRequest): Promise<ShellListResponse> => {
    const limit = req.limit ?? DEFAULT_LIST_LIMIT;
    const filterStatus = req.statusFilter;
    const all = deps.registry.list();
    const entries: ShellListEntry[] = [];
    // Cursor format: numeric offset (simple). Production: opaque token.
    const offset = req.cursor ? parseInt(req.cursor, 10) || 0 : 0;
    let count = 0;
    for (let i = offset; i < all.length && count < limit; i += 1) {
      const handle = all[i]!;
      if (filterStatus && handle.status !== filterStatus) continue;
      entries.push({
        shellId: handle.id,
        mode: handle.mode,
        status: handle.status,
      });
      count += 1;
    }
    const consumed = offset + count;
    const nextCursor = consumed < all.length ? String(consumed) : undefined;
    return {
      entries,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  };

  return {
    spawn: a1Handlers.spawn,
    write: a1Handlers.write,
    read: a1Handlers.read,
    close: a1Handlers.close,
    list,
    capabilities,
  };
}

/** Helper — generate a typed router map for JSON-RPC server registration. */
export function bindAcpShellMethods(
  handlers: AcpNativeShellHandlers,
): Record<string, (params: unknown) => Promise<unknown>> {
  return {
    [ACP_SHELL_RPC_METHODS.spawn]: (p) => handlers.spawn(p as ShellSpawnRequest),
    [ACP_SHELL_RPC_METHODS.write]: (p) => handlers.write(p as ShellWriteRequest),
    [ACP_SHELL_RPC_METHODS.read]: (p) => handlers.read(p as ShellReadRequest),
    [ACP_SHELL_RPC_METHODS.close]: (p) => handlers.close(p as ShellCloseRequest),
    [ACP_SHELL_RPC_METHODS.list]: (p) => handlers.list(p as ShellListRequest),
    [ACP_SHELL_RPC_METHODS.capabilities]: () => handlers.capabilities(),
  };
}
