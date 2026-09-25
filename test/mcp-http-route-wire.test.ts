// ── Source-grep guard for the POST /v1/mcp route wire ──
//
// Memory `feedback_post_route_must_be_in_method_block` — POST routes
// that escape the `if (method !== 'GET')` block silently fall through
// to the catch-all 405. Unit tests on `handleMcpHttpPost` can't catch
// this regression because they invoke the handler directly. This
// file pins the route registration so a future refactor that
// "tidies up" the dispatcher doesn't unmount the endpoint.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf-8');
}

describe('NEXUS http-server.ts — POST /v1/mcp route registration', () => {
  const src = readSource('src/nexus/api/http-server.ts');

  test('imports handleMcpHttpPost from ./mcp-http.js', () => {
    expect(src).toMatch(/handleMcpHttpPost.*from\s+['"]\.\/mcp-http(\.js)?['"]/);
  });

  test('route check `pathname === "/v1/mcp"` exists', () => {
    expect(src).toMatch(/pathname\s*===\s*['"]\/v1\/mcp['"]/);
  });

  test('route is registered inside the `method !== "GET"` block', () => {
    // Find the index of the `if (method !== 'GET')` block and the
    // index of our route. The route's index must be greater (i.e.
    // inside the block) — a regression that places it earlier
    // would let `method === 'GET'` reach this branch + fall back
    // to the catch-all 405 on the POST request.
    const blockIndex = src.search(/if\s*\(\s*method\s*!==\s*['"]GET['"]\s*\)/);
    const routeIndex = src.search(/pathname\s*===\s*['"]\/v1\/mcp['"]/);
    expect(blockIndex).toBeGreaterThan(-1);
    expect(routeIndex).toBeGreaterThan(blockIndex);
  });

  test('route passes Bun direct peer metadata and its binding to handleMcpHttpPost', () => {
    expect(src).toMatch(/requestIP\?:\s*\(request:\s*Request\)\s*=>\s*\{\s*address:\s*string\s*\}/);
    expect(src).toMatch(/\)\.requestIP\?\.\(req\)/);
    expect(src).toMatch(/return\s+handleMcpHttpPost\s*\(\s*req\s*,\s*\{/);
    expect(src).toMatch(/peerAddress:\s*peer\.address/);
    expect(src).toMatch(/binding:\s*bind/);
  });
});

describe('mcp-http.ts surface', () => {
  const src = readSource('src/nexus/api/mcp-http.ts');

  test('exports handleMcpHttpPost', () => {
    expect(src).toMatch(/export\s+async\s+function\s+handleMcpHttpPost/);
  });

  test('delegates to handleMcpRequest from src/mcp/server.ts', () => {
    expect(src).toMatch(/['"]\.\.\/\.\.\/mcp\/server(\.js)?['"]/);
    expect(src).toContain('handleMcpRequest');
  });

  test('notifications (no id) return 202 status', () => {
    expect(src).toMatch(/status:\s*202/);
  });

  test('surface is set to "mcp" so listToolRuntimes filters consistently with stdio', () => {
    expect(src).toMatch(/surface:\s*['"]mcp['"]/);
  });
});
