// ── elanous mcp serve CLI wire — source-level + smoke guard ──
//
// Phase 3 closure piece (S-5 Relay · RFC §5.5). Guarantees the CLI
// path exists so `claude mcp add --transport stdio elanous -- elanous
// mcp serve` is operable. The actual MCP protocol behavior is
// covered by `mcp-client.test.ts` (Phase 1) and the registry
// integration is covered by `tool-runtime-mcp-relay.test.ts`
// (Phase 3) — this file only certifies that the binary surfaces
// the command and wires it to the right helpers.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(import.meta.dir, '..');
const SRC_INDEX = join(REPO_ROOT, 'src', 'index.ts');

function readIndex(): string {
  return readFileSync(SRC_INDEX, 'utf-8');
}

describe('src/index.ts — mcp serve subcommand wiring', () => {
  const src = readIndex();

  test("registers `program.command('mcp')` parent", () => {
    expect(src).toMatch(/program\s*\.\s*command\(['"]mcp['"]\)/);
  });

  test("registers `mcpCmd.command('serve')` child", () => {
    expect(src).toMatch(/\.command\(['"]serve['"]\)/);
  });

  test('serve action imports startMcpStdioServer (dynamic or static)', () => {
    // Match both `import { X } from './...'` and `await import('./...')`.
    expect(src).toMatch(/['"]\.\/mcp\/server(\.js)?['"]/);
    expect(src).toContain('startMcpStdioServer');
  });

  test('serve action imports registerMcpClients (Phase 2 boot helper reuse)', () => {
    expect(src).toMatch(/['"]\.\/nexus\/boot\/register-mcp-clients(\.js)?['"]/);
    expect(src).toContain('registerMcpClients');
  });

  test('serve action reads user-config mcp.servers (sparse)', () => {
    expect(src).toMatch(/cfg\.mcp\?\.servers\s*\?\?\s*\[\]/);
  });

  test('serve action wires SIGINT + SIGTERM shutdown', () => {
    expect(src).toMatch(/process\.on\(['"]SIGINT['"]/);
    expect(src).toMatch(/process\.on\(['"]SIGTERM['"]/);
  });

  test('shutdown disposes both stdio and the McpClients handle', () => {
    // Match both `stdio.stop()` and `handle.shutdown()` somewhere in
    // the file — the order is enforced by code review, not by grep.
    expect(src).toMatch(/stdio\.stop\(\)/);
    expect(src).toMatch(/handle\.shutdown\(\)/);
  });

  test('logger writes to stderr (so stdout stays clean for JSON-RPC)', () => {
    // The serve action must NOT log to stdout — stdout is the
    // JSON-RPC channel for the MCP client. Use stderr instead.
    expect(src).toMatch(/process\.stderr\.write/);
  });
});

describe('mcp serve binary smoke', () => {
  test('`elanous mcp --help` lists `serve` subcommand', () => {
    // Run the bin via bun + src/index.ts directly to avoid relying
    // on `which elanous` from the test environment.
    const result = spawnSync(
      'bun',
      ['run', SRC_INDEX, 'mcp', '--help'],
      {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
    // Commander prints help to stdout (or stderr depending on
    // version) — check both to be robust.
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(combined).toContain('serve');
  }, 20000);
});
