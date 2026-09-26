// PLAN-codex-app-server-hermes-parity §5 Phase H3·2 test —
// renderElanousToolsEntry projector. The exact emitted shape matters
// because codex parses the toml and we want diff-friendly drift
// detection.

import { describe, test, expect } from 'bun:test';
import { renderElanousToolsEntry } from './elanous-tools-entry.js';

describe('renderElanousToolsEntry · defaults', () => {
  test('emits default_permissions + elanous-tools entry with defaults', () => {
    const out = renderElanousToolsEntry();
    expect(out).toContain('default_permissions = ":workspace"');
    expect(out).toContain('[mcp_servers.elanous-tools]');
    expect(out).toContain('command = "elanous"');
    expect(out).toContain('args = ["mcp", "serve"]');
    expect(out).toContain('env = {}');
    expect(out).toContain('startup_timeout_sec = 30.0');
    expect(out).toContain('tool_timeout_sec = 600.0');
  });

  test('default permission line comes BEFORE the table header', () => {
    const out = renderElanousToolsEntry();
    const permIdx = out.indexOf('default_permissions');
    const tableIdx = out.indexOf('[mcp_servers.elanous-tools]');
    expect(permIdx).toBeGreaterThanOrEqual(0);
    expect(permIdx).toBeLessThan(tableIdx);
  });
});

describe('renderElanousToolsEntry · overrides', () => {
  test('honors custom command + args', () => {
    const out = renderElanousToolsEntry({
      command: '/usr/local/bin/elanous',
      args: ['mcp', 'serve', '--verbose'],
    });
    expect(out).toContain('command = "/usr/local/bin/elanous"');
    expect(out).toContain('args = ["mcp", "serve", "--verbose"]');
  });

  test('emits non-empty env as sorted inline table', () => {
    const out = renderElanousToolsEntry({
      env: {
        ELANOUS_DAEMON_SOCKET: '/tmp/elanous.sock',
        ELANOUS_QUIET: '1',
        AAA_FIRST: 'x',
      },
    });
    // keys sorted alphabetically
    expect(out).toContain(
      'env = { AAA_FIRST = "x", ELANOUS_DAEMON_SOCKET = "/tmp/elanous.sock", ELANOUS_QUIET = "1" }',
    );
  });

  test('honors numeric overrides', () => {
    const out = renderElanousToolsEntry({
      startupTimeoutSec: 5,
      toolTimeoutSec: 120,
    });
    expect(out).toContain('startup_timeout_sec = 5.0');
    expect(out).toContain('tool_timeout_sec = 120.0');
  });

  test('defaultPermissions: null skips the line entirely', () => {
    const out = renderElanousToolsEntry({ defaultPermissions: null });
    expect(out).not.toContain('default_permissions');
    expect(out.startsWith('[mcp_servers.elanous-tools]')).toBe(true);
  });

  test('escapes embedded quotes + backslashes in command', () => {
    const out = renderElanousToolsEntry({ command: 'C:\\path\\to\\elanous "exe"' });
    expect(out).toContain('command = "C:\\\\path\\\\to\\\\elanous \\"exe\\""');
  });
});
