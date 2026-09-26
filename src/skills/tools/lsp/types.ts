// ── LSP types (subset used by elanous's L1 client) ──
//
// LSP spec v3.17 is large — we carry only the shapes we actually read
// or write. Additional ops in L2/L3/L4 extend this file rather than
// pulling a full `vscode-languageserver-protocol` dependency, which
// would be overkill for our minimal surface.

/** LSP position — 0-indexed line + character (UTF-16 code units).
 *  We translate from the LLM-facing 1-indexed numbers at the tool
 *  boundary in `dispatchLsp`. */
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end:   LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

/** Markup kind used by Hover contents and SignatureHelp. Only
 *  'plaintext' | 'markdown' are defined by the spec. */
export type LspMarkupKind = 'plaintext' | 'markdown';

export interface LspMarkupContent {
  kind:  LspMarkupKind;
  value: string;
}

/** Hover response. `contents` can be several shapes in the wild —
 *  older servers return a string, newer ones return MarkupContent, and
 *  some still return a `MarkedString[]` union. We handle all three in
 *  the formatter. */
export interface LspHoverResult {
  contents: LspMarkupContent | string | Array<string | { language: string; value: string }>;
  range?: LspRange;
}

/** JSON-RPC 2.0 request / response / notification envelopes. We spell
 *  these out explicitly so the framing layer doesn't drift into `any`. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Minimal InitializeParams — we declare only the client capabilities
 *  we actually use. L2+ ops extend this with the feature flags their
 *  requests depend on. */
export interface LspInitializeParams {
  processId: number | null;
  rootUri: string | null;
  capabilities: {
    textDocument?: {
      hover?: { contentFormat?: LspMarkupKind[] };
      synchronization?: { didOpen?: boolean; didClose?: boolean };
    };
    workspace?: { workspaceFolders?: boolean };
  };
  workspaceFolders?: null;
  clientInfo?: { name: string; version?: string };
}

export interface LspInitializeResult {
  capabilities: Record<string, unknown>;
  serverInfo?: { name: string; version?: string };
}

/** TextDocumentItem for didOpen — LSP requires full content on sync. */
export interface LspTextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

// ── L2 additions: symbol / reference types ─────────────────────────

/** LSP SymbolKind enum — numeric wire values per spec v3.17 §3.17. */
export enum LspSymbolKind {
  File = 1, Module = 2, Namespace = 3, Package = 4, Class = 5,
  Method = 6, Property = 7, Field = 8, Constructor = 9, Enum = 10,
  Interface = 11, Function = 12, Variable = 13, Constant = 14,
  String = 15, Number = 16, Boolean = 17, Array = 18, Object = 19,
  Key = 20, Null = 21, EnumMember = 22, Struct = 23, Event = 24,
  Operator = 25, TypeParameter = 26,
}

/** Hierarchical symbol — returned by documentSymbol when the server
 *  honours `hierarchicalDocumentSymbolSupport: true`. */
export interface LspDocumentSymbol {
  name: string;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
  detail?: string;
}

/** Flat symbol — older documentSymbol shape and the canonical
 *  workspace/symbol response. */
export interface LspSymbolInformation {
  name: string;
  kind: LspSymbolKind;
  location: LspLocation;
  containerName?: string;
}

/** LSP v3.17 workspace symbol — location may be "lazy" (just a URI
 *  until the client requests `workspaceSymbol/resolve`). We accept
 *  both shapes in the formatter; a lazy location renders as a URI
 *  row without line/col. */
export interface LspWorkspaceSymbol {
  name: string;
  kind: LspSymbolKind;
  location: LspLocation | { uri: string };
  containerName?: string;
}

/** Parameters for textDocument/references request. */
export interface LspReferenceContext {
  includeDeclaration: boolean;
}
