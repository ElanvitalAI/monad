import { describe, expect, test } from 'bun:test';
import { resolveSpawnShape, startPty, unregisterPty } from './registry.js';
import { bunSpawnPty } from './bun-native-pty.js';

// ⭐ 2026-07-29 — these lock the contract that a live exit-code hunt cost two
// tracks several hours to find. `startPty` used to re-join tokenized args into
// a shell line, so `{cmd:'bash', args:['-c','exit 7']}` reached the child as
// `bash -c exit 7` — an argument-less `exit`, which returns the PREVIOUS
// command's status (0). The child then truthfully reported 0 for a command we
// never asked it to run, and `reachedCompletion` read that 0 as success.

describe('resolveSpawnShape — one contract, two shapes', () => {
  test('tokens spawn directly and are never re-joined', () => {
    const shape = resolveSpawnShape({ cmd: 'bash', args: ['-c', 'exit 7'] } as never);
    expect(shape.file).toBe('bash');
    expect(shape.args).toEqual(['-c', 'exit 7']);
  });

  test('a token keeps spaces, quotes and newlines verbatim (goal-prompt case)', () => {
    // This is the shape self-implement children use: one argv entry holding a
    // whole multi-line prompt. It must NOT be split, quoted, or escaped.
    const prompt = "line one\nline 'two' with \"quotes\"  and  spaces";
    const shape = resolveSpawnShape({ cmd: 'bun', args: ['chat', '--new', prompt] } as never);
    expect(shape.file).toBe('bun');
    expect(shape.args[2]).toBe(prompt);
  });

  test('tokens win even when cmd itself looks shell-ish', () => {
    // The invariant is "args present ⇒ direct spawn". A prior revision wrote
    // `hasArgs ? !cmdHasShellSyntax : !cmdHasShellSyntax`, where both branches
    // were identical, so this case silently fell back to the shell.
    const shape = resolveSpawnShape({ cmd: './my program', args: ['--flag', 'a b'] } as never);
    expect(shape.file).toBe('./my program');
    expect(shape.args).toEqual(['--flag', 'a b']);
  });

  test('a bare, plain cmd spawns directly — no shell (case ③)', () => {
    // ⚠️ This is PRE-EXISTING behavior, locked here because a 4R review read
    // the contract comment as promising the opposite. Verified against the
    // pre-fix expression too: `!shellSyntax(cmd) && !args` was already true
    // for `ls`/`cd`, so this fix changed nothing for bare commands — only the
    // two tokenized cases moved (and those were the bug).
    const shape = resolveSpawnShape({ cmd: 'ls' } as never);
    expect(shape.file).toBe('ls');
    expect(shape.args).toEqual([]);
    // ⇒ therefore a shell BUILTIN passed as a bare cmd has no shell to run in.
    //   Documented, not fixed here: changing it is a separate decision.
    expect(resolveSpawnShape({ cmd: 'cd' } as never).file).toBe('cd');
  });

  test('a bare cmd with shell syntax still goes through the shell', () => {
    const shape = resolveSpawnShape({ cmd: 'echo hi | wc -l' } as never);
    expect(shape.args[0]).toBe('-c');
    expect(shape.args[1]).toBe('echo hi | wc -l');
    expect(shape.file).not.toBe('echo hi | wc -l');
  });
});

describe('startPty — the child’s own status reaches the caller', () => {
  const runToExit = async (opts: Record<string, unknown>): Promise<{ code: number | null; signal: number | undefined }> => {
    const h = startPty({ accessMode: 'auto', transitionPolicy: 'open', cols: 80, rows: 24, ...opts } as never);
    for (let i = 0; i < 40 && h.isAlive(); i++) await new Promise((r) => setTimeout(r, 50));
    const out = { code: h.exitCode, signal: h.exitSignal };
    try { unregisterPty(h.id); } catch { /* already gone */ }
    return out;
  };

  test('a tokenized `exit 7` exits 7 — not 0', async () => {
    expect((await runToExit({ cmd: 'bash', args: ['-c', 'exit 7'] })).code).toBe(7);
  });

  test('a signal death is 128+signal with the signal recorded', async () => {
    const r = await runToExit({ cmd: 'bash', args: ['-c', 'kill -9 $$'] });
    // ⛔ Reporting 0 or 1 here would make "killed" indistinguishable from
    // "finished" / "failed" — the distinction the harness autopsy needs.
    expect(r.code).toBe(137);
    expect(r.signal).toBe(9);
  });

  test('a shell line keeps its own quoting', async () => {
    expect((await runToExit({ cmd: "bash -c 'exit 7'" })).code).toBe(7);
  });

  test('an argument containing spaces is one argument', async () => {
    // ⚠️ This asserts the ARGV boundary, so the space must sit in an argument
    // the child compares — not merely inside the `-c` script text. `$1` is
    // only bound when the token survived as its own argv entry, and `bash -c
    // <script> <argv0> <$1>` needs the argv0 slot filled first (review 2R).
    const r = await runToExit({ cmd: 'bash', args: ['-c', 'test "$1" = "a b"; exit $?', 'argv0', 'a b'] });
    expect(r.code).toBe(0);
  });

  // ── 2R must-fix — 종료 보고가 거짓말을 하지 않는다 ──
  test('an unmapped signal is not laundered into 0', async () => {
    // ⛔ The signal map used to be a hand-written five-entry list, so a child
    // killed by SIGSEGV produced `signal: undefined` and then `exitCode: 0` —
    // "segfaulted" read as "finished cleanly". The map now comes from the
    // platform, so every signal the OS knows is reportable.
    const r = await runToExit({ cmd: 'bash', args: ['-c', 'kill -SEGV $$'] });
    expect(r.signal).toBe(11);
    expect(r.code).toBe(139); // 128 + 11
    expect(r.code).not.toBe(0);
  });

  test('a listener registered AFTER the exit gets the same code AND signal', async () => {
    // ⛔ The late-subscriber replay used to drop `signal` (and default the
    // code to 0), so `{exitCode:137, signal:9}` degraded to `{exitCode:137}`
    // purely by when you happened to call onExit. Observation must not depend
    // on subscription timing. Asserted on the adapter, which owns the replay.
    const p = bunSpawnPty('bash', ['-c', 'kill -9 $$'], { cols: 80, rows: 24 });
    const early: Array<{ exitCode: number | null; signal?: number }> = [];
    p.onExit((e) => { early.push(e); });
    for (let i = 0; i < 40 && early.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    const late: Array<{ exitCode: number | null; signal?: number }> = [];
    p.onExit((e) => { late.push(e); });
    expect(early).toEqual([{ exitCode: 137, signal: 9 }]);
    expect(late).toEqual(early); // ⭐ the whole point: same pair, either timing
  });
});
