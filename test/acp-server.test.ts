import { describe, expect, test } from 'bun:test';
import {
  buildAcpSessionCodexArgs,
  extractText,
  formatRelayNotify,
  formatRelayBlock,
  parseRelayNotify,
  resolveAcpServerTurnPerformer,
  resolveAcpTerminalId,
  runAcpServer,
} from '../src/acp/server.js';
import { ACP_UNKNOWN_EXTERNAL_PERFORMER } from '../src/acp/client.js';
import { buildCodexAppServerArgs } from '../src/acp/codex-app-server-client.js';
import { createInProcessAcpBridge } from '../src/tui-client/acp-transport-local.js';

describe('ACP server terminal id issuer', () => {
  test('issues a term- id with the supplied base-36 timestamp when the client omits the id', () => {
    expect(resolveAcpTerminalId(undefined, 1_234_567_890)).toBe('term-kf12oi');
  });

  test('preserves a supplied non-empty terminal id without replacing it', () => {
    expect(resolveAcpTerminalId('chosen-by-client', 1_234_567_890)).toBe('chosen-by-client');
  });

  test('issues distinct ids for distinct timestamps', () => {
    expect(resolveAcpTerminalId(undefined, 100)).not.toBe(resolveAcpTerminalId(undefined, 101));
  });
});

describe('ACP server turn performer resolver', () => {
  test('identifies monad itself distinctly from unknown and external performers', () => {
    const external = 'literal-external-agent';
    const self = resolveAcpServerTurnPerformer();

    expect(self).not.toBe(ACP_UNKNOWN_EXTERNAL_PERFORMER);
    expect(self).not.toBe(external);
    expect(new Set([external, ACP_UNKNOWN_EXTERNAL_PERFORMER, self]).size).toBe(3);
  });
});

describe('ACP session/new Codex argv', () => {
  test('forwards one stdio MCP server to the common spawn argv builder as a literal session-scoped config', () => {
    const sessionArgs = buildAcpSessionCodexArgs([
      { name: 'repo-tools', command: 'npx', args: ['-y', '@example/repo-tools'] },
    ]);

    expect(sessionArgs).toEqual([
      '-c',
      'mcp_servers={"repo-tools":{"command":"npx","args":["-y","@example/repo-tools"]}}',
    ]);
    expect(buildCodexAppServerArgs(sessionArgs)).toEqual([
      'app-server',
      '-c',
      'mcp_servers={"repo-tools":{"command":"npx","args":["-y","@example/repo-tools"]}}',
      '-c',
      'features.code_mode_host=false',
    ]);
  });

  test('keeps empty and HTTP-only sessions isolated from stdio MCP configuration', () => {
    expect(buildAcpSessionCodexArgs([])).toEqual([]);
    expect(buildAcpSessionCodexArgs([
      { name: 'remote-only', type: 'http', url: 'https://example.test/mcp' },
    ])).toEqual([]);
    expect(buildCodexAppServerArgs([])).toEqual([
      'app-server',
      '-c',
      'features.code_mode_host=false',
    ]);
  });
});

describe('MT5 — acp-server extractText', () => {
  test('joins text blocks with newline', () => {
    const s = extractText([
      { type: 'text', text: 'hello' } as any,
      { type: 'text', text: 'world' } as any,
    ]);
    expect(s).toBe('hello\nworld');
  });

  test('substitutes placeholder for non-text blocks', () => {
    const s = extractText([
      { type: 'text', text: 'read:' } as any,
      { type: 'resource_link', uri: 'file:///x.md' } as any,
    ]);
    expect(s).toBe('read:\n[resource_link]');
  });

  test('empty prompt → empty string', () => {
    expect(extractText([])).toBe('');
  });
});

describe('RC — acp-server relay wire format', () => {
  test('formatRelayNotify serialises kind/title/body/meta', () => {
    const wire = formatRelayNotify({
      kind: 'status',
      title: 'working',
      body: 'message_start',
      meta: { event: 'message_start' },
    });
    expect(wire.startsWith('[notify:status] working')).toBe(true);
    expect(wire).toContain('\nmessage_start');
    expect(wire).toContain('<<meta {"event":"message_start"}>>');
  });

  test('formatRelayNotify omits body/meta when absent', () => {
    const wire = formatRelayNotify({ kind: 'exit', title: 'killed' });
    expect(wire).toBe('[notify:exit] killed');
  });

  test('formatRelayBlock caps preview at 160 chars with ellipsis', () => {
    const long = 'x'.repeat(400);
    const wire = formatRelayBlock({ id: 'blk:1', kind: 'claude-code', text: long });
    expect(wire.startsWith('[notify:block] blk:1 (claude-code)')).toBe(true);
    const preview = wire.split('\n')[1]!;
    expect(preview.length).toBeLessThanOrEqual(160);
    expect(preview.endsWith('...')).toBe(true);
  });

  test('parseRelayNotify inverts formatRelayNotify', () => {
    const evt = { kind: 'block', title: 'blk:1', body: 'Hello!', meta: { blockId: 'blk:1' } };
    const wire = formatRelayNotify(evt);
    const parsed = parseRelayNotify(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('block');
    expect(parsed!.title).toBe('blk:1');
    expect(parsed!.body).toBe('Hello!');
    expect(parsed!.meta).toEqual({ blockId: 'blk:1' });
  });

  test('parseRelayNotify returns null when prompt is not a relay', () => {
    expect(parseRelayNotify('just a regular user message')).toBeNull();
    expect(parseRelayNotify('[notify] no-kind')).toBeNull();
    expect(parseRelayNotify('')).toBeNull();
  });

  test('parseRelayNotify handles empty body gracefully', () => {
    const parsed = parseRelayNotify('[notify:exit] killed');
    expect(parsed!.kind).toBe('exit');
    expect(parsed!.title).toBe('killed');
    expect(parsed!.body).toBeUndefined();
  });
});
