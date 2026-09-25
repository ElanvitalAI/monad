import { describe, expect, test } from 'bun:test';
import { SLASH_COMMANDS, filterSlashCommands } from '../src/chat/index.js';

describe('dashboard workspace (formerly /window) slash registry', () => {
  test('SLASH_COMMANDS registers /workspace with IUL, ACP, and simulator subcommands', () => {
    // Q2 (substrate Occam, 2026-05-03) — `/window` renamed to
    // `/workspace`; `/window` `/win` `/ws` preserved as aliases.
    const cmd = SLASH_COMMANDS.find((c) => c.name === 'workspace');
    expect(cmd).toBeDefined();
    expect(cmd?.aliases).toContain('window');
    expect(cmd?.aliases).toContain('win');
    expect(cmd?.aliases).toContain('ws');
    expect(cmd?.subcommands).toEqual(expect.arrayContaining([
      'iul',
      'acp',
      'sim',
      'browser-preview',
      'companion',
    ]));
  });

  test('filterSlashCommands surfaces /workspace for typed prefix and aliases', () => {
    const byName = filterSlashCommands('workspace', SLASH_COMMANDS).map((c) => c.name);
    const byWindow = filterSlashCommands('window', SLASH_COMMANDS).map((c) => c.name);
    const byWin = filterSlashCommands('win', SLASH_COMMANDS).map((c) => c.name);
    const byWs = filterSlashCommands('ws', SLASH_COMMANDS).map((c) => c.name);
    expect(byName[0]).toBe('workspace');
    expect(byWindow[0]).toBe('workspace');
    expect(byWin[0]).toBe('workspace');
    expect(byWs[0]).toBe('workspace');
  });

  test('SLASH_COMMANDS registers /sim with direct run subcommands', () => {
    const cmd = SLASH_COMMANDS.find((c) => c.name === 'sim');
    expect(cmd).toBeDefined();
    expect(cmd?.aliases).toContain('simulator');
    expect(cmd?.subcommands).toEqual(expect.arrayContaining([
      'open',
      'list',
      'run',
    ]));
  });
});
