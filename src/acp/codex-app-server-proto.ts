// Hand-authored minimal subset of the `codex app-server` JSON-RPC v2
// protocol. Phase 3.B.1 foundation — enough to exercise client framing
// and dispatch without vendoring 80 generated `.ts` files.
//
// Regenerate the full protocol bindings when more methods are wired:
//
//     codex app-server generate-ts --out /tmp/codex-ts
//
// Authoritative source: ~/source/ref/codex/codex-rs/app-server-protocol
// (v2.rs · 8,773 LOC).
//
// This file intentionally types params/results loosely (`unknown`)
// for methods the client doesn't yet formally model. When a caller
// adds typed wrappers around `client.request<TParams, TResult>(...)`,
// move the types here (or a sibling file) — don't let them leak into
// callers as `any`.

export type RequestId = string | number;

/** JSON-RPC 2.0 request object (client → server or server → client). */
export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params: TParams;
}

/** JSON-RPC 2.0 notification — no `id`, no response expected. */
export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: '2.0';
  method: string;
  params: TParams;
}

/** JSON-RPC 2.0 error object embedded in a response. */
export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 2.0 response — either `result` or `error` is present. */
export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  result?: TResult;
  error?: JsonRpcErrorBody;
}

/** Union of every shape the client may read from the server's stdout. */
export type IncomingMessage =
  | JsonRpcResponse
  | JsonRpcRequest
  | JsonRpcNotification;

/** Discriminators for the router — `method` present means request or
 *  notification (distinguished by `id`); absence means response. */
export function isResponse(msg: IncomingMessage): msg is JsonRpcResponse {
  return (
    typeof (msg as JsonRpcResponse).id !== 'undefined' &&
    typeof (msg as JsonRpcRequest).method === 'undefined'
  );
}

export function isRequest(msg: IncomingMessage): msg is JsonRpcRequest {
  return (
    typeof (msg as JsonRpcRequest).method === 'string' &&
    typeof (msg as JsonRpcRequest).id !== 'undefined'
  );
}

export function isNotification(
  msg: IncomingMessage,
): msg is JsonRpcNotification {
  return (
    typeof (msg as JsonRpcNotification).method === 'string' &&
    typeof (msg as JsonRpcRequest).id === 'undefined'
  );
}

// ─── Minimal typed method params · expand as callers add wrappers ──

/** `initialize` — first request a client sends. */
export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities?: InitializeCapabilities | null;
}

export interface ClientInfo {
  name: string;
  version: string;
}

/** Free-form capability bag — server advertises what's supported. For
 *  3.B.1 we do not enforce a shape; it's opaque. */
export interface InitializeCapabilities {
  [key: string]: unknown;
}

export interface InitializeResponse {
  serverInfo: { name: string; version: string };
  capabilities?: InitializeCapabilities;
  [key: string]: unknown;
}

/** `thread/start` · new conversation. Minimal fields only — full shape
 *  has ~15 optional overrides (see generated `v2/ThreadStartParams.ts`). */
export interface ThreadStartParamsMinimal {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never' | null;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  /** Required by the server schema (v2.rs) even though it's a boolean
   *  opt-in for an internal feature; caller must supply. */
  experimentalRawEvents: boolean;
  persistExtendedHistory: boolean;
  [key: string]: unknown;
}

export interface ThreadStartResponse {
  threadId: string;
  [key: string]: unknown;
}

/** M1 (2026-04-28) · ModeKind serialised by codex-rs (snake_case).
 *  See `codex-rs/protocol/src/config_types.rs:428` for the canonical
 *  enum. We omit `pair_programming` / `execute` because the upstream
 *  enum hides them from clients (TS skip + serde skip_serializing). */
export type CodexModeKind = 'plan' | 'default';

/** Settings carried inside a `CollaborationMode`. The model field is
 *  required upstream (server rejects when missing); reasoning_effort +
 *  developer_instructions are optional. Field names mirror the JSON
 *  wire shape (snake_case matches codex-rs serde derive). */
export interface CodexCollaborationModeSettings {
  model: string;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

/** Turn-level mode envelope. M1 carries this on `turn/start.params`
 *  when the host wants the upcoming turn to run in plan mode. Mode =
 *  'default' is the implicit shape — pass `undefined` instead of an
 *  envelope so the server picks the thread default. */
export interface CodexCollaborationMode {
  mode: CodexModeKind;
  settings: CodexCollaborationModeSettings;
}

/** `turn/start` · kicks off assistant work for a thread. M1 added the
 *  optional `collaborationMode` field — see `CodexCollaborationMode`. */
export interface TurnStartParamsMinimal {
  threadId: string;
  input: Array<UserInputItem>;
  collaborationMode?: CodexCollaborationMode;
  [key: string]: unknown;
}

/** Only the shapes we emit — Codex accepts more (image · file · etc).
 *
 *  ## Canonical spec
 *
 *  Our wire talks to `codex app-server` subprocess (see `backend-registry.ts`
 *  `command: 'codex', args: ['app-server']`). That surface is the
 *  **v2 app-server protocol**, NOT the core internal protocol — easy to
 *  confuse since both define a Rust enum named `UserInput`:
 *
 *  - v2 wire (what we talk to):
 *      `~/source/ref/codex/codex-rs/app-server-protocol/src/protocol/v2/turn.rs`
 *      (openai/codex: codex-rs/app-server-protocol/src/protocol/v2/turn.rs)
 *      `#[serde(tag = "type", rename_all = "camelCase")]` →
 *      JSON variants `text · image · localImage · skill · mention`
 *      (`Image { url }` · `LocalImage { path }`).
 *
 *  - core internal (NOT our wire):
 *      `~/source/ref/codex/codex-rs/protocol/src/user_input.rs`
 *      (openai/codex: codex-rs/protocol/src/user_input.rs)
 *      `#[serde(tag = "type", rename_all = "snake_case")]` →
 *      JSON variants `text · image · local_image · skill · mention`
 *      (`Image { image_url }` · `LocalImage { path }`).
 *
 *  ## History
 *
 *  PR #444 (2026-04-22) introduced the wire with the snake_case `local_image`
 *  — but the v2 camelCase surface had been in place since ~2026-03-09
 *  (Python SDK / pydantic codegen literals reference `"localImage"`). We
 *  inadvertently copied the *core* layer's rename, not the v2 wire layer.
 *  PR #2835 (2026-05-15) corrected to `localImage` after the runtime error
 *  `unknown variant local_image, expected one of text, image, localImage,
 *  skill, mention` surfaced from the live Codex CLI.
 *
 *  When extending this union (e.g. adding `Image { url }` for data URLs),
 *  read the v2 surface (`v2/turn.rs`) — NOT the core (`user_input.rs`). */
export type UserInputItem =
  | { type: 'text'; text: string }
  | { type: 'localImage'; path: string };

/** `turn/interrupt` · cancels an in-flight turn. */
export interface TurnInterruptParams {
  threadId: string;
}

// ─── M2 (2026-04-28) · client-mediated file ops ─────────────────────

/** `fs/readFile` server-request params. Codex asks the host to read a
 *  file from the local filesystem. Path is absolute (validated by host
 *  before fulfilling — workspace-root prefix gate).
 *
 *  Wire shape (camelCase serde rename_all):
 *      { path: string }
 *
 *  Reference: codex-rs `app-server-protocol/src/protocol/v2.rs:2956`. */
export interface FsReadFileParams {
  path: string;
}

/** `fs/readFile` response. Base64-encoded file contents — text/binary
 *  parity. Caller decodes per its own content-type signal. */
export interface FsReadFileResponse {
  dataBase64: string;
}

/** `fs/writeFile` server-request params. Plan mode SHOULD reject
 *  writes (M1 + M2 interaction); host enforces this gate, not codex. */
export interface FsWriteFileParams {
  path: string;
  dataBase64: string;
}

/** `fs/writeFile` response. Empty on success — server confirmation
 *  rides the JSON-RPC envelope. */
export type FsWriteFileResponse = Record<string, never>;

// ─── Server → client requests · subset ──────────────────────────────

export type ApprovalDecision = 'approve' | 'deny' | 'approve_for_turn' | 'approve_for_session';

/** Shape the Rust server sends for `item/commandExecution/requestApproval`.
 *  Real schema has more fields (see generated type) — we keep it loose. */
export interface CommandExecutionApprovalRequestMinimal {
  threadId: string;
  requestId: string;
  command: readonly string[];
  cwd?: string;
  [key: string]: unknown;
}

export interface FileChangeApprovalRequestMinimal {
  threadId: string;
  requestId: string;
  path: string;
  [key: string]: unknown;
}

// ─── Error subclass for typed rejection ────────────────────────────

/** Error thrown when the server responds with a JSON-RPC error. Carries
 *  the original code/message/data so callers can discriminate without
 *  string-matching the message. */
export class CodexAppServerError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(body: JsonRpcErrorBody) {
    super(body.message);
    this.name = 'CodexAppServerError';
    this.code = body.code;
    this.data = body.data;
  }
}
