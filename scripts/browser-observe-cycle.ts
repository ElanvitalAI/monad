#!/usr/bin/env bun
// 브라우저로 본 elanous PWA 화면을 세 상태로 가르는 관측 사이클.
// 값 획득(MCP/브라우저)과 판정(순수 분류)을 분리한다 — 분류는 네트워크 없이 값만으로 호출한다.
// 기본 MCP 전송은 기존 McpClient 의 initialize + Mcp-Session-Id 수명주기를 탄다.
// 스케줄러 진입점 배선은 다음 조각의 몫이다. 이 파일은 호출 가능한 함수만 내보낸다.

import { McpClient, McpServerError, type McpHttpFetch } from '../src/mcp/client.js';
import { debug } from '../src/debug/log.js';

export const ELANOUS_PWA_URL = 'http://127.0.0.1:31415/app';
export const ELANOUS_MCP_URL = 'http://127.0.0.1:31415/v1/mcp';
export const ASIDE_REPL_TOOL = 'aside.repl';
export const BROWSER_OBSERVE_LOG_CATEGORY = 'browser.observe';
export const BROWSER_OBSERVE_LOG_SURFACE = 'browser-observe';
export const BROWSER_OBSERVE_MCP_CLIENT_ID = 'browser-observe';
export const MCP_SESSION_HEADER = 'mcp-session-id';

/** 정상 */
export const BROWSER_OBSERVE_OK = 'ok';
/** 화면이 틀렸다 */
export const BROWSER_OBSERVE_WRONG_SCREEN = 'wrong-screen';
/** 관측하지 못했다 */
export const BROWSER_OBSERVE_UNOBSERVED = 'unobserved';

export type BrowserObserveStatus =
  | typeof BROWSER_OBSERVE_OK
  | typeof BROWSER_OBSERVE_WRONG_SCREEN
  | typeof BROWSER_OBSERVE_UNOBSERVED;

export interface BrowserObserveClassification {
  status: BrowserObserveStatus;
  observedUrl: string | null;
  reason: string;
}

export interface BrowserObserveMcpRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: {
    name: typeof ASIDE_REPL_TOOL;
    arguments: {
      title: string;
      code: string;
    };
  };
}

export interface BrowserObserveResult extends BrowserObserveClassification {
  request: BrowserObserveMcpRequest;
}

export type BrowserObserveMcpCall = (request: BrowserObserveMcpRequest) => Promise<unknown>;
export type BrowserObserveLog = (category: string, event: string, data?: unknown) => void;
export type BrowserObserveHttpFetch = McpHttpFetch;

export interface BrowserObserveDeps {
  mcpCall?: BrowserObserveMcpCall;
  fetch?: BrowserObserveHttpFetch;
  log?: BrowserObserveLog;
}

/**
 * 2026-08-24 실측 접근성 개요에서 elanous PWA 를 식별하는 마커.
 * HTML·data-testid·role="main" 이 아니라 tree 문자열의 접근성 항목이다.
 */
export const ELANOUS_PWA_TREE_MARKERS: readonly string[] = [
  'title: "elanous"',
  '- complementary:',
  'link "Observatory',
  'link "Autopilot',
];

export function isElanousPwaUrl(url: string): boolean {
  return url === ELANOUS_PWA_URL || url === `${ELANOUS_PWA_URL}/`;
}

export function isElanousPwaTree(tree: string): boolean {
  return ELANOUS_PWA_TREE_MARKERS.every((marker) => tree.includes(marker));
}

function readTree(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 값만 받아 세 상태를 돌려주는 공개 분류 함수. 브라우저·데몬·MCP 없이 호출한다. */
export function classifyBrowserObserve(input: {
  tree?: unknown;
  url?: unknown;
}): BrowserObserveClassification {
  const tree = readTree(input.tree);
  const observedUrl = readUrl(input.url);
  if (tree === null || observedUrl === null) {
    return {
      status: BROWSER_OBSERVE_UNOBSERVED,
      observedUrl,
      reason: tree === null ? 'tree-unreadable' : 'url-unreadable',
    };
  }
  if (!isElanousPwaTree(tree) || !isElanousPwaUrl(observedUrl)) {
    return {
      status: BROWSER_OBSERVE_WRONG_SCREEN,
      observedUrl,
      reason: 'not-elanous-pwa',
    };
  }
  return {
    status: BROWSER_OBSERVE_OK,
    observedUrl,
    reason: 'elanous-pwa',
  };
}

export function buildBrowserObserveReplCode(pwaUrl: string = ELANOUS_PWA_URL): string {
  // aside.repl keeps one persistent top-level scope across calls, so a
  // top-level const/let (e.g. `const pwaUrl`) collides on the second send.
  // Bindings stay inside this IIFE; top-level await is allowed in that REPL.
  return [
    'await (async () => {',
    `  const u = ${JSON.stringify(pwaUrl)};`,
    '  const p = await openTab(u);',
    '  try {',
    '    await p.goto(u);',
    '    await sleep(250);',
    '    const s = await snapshot(p, { interactive: true });',
    '    const url = p.url();',
    '    console.log(JSON.stringify({ tree: s && s.tree, url: typeof url === "string" && url.length > 0 ? url : null })); } finally { try { await closeTab(p); } catch {} } })();',
  ].join('\n');
}

export function buildBrowserObserveMcpRequest(
  pwaUrl: string = ELANOUS_PWA_URL,
): BrowserObserveMcpRequest {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: ASIDE_REPL_TOOL,
      arguments: {
        title: 'browser-observe-cycle',
        code: buildBrowserObserveReplCode(pwaUrl),
      },
    },
  };
}

function jsonRpcErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const message = (error as { message?: unknown }).message;
  const code = (error as { code?: unknown }).code;
  if (typeof message === 'string' && message.length > 0) return message;
  if (typeof code === 'number') return `json-rpc ${code}`;
  return 'json-rpc error';
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sliceCompleteJsonObject(text: string, start: number): string | undefined {
  if (text[start] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function lastJsonObjectInText(text: string): unknown | undefined {
  // Walk left-to-right and skip a successfully parsed object so nested `{`
  // inside the trailing result are not treated as independent top-level values.
  let last: unknown | undefined;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') {
      i += 1;
      continue;
    }
    const slice = sliceCompleteJsonObject(text, i);
    if (slice === undefined) {
      i += 1;
      continue;
    }
    const parsed = tryParseJson(slice);
    if (parsed !== undefined) {
      last = parsed;
      i += slice.length;
      continue;
    }
    i += 1;
  }
  return last;
}

/** aside.repl prefixes a human-readable line before the result JSON. */
function jsonValueFromText(text: string): unknown | undefined {
  const direct = tryParseJson(text);
  if (direct !== undefined) return direct;
  return lastJsonObjectInText(text);
}

function snapshotFromUnknown(value: unknown): { tree: unknown; url: unknown } {
  if (value === null || value === undefined) return { tree: null, url: null };
  if (typeof value === 'string') {
    const parsed = jsonValueFromText(value);
    if (parsed === undefined) return { tree: null, url: null };
    return snapshotFromUnknown(parsed);
  }
  if (typeof value !== 'object' || Array.isArray(value)) return { tree: null, url: null };
  const obj = value as Record<string, unknown>;
  if (jsonRpcErrorMessage(obj)) return { tree: null, url: null };
  if ('tree' in obj || 'url' in obj) return { tree: obj.tree, url: obj.url };
  if ('structuredContent' in obj && obj.structuredContent !== undefined) {
    const fromStructured = snapshotFromUnknown(obj.structuredContent);
    if (fromStructured.tree != null || fromStructured.url != null) return fromStructured;
  }
  if ('result' in obj) return snapshotFromUnknown(obj.result);
  if (Array.isArray(obj.content)) {
    for (const part of obj.content) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') return snapshotFromUnknown(text);
    }
  }
  return { tree: null, url: null };
}

export function createBrowserObserveMcpClient(fetchImpl?: BrowserObserveHttpFetch): McpClient {
  return new McpClient({
    id: BROWSER_OBSERVE_MCP_CLIENT_ID,
    url: ELANOUS_MCP_URL,
    reconnectBackoffMs: [],
    httpTimeoutMs: 30_000,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

async function callAsideReplViaMcpClient(
  request: BrowserObserveMcpRequest,
  fetchImpl?: BrowserObserveHttpFetch,
): Promise<unknown> {
  const client = createBrowserObserveMcpClient(fetchImpl);
  try {
    await client.start();
    return await client.callTool(request.params.name, {
      title: request.params.arguments.title,
      code: request.params.arguments.code,
    });
  } finally {
    await client.dispose();
  }
}

let logSinkReady = false;

/** debug.log 만으로는 logs.db 에 안 닿는다. 기본 실행 경로에서 영속 sink 를 건다. */
export async function ensureBrowserObserveLogSink(): Promise<boolean> {
  if (logSinkReady) return true;
  try {
    const { registerStandaloneLogSink } = await import('../src/domains/standalone-log-sink.js');
    logSinkReady = await registerStandaloneLogSink(BROWSER_OBSERVE_LOG_SURFACE);
    return logSinkReady;
  } catch {
    logSinkReady = false;
    return false;
  }
}

export function _resetBrowserObserveLogSinkForTest(): void {
  logSinkReady = false;
}

function defaultLog(category: string, event: string, data?: unknown): void {
  try {
    debug.log(category, event, data);
  } catch {
    /* fail-open */
  }
}

function emit(
  log: BrowserObserveLog,
  result: BrowserObserveClassification,
): void {
  log(BROWSER_OBSERVE_LOG_CATEGORY, result.status, {
    status: result.status,
    reason: result.reason,
    observedUrl: result.observedUrl,
  });
}

function unobservedFromCaught(caught: unknown): BrowserObserveClassification {
  if (caught instanceof McpServerError) {
    return {
      status: BROWSER_OBSERVE_UNOBSERVED,
      observedUrl: null,
      reason: `mcp-error:${caught.message}`,
    };
  }
  return {
    status: BROWSER_OBSERVE_UNOBSERVED,
    observedUrl: null,
    reason: `mcp-call:${caught instanceof Error ? caught.message : String(caught)}`,
  };
}

/** MCP 로 브라우저에서 값을 가져와 공개 분류 함수에 넘긴다. 의존성 주입으로 실 데몬 없이 검증한다. */
export async function observeBrowserCycle(
  deps: BrowserObserveDeps = {},
): Promise<BrowserObserveResult> {
  if (!deps.log) await ensureBrowserObserveLogSink();
  const log = deps.log ?? defaultLog;
  const mcpCall = deps.mcpCall ?? ((request) => callAsideReplViaMcpClient(request, deps.fetch));
  const request = buildBrowserObserveMcpRequest();
  try {
    const response = await mcpCall(request);
    const rpcError = jsonRpcErrorMessage(response);
    if (rpcError) {
      const classified: BrowserObserveClassification = {
        status: BROWSER_OBSERVE_UNOBSERVED,
        observedUrl: null,
        reason: `mcp-error:${rpcError}`,
      };
      emit(log, classified);
      return { ...classified, request };
    }
    const classified = classifyBrowserObserve(snapshotFromUnknown(response));
    emit(log, classified);
    return { ...classified, request };
  } catch (caught) {
    const classified = unobservedFromCaught(caught);
    emit(log, classified);
    return { ...classified, request };
  }
}

if (import.meta.main) {
  await ensureBrowserObserveLogSink();
  const result = await observeBrowserCycle();
  console.log(JSON.stringify({ status: result.status, reason: result.reason, observedUrl: result.observedUrl }));
  if (result.status !== BROWSER_OBSERVE_OK) process.exitCode = 1;
}
