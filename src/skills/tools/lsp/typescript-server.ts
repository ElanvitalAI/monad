// ── typescript-language-server adapter ──
//
// Probes for the `typescript-language-server` binary on PATH, spawns
// it, runs the LSP `initialize` / `initialized` handshake with the
// capability set L1 actually uses (hover + didOpen), and exposes a
// ready-to-request LspClient.
//
// Matches the fail-soft install-hint pattern from src/skills/tools/
// ast-grep.ts — if the binary is missing, we throw a message telling
// the user exactly how to install it rather than ENOENT'ing at spawn.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { extname, resolve as resolvePath } from 'node:path';
import { debug } from '../../../debug/log.js';
import { getSessionCwd } from '../../../session/working-dir.js';
import { spawnLspClient, type LspClient } from './client.js';
import type {
  LspInitializeParams, LspInitializeResult, LspTextDocumentItem,
} from './types.js';

const BINARY_NAME = 'typescript-language-server';
const INSTALL_HINT =
  'Install with `npm i -g typescript-language-server typescript` ' +
  '(or equivalent for your Node package manager).';

/** Cached probe result — avoids a `which` fork on every dispatch.
 *  `undefined` = not yet probed; `null` = not installed; `string` = path. */
let probedPath: string | null | undefined = undefined;

/** Find the typescript-language-server binary. Uses `which` under the
 *  hood — same strategy as hasAstGrep / hasRipgrep so the UX stays
 *  consistent. Cached per process. */
export function typescriptLanguageServerBinary(): string | null {
  if (probedPath !== undefined) return probedPath;
  try {
    const r = spawnSync('which', [BINARY_NAME], { encoding: 'utf-8' });
    if (r.status === 0 && r.stdout) {
      const found = r.stdout.trim();
      probedPath = found.length > 0 ? found : null;
    } else {
      probedPath = null;
    }
  } catch {
    probedPath = null;
  }
  if (debug.enabled) {
    debug.log('lsp.typescript.probe', BINARY_NAME, { path: probedPath });
  }
  return probedPath;
}

/** Test-only hook to reset the probe cache. Exported so unit tests
 *  can validate the "not installed" branch without leaking state. */
export function __resetTypescriptServerProbeCacheForTests(): void {
  probedPath = undefined;
}

/** Spawn typescript-language-server, run the LSP handshake, and
 *  return a ready LspClient. Throws with an install hint if the
 *  binary isn't on PATH. */
export async function spawnTypescriptLspClient(opts: {
  cwd?: string;
  requestTimeoutMs?: number;
}): Promise<LspClient> {
  const bin = typescriptLanguageServerBinary();
  if (!bin) {
    throw new Error(`Lsp: \`${BINARY_NAME}\` is not installed. ${INSTALL_HINT}`);
  }

  const cwd = opts.cwd ?? getSessionCwd();
  const client = spawnLspClient({
    command: bin,
    args: ['--stdio'],
    cwd,
    ...(opts.requestTimeoutMs ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
  });

  const initParams: LspInitializeParams = {
    processId: process.pid,
    rootUri: pathToFileURL(cwd).toString(),
    clientInfo: { name: 'monad-agent-lsp-client' },
    capabilities: {
      textDocument: {
        hover: { contentFormat: ['markdown', 'plaintext'] },
        synchronization: { didOpen: true, didClose: true },
        // L2 — declare the op-specific capabilities we now use. We
        // deliberately force `linkSupport: false` for definition so
        // the server returns legacy `Location[]` instead of the
        // newer `LocationLink[]` — simpler parser, same info for
        // our formatter's needs.
        definition: { linkSupport: false },
        references: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      } as Record<string, unknown>,
      workspace: {
        workspaceFolders: false,
        // workspace/symbol capability — server advertises support
        // via `workspaceSymbolProvider` in its initialize result.
        symbol: {},
      } as Record<string, unknown>,
    },
    workspaceFolders: null,
  };
  try {
    await client.request<LspInitializeResult>('initialize', initParams);
    client.notify('initialized', {});
    if (debug.enabled) {
      debug.log('lsp.typescript.handshake', 'complete', { cwd });
    }
    return client;
  } catch (err) {
    // Failed handshake → dispose the child so we don't leak it.
    await client.dispose().catch(() => undefined);
    throw err;
  }
}

/** Map a filePath to an LSP languageId. LSP spec uses lowercase
 *  VS Code language identifiers. L4 extends beyond tsserver to cover
 *  python (pyright) + rust (rust-analyzer). Unknown extensions fall
 *  back to `plaintext` and the server typically declines to answer —
 *  callers reach here via resolveLanguageForFile anyway so the mapping
 *  stays in sync with the server registry's extension lists. */
export function languageIdForFile(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':    return 'typescript';
    case '.tsx':   return 'typescriptreact';
    case '.js':    return 'javascript';
    case '.jsx':   return 'javascriptreact';
    case '.mjs':
    case '.cjs':   return 'javascript';
    case '.json':  return 'json';
    case '.py':    return 'python';
    case '.rs':    return 'rust';
    default:       return 'plaintext';
  }
}

/** Open a document with the server so positional queries can resolve.
 *  LSP requires textDocument/didOpen before any position-based
 *  request. Returns the resolved absolute path so the caller can use
 *  it in subsequent requests. */
export async function openDocument(
  client: LspClient,
  filePath: string,
  opts: { cwd?: string } = {},
): Promise<{ absolutePath: string; uri: string }> {
  const cwd = opts.cwd ?? getSessionCwd();
  const absolutePath = resolvePath(cwd, filePath);
  const uri = pathToFileURL(absolutePath).toString();
  let text: string;
  try {
    text = readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Lsp: cannot open '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const doc: LspTextDocumentItem = {
    uri,
    languageId: languageIdForFile(absolutePath),
    version: 1,
    text,
  };
  client.notify('textDocument/didOpen', { textDocument: doc });
  // A tiny delay to let the server index — tsserver otherwise returns
  // null hover on the very first request even when the doc would match.
  // 10ms is short enough not to add user-visible latency; integration
  // tests exercise this path with real servers.
  await new Promise(res => setTimeout(res, 10));
  return { absolutePath, uri };
}
