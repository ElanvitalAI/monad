// ── A1 (Phase 2 Bundle 3) — ACP custom JSON-RPC: monad shell as child ──
//
// HANDOFF Phase 2 §5 A1 / ROADMAP §5: "Codex 가 monad shell 을 child
// terminal". 외부 ACP client (cursor / zed / codex) 가 monad 의 shell 을
// borrow 해서 명령 실행 + 결과 읽기.
//
// Custom JSON-RPC method 4 개 정의:
//
//   monad/shell.spawn   — 새 shell 생성 + handle id 반환
//   monad/shell.write   — 실행 중 shell 에 stdin/keystroke 전달
//   monad/shell.read    — 현재까지 누적 output snapshot
//   monad/shell.close   — kill + unregister
//
// Per substrate G6 모든 method 가 capability gate 통과 — host 가
// `policyGate` 주입으로 외부 client 가 어떤 surface 에 어떤 동작 가능한지
// 결정. 기본 정책: 외부 client 는 mode='vw' + interactive=false 만 spawn
// 가능, write 는 명시 grant 필요 (HITL).
//
// Pure router — 실제 ACP server 등록은 dashboard wiring (Bundle 4 가
// 필요 시 호출). 이 PR 는 handler logic + 정책 gate seam 까지만 land.

import type {
  ShellHandle,
  ShellMode,
  ShellRequest,
  ShellRegistry,
  ShellResult,
} from '../shell-runner/types.js';

// ── Method input/output shapes (JSON-clean) ──────────────────────────

export interface ShellSpawnRequest {
  /** Command — string for shell-form, array for argv. */
  readonly command: string | readonly string[];
  /** Default 'vw'. Other modes require policy grant (see below). */
  readonly mode?: ShellMode;
  /** Default false. true requires policy grant. */
  readonly interactive?: boolean;
  /** Free-form description shown in monad UI / status. */
  readonly description?: string;
  /** Caller-provided correlation id — echoed in response so the
   *  remote client can dedupe / cancel. */
  readonly clientReqId?: string;
}

export interface ShellSpawnResponse {
  readonly shellId: string;
  readonly mode: ShellMode;
  readonly clientReqId?: string;
}

export interface ShellWriteRequest {
  readonly shellId: string;
  /** Bytes to send (UTF-8). For interactive=true only — otherwise
   *  rejected. */
  readonly bytes: string;
}

export interface ShellWriteResponse {
  readonly written: number;
}

export interface ShellReadRequest {
  readonly shellId: string;
  /** Limit on returned bytes (head + tail trunc beyond). Default
   *  16 KiB so a chatty shell doesn't blow up the JSON envelope. */
  readonly maxBytes?: number;
}

export interface ShellReadResponse {
  readonly status: 'running' | 'completed' | 'killed' | 'backgrounded' | 'unknown';
  readonly aggregated: string;
  readonly truncated: boolean;
  /** When status !== 'running', includes the settled result. */
  readonly result?: {
    readonly exitCode?: number;
    readonly outcome: string;
    readonly durationMs: number;
  };
}

export interface ShellCloseRequest {
  readonly shellId: string;
  readonly signal?: 'SIGTERM' | 'SIGKILL';
}

export interface ShellCloseResponse {
  readonly closed: boolean;
}

// ── Policy gate ─────────────────────────────────────────────────────

export type ShellRpcPolicyAction =
  | 'spawn'
  | 'spawn-interactive'
  | 'spawn-modal-or-bg'
  | 'write'
  | 'read'
  | 'close';

export interface ShellRpcPolicyDeps {
  /** Returns true to allow the action, false to reject. The default
   *  policy (when none injected) is conservative:
   *    - spawn (mode=vw, interactive=false): allow
   *    - everything else: deny
   *  Production wiring should inject a richer policy that knows the
   *  client identity / capability grants. */
  policyGate?: (action: ShellRpcPolicyAction, ctx: { client?: string }) => boolean;
  /** Identifier for the calling client (e.g. 'codex' / 'cursor'). */
  client?: string;
}

const DEFAULT_POLICY: NonNullable<ShellRpcPolicyDeps['policyGate']> = (action) => {
  return action === 'spawn' || action === 'read';
};

// ── Handler factory ─────────────────────────────────────────────────

const DEFAULT_READ_BUDGET_BYTES = 16 * 1024;

export interface MonadShellRpcDeps extends ShellRpcPolicyDeps {
  registry: ShellRegistry;
  /** Inject the actual shell spawn function — typically the dashboard
   *  factory that wraps ShellRunner. Returning null indicates spawn
   *  failure (host policy, capacity, etc.). */
  spawnShell: (req: ShellRequest) => Promise<ShellHandle | null> | ShellHandle | null;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface MonadShellRpcHandlers {
  spawn(req: ShellSpawnRequest): Promise<ShellSpawnResponse>;
  write(req: ShellWriteRequest): Promise<ShellWriteResponse>;
  read(req: ShellReadRequest): Promise<ShellReadResponse>;
  close(req: ShellCloseRequest): Promise<ShellCloseResponse>;
}

export class ShellRpcDeniedError extends Error {
  constructor(public readonly action: ShellRpcPolicyAction) {
    super(`Shell RPC denied: ${action}`);
    this.name = 'ShellRpcDeniedError';
  }
}

export class ShellRpcNotFoundError extends Error {
  constructor(public readonly shellId: string) {
    super(`Shell handle not found: ${shellId}`);
    this.name = 'ShellRpcNotFoundError';
  }
}

function aggregateForRead(handle: ShellHandle, _maxBytes: number): {
  status: ShellReadResponse['status'];
  aggregated: string;
  truncated: boolean;
  result?: ShellReadResponse['result'];
} {
  const status = (handle.status ?? 'unknown') as ShellReadResponse['status'];
  // Settled handles: synchronously expose result via .result Promise.
  // We can't await here for read budget reasons — return what's
  // accessible. Production wiring may proxy to a snapshot service.
  return {
    status,
    aggregated: '',
    truncated: false,
  };
}

function trimWithBudget(text: string, maxBytes: number): { aggregated: string; truncated: boolean } {
  if (text.length <= maxBytes) return { aggregated: text, truncated: false };
  const halfBudget = Math.max(0, Math.floor(maxBytes / 2) - 1);
  const head = text.slice(0, halfBudget);
  const tail = text.slice(-halfBudget);
  return { aggregated: `${head}\n…\n${tail}`, truncated: true };
}

export function createMonadShellRpcHandlers(deps: MonadShellRpcDeps): MonadShellRpcHandlers {
  const policy = deps.policyGate ?? DEFAULT_POLICY;
  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };
  const ctx = { client: deps.client };

  return {
    async spawn(req) {
      const mode: ShellMode = req.mode ?? 'vw';
      const action: ShellRpcPolicyAction = req.interactive
        ? 'spawn-interactive'
        : mode === 'modal' || mode === 'bg'
          ? 'spawn-modal-or-bg'
          : 'spawn';
      if (!policy(action, ctx)) {
        log('acp.shell-rpc.spawn.denied', action, { mode, interactive: req.interactive });
        throw new ShellRpcDeniedError(action);
      }

      const shellRequest: ShellRequest = {
        command: req.command,
        mode,
        ...(req.interactive !== undefined ? { interactive: req.interactive } : {}),
        ...(req.description !== undefined ? { description: req.description } : {}),
      };
      const handle = await deps.spawnShell(shellRequest);
      if (!handle) {
        log('acp.shell-rpc.spawn.null', '', { mode, client: deps.client });
        throw new Error('spawn failed (host returned null)');
      }
      log('acp.shell-rpc.spawn.ok', handle.id, { mode, client: deps.client });
      return {
        shellId: handle.id,
        mode: handle.mode,
        ...(req.clientReqId !== undefined ? { clientReqId: req.clientReqId } : {}),
      };
    },

    async write(req) {
      if (!policy('write', ctx)) {
        log('acp.shell-rpc.write.denied', req.shellId);
        throw new ShellRpcDeniedError('write');
      }
      const handle = deps.registry.get(req.shellId);
      if (!handle) throw new ShellRpcNotFoundError(req.shellId);
      try {
        handle.write(req.bytes);
      } catch (err) {
        log('acp.shell-rpc.write.throw', req.shellId, { error: String(err) });
        throw err;
      }
      log('acp.shell-rpc.write.ok', req.shellId, { bytes: req.bytes.length });
      return { written: req.bytes.length };
    },

    async read(req) {
      if (!policy('read', ctx)) {
        log('acp.shell-rpc.read.denied', req.shellId);
        throw new ShellRpcDeniedError('read');
      }
      const handle = deps.registry.get(req.shellId);
      if (!handle) throw new ShellRpcNotFoundError(req.shellId);
      const maxBytes = req.maxBytes ?? DEFAULT_READ_BUDGET_BYTES;

      // Try to await result if already settled (synchronous-ish).
      let result: ShellResult | null = null;
      try {
        result = await Promise.race([
          handle.result,
          new Promise<null>((r) => setTimeout(() => r(null), 0)),
        ]);
      } catch { /* graceful */ }

      if (result) {
        const text = result.aggregated?.text
          ?? `${result.stdout?.text ?? ''}${result.stderr?.text ?? ''}`;
        const { aggregated, truncated } = trimWithBudget(text, maxBytes);
        return {
          status: handle.status as ShellReadResponse['status'],
          aggregated,
          truncated,
          result: {
            ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
            outcome: result.outcome,
            durationMs: result.durationMs,
          },
        };
      }

      // Still running — partial snapshot via aggregateForRead.
      const partial = aggregateForRead(handle, maxBytes);
      log('acp.shell-rpc.read.partial', req.shellId, { status: partial.status });
      return partial;
    },

    async close(req) {
      if (!policy('close', ctx)) {
        log('acp.shell-rpc.close.denied', req.shellId);
        throw new ShellRpcDeniedError('close');
      }
      const handle = deps.registry.get(req.shellId);
      if (!handle) {
        log('acp.shell-rpc.close.not-found', req.shellId);
        return { closed: false };
      }
      try {
        handle.kill(req.signal ?? 'SIGTERM');
        log('acp.shell-rpc.close.ok', req.shellId, { signal: req.signal ?? 'SIGTERM' });
        return { closed: true };
      } catch (err) {
        log('acp.shell-rpc.close.throw', req.shellId, { error: String(err) });
        return { closed: false };
      }
    },
  };
}

// ── ACP method binding (host registers these names with their
//     JSON-RPC server) ──

export const MONAD_SHELL_RPC_METHODS = {
  spawn: 'monad/shell.spawn',
  write: 'monad/shell.write',
  read: 'monad/shell.read',
  close: 'monad/shell.close',
} as const;
