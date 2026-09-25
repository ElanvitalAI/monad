// $EDITOR shell-out launcher — T4-D1.
//
// Suspends the Monad TUI, spawns the user's editor inheriting
// stdin/stdout/stderr, waits for the editor to exit, then re-enters
// the TUI. Mirrors yazi's `AppProxy::stop() → shell.wait() →
// resume()` pattern (yazi-scheduler/src/process/process.rs:22).
//
// Why not reinvent an editor:
//   • A real editor (nvim/vim/helix/etc.) already has decades of
//     polish around visual mode, search, registers, LSP, plugins.
//   • The user's vimrc / init.lua applies automatically.
//   • Zero parser-dialect drift — whatever ships with the system
//     is what the user gets.
//
// When a real editor isn't usable:
//   • `$EDITOR` (and `$VISUAL`) unset
//   • stdin is not a TTY (headless test / CI path)
//   • caller explicitly requested the pane-embedded path
// In those cases the caller should fall back to the mini-vi editor
// from T3-C1 (kept around precisely for these scenarios).
//
// Contract:
//
//   launchEditor(path, deps) → Promise<LaunchResult>
//
// LaunchResult tells the caller whether the editor was even
// launched, so it can decide whether to trigger the fallback.

import { spawn } from 'node:child_process';
import { closeTui, initTui } from './tui.js';
import { getSessionCwd } from './session/working-dir.js';

export type LaunchResult =
  | { ok: true; exitCode: number }
  | { ok: false; reason: 'no-editor' | 'no-tty' | 'spawn-failed'; message: string };

export interface LaunchEditorDeps {
  /** Explicit command override (tests). Format: `['vim', '+start']`. */
  command?: readonly string[];
  /** Env override (tests). Falls back to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Alternate suspend/resume pair — tests pass no-ops. */
  suspend?: () => void;
  resume?: () => void;
  /** When true, skip the TTY check (tests). */
  allowNonTty?: boolean;
  /** Spawn override (tests). */
  spawnImpl?: typeof spawn;
}

export interface LaunchEditorOpts {
  /** Extra args after the path (e.g. +42 to jump to a line). */
  extraArgs?: readonly string[];
  /** Working directory for the child. Defaults to getSessionCwd() (WD7). */
  cwd?: string;
}

/** Pick the editor binary + args. Honors $VISUAL > $EDITOR > vi
 *  fallback. The env value may contain flags (e.g. `code -w` or
 *  `nvim --cmd "set nowrap"`) — we split on whitespace which is
 *  good enough for 99% of user configs. */
export function resolveEditorCommand(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = (env['VISUAL'] ?? env['EDITOR'] ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

export async function launchEditor(
  path: string,
  opts: LaunchEditorOpts = {},
  deps: LaunchEditorDeps = {},
): Promise<LaunchResult> {
  if (!deps.allowNonTty && !process.stdin.isTTY) {
    return {
      ok: false,
      reason: 'no-tty',
      message: 'stdin is not a TTY — the editor cannot interact with the user.',
    };
  }

  const cmd = deps.command ?? resolveEditorCommand(deps.env);
  if (!cmd || cmd.length === 0) {
    return {
      ok: false,
      reason: 'no-editor',
      message: '$EDITOR / $VISUAL are unset. Set one or use the mini-vi fallback (MONAD_USE_MINI_VI=1).',
    };
  }

  const suspend = deps.suspend ?? closeTui;
  const resume = deps.resume ?? (() => initTui(true));
  const spawner = deps.spawnImpl ?? spawn;

  suspend();

  try {
    const args = [...cmd.slice(1), ...(opts.extraArgs ?? []), path];
    const exitCode: number = await new Promise((resolve) => {
      const child = spawner(cmd[0]!, args, {
        stdio: 'inherit',
        cwd: opts.cwd ?? getSessionCwd(),
        env: deps.env ?? process.env,
      });
      child.on('error', (err) => {
        // Surface + resolve so the caller sees the failure. We don't
        // reject because the caller wants a LaunchResult either way.
        process.stderr.write(`\n[editor-launcher] spawn error: ${err.message}\n`);
        resolve(-1);
      });
      child.on('exit', (code, signal) => {
        if (signal) {
          process.stderr.write(`\n[editor-launcher] killed by ${signal}\n`);
          resolve(128);
          return;
        }
        resolve(code ?? 0);
      });
    });

    if (exitCode < 0) {
      return {
        ok: false,
        reason: 'spawn-failed',
        message: `editor process failed (code ${exitCode})`,
      };
    }
    return { ok: true, exitCode };
  } catch (err) {
    return {
      ok: false,
      reason: 'spawn-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    resume();
  }
}

/** Helper: tells the caller whether launchEditor() has a chance
 *  of success without actually invoking it. Useful for the
 *  "should we fall back to mini-vi?" branch. */
export function canLaunchEditor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!process.stdin.isTTY) return false;
  return resolveEditorCommand(env) !== null;
}
