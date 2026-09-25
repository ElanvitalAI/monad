import { describe, expect, test } from 'bun:test';

import { createDashboardShellSlashRuntime } from '../src/dashboard/shell-slash-runtime.js';

describe('createDashboardShellSlashRuntime', () => {
  test('builds help and list lines', () => {
    const runtime = createDashboardShellSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      bold: (text) => `bold:${text}`,
      warning: (text) => `warning:${text}`,
      error: (text) => `error:${text}`,
    });

    const help = runtime.helpLines();
    expect(help[1]).toBe('accent:❯ 🐚 /shell');
    expect(help.some((line) => line.includes('/shell list [all]'))).toBe(true);
    expect(runtime.emptyListLine(false)).toBe(
      'muted:  (no live shell-runner handles — try /shell list all)',
    );
    expect(runtime.emptyListLine(true)).toBe(
      'muted:  (no shell-runner handles)',
    );
    expect(runtime.listHeaderLine(2, true)).toBe(
      'bold:  🐚 shell — 2 handles (incl. settled)',
    );
    expect(runtime.listEntryLine({
      idTail: '…abcd1234',
      chip: '[running]',
      mode: 'vw',
      label: 'runner',
    })).toBe('  [running]  …abcd1234  mode=vw label=runner');
    expect(runtime.killUsageLine()).toBe('warning:  /shell kill <id>  — handle id required');
    expect(runtime.attachUsageLine()).toBe('warning:  /shell attach <id>  — handle id required');
    expect(runtime.noHandleMatchesLine('abc')).toBe('warning:  no handle matches "abc"');
    expect(runtime.ambiguousHeaderLine('ab')).toBe('warning:  "ab" is ambiguous:');
    expect(runtime.ambiguousEntryLine({ id: 'handle-1' })).toBe('muted:    handle-1');
    expect(runtime.killedLine('handle-1')).toBe('muted:  killed handle-1');
    expect(runtime.killFailedLine('boom')).toBe('error:  kill failed: boom');
    expect(runtime.attachedLine(7, 'runner', 'vw')).toBe('muted:  attached — VW 7 (runner, mode=vw)');
    expect(runtime.bgAttachWarningLine('settled')).toBe(
      'warning:  bg-mode handle has no attachable surface (settled).',
    );
    expect(runtime.bgAttachHintLine()).toBe(
      'muted:  Output captured by file engine — re-run with RunShell(mode:"vw") for a live pane.',
    );
    expect(runtime.noWindowAttachWarningLine('missing')).toBe('warning:  missing');
    expect(runtime.noWindowAttachHintLine()).toBe(
      'muted:  Re-run the command to respawn the pane.',
    );
    expect(runtime.genericAttachWarningLine('bad')).toBe('warning:  bad');
    expect(runtime.unknownSubcommandLine('zzz')).toBe(
      'warning:  unknown subcommand "zzz" — try /shell help',
    );
  });
});
