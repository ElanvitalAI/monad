// PLAN-codex-app-server-hermes-parity §5 Phase H3·2 test —
// renderMonadToolsEntry projector. The exact emitted shape matters
// because codex parses the toml and we want diff-friendly drift
// detection.

import { describe, test, expect } from 'bun:test';
import { renderMonadToolsEntry } from './monad-tools-entry.js';

describe('renderMonadToolsEntry · defaults', () => {
  test('emits default_permissions + monad-tools entry with defaults', () => {
    const out = renderMonadToolsEntry();
    expect(out).toContain('default_permissions = ":workspace"');
    expect(out).toContain('[mcp_servers.monad-tools]');
    expect(out).toContain('command = "monad"');
    expect(out).toContain('args = ["mcp", "serve"]');
    expect(out).toContain('env = {}');
    expect(out).toContain('startup_timeout_sec = 30.0');
    expect(out).toContain('tool_timeout_sec = 600.0');
  });

  test('default permission line comes BEFORE the table header', () => {
    const out = renderMonadToolsEntry();
    const permIdx = out.indexOf('default_permissions');
    const tableIdx = out.indexOf('[mcp_servers.monad-tools]');
    expect(permIdx).toBeGreaterThanOrEqual(0);
    expect(permIdx).toBeLessThan(tableIdx);
  });
});

describe('renderMonadToolsEntry · overrides', () => {
  test('honors custom command + args', () => {
    const out = renderMonadToolsEntry({
      command: '/usr/local/bin/monad',
      args: ['mcp', 'serve', '--verbose'],
    });
    expect(out).toContain('command = "/usr/local/bin/monad"');
    expect(out).toContain('args = ["mcp", "serve", "--verbose"]');
  });

  test('emits non-empty env as sorted inline table', () => {
    const out = renderMonadToolsEntry({
      env: {
        MONAD_DAEMON_SOCKET: '/tmp/monad.sock',
        MONAD_QUIET: '1',
        AAA_FIRST: 'x',
      },
    });
    // keys sorted alphabetically
    expect(out).toContain(
      'env = { AAA_FIRST = "x", MONAD_DAEMON_SOCKET = "/tmp/monad.sock", MONAD_QUIET = "1" }',
    );
  });

  test('honors numeric overrides', () => {
    const out = renderMonadToolsEntry({
      startupTimeoutSec: 5,
      toolTimeoutSec: 120,
    });
    expect(out).toContain('startup_timeout_sec = 5.0');
    expect(out).toContain('tool_timeout_sec = 120.0');
  });

  test('defaultPermissions: null skips the line entirely', () => {
    const out = renderMonadToolsEntry({ defaultPermissions: null });
    expect(out).not.toContain('default_permissions');
    expect(out.startsWith('[mcp_servers.monad-tools]')).toBe(true);
  });

  test('escapes embedded quotes + backslashes in command', () => {
    const out = renderMonadToolsEntry({ command: 'C:\\path\\to\\monad "exe"' });
    expect(out).toContain('command = "C:\\\\path\\\\to\\\\monad \\"exe\\""');
  });
});
