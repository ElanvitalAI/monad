// MVP M1.5 A.2 — daemon runtime tool surface integration tests.
//
// Verify createDaemonRuntime wires the right tool surface based on
// `tools` opt + `ELANOUS_TOOLS` env. Goes through the public surface
// (createDaemonRuntime, toolSurface) rather than internals so the
// behavior is stable across A.3 implementation changes.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDaemonRuntime, type DaemonRuntimeOpts } from '../src/boot/daemon-runtime.js';

// ⛔ #14191 이 심은 가드 — 도구 표면이 PtyShell 을 노출하면 중단 시 비-detached PTY 를
//    걷을 함수를 «반드시» 받아야 한다(안 주면 던진다). 이 시험은 「도구 표면 선택」만 재므로
//    정리 동작 자체는 no-op 스텁으로 채우고, 가드가 요구하는 계약은 그대로 지킨다.
//    📏 2026-08-30: 이 줄이 없어서 여섯 칸이 빨갰다(기준선 29 pass / 0 fail).
const runtimeOpts = (opts: DaemonRuntimeOpts = {}): DaemonRuntimeOpts =>
  ({ killNonDetachedPty: () => { /* no-op — 이 시험은 PTY 정리를 재지 않는다 */ }, ...opts });
import { toolSurface } from '../src/boot/daemon-tools/index.js';
import { PTY_SHELL_TOOL_NAMES } from '../src/boot/daemon-tools/pty-shell.js';
import { ToolSafetyError } from '../src/boot/daemon-tools/types.js';
import { WEB_TERMINAL_TOOL_NAMES } from '../src/boot/daemon-tools/web-terminal.js';
import { ptyAvailable } from '../src/pty-shell/registry.js';

/** Interactive families that require `--tools webterm` opt-in. Existing
 *  constants — do not hand-write a parallel list. */
const INTERACTIVE_FAMILY_NAMES: readonly string[] = [
  ...WEB_TERMINAL_TOOL_NAMES,
  ...PTY_SHELL_TOOL_NAMES,
];

/** Names from the WebTerminal / PtyShell families that leaked onto chat. */
function interactiveFamilyLeaksOnChat(names: readonly string[]): string[] {
  return names.filter((n) => INTERACTIVE_FAMILY_NAMES.includes(n));
}

/** Required webterm names that are missing. PtyShell is required only when
 *  the PTY backend is actually available — same gate as
 *  `tool-surface-names.test.ts`. Chat-family absence is unconditional. */
function missingWebtermBoundaryNames(
  names: readonly string[],
  chatNames: readonly string[],
): string[] {
  const required: readonly string[] = [
    ...chatNames,
    ...WEB_TERMINAL_TOOL_NAMES,
    ...(ptyAvailable() ? PTY_SHELL_TOOL_NAMES : []),
  ];
  return required.filter((n) => !names.includes(n));
}

describe('toolSurface(kind)', () => {
  test("'none' returns empty specs and dispatch throws", async () => {
    const s = toolSurface('none');
    expect(s.specs).toEqual([]);
    await expect(
      s.dispatch('Read', { path: 'x' }, { cwd: '.', signal: new AbortController().signal }),
    ).rejects.toThrow(ToolSafetyError);
  });

  test("'readonly' exposes Read · Grep · WebSearch · Plan · MarkStepDone specs", () => {
    const s = toolSurface('readonly');
    const names = s.specs.map((t) => t.name);
    expect(names).toEqual(['Read', 'Grep', 'WebSearch', 'Plan', 'MarkStepDone']);
  });

  test("'readonly' rejects unknown tool name", async () => {
    const s = toolSurface('readonly');
    await expect(
      s.dispatch('Edit', {}, { cwd: '.', signal: new AbortController().signal }),
    ).rejects.toThrow(ToolSafetyError);
  });

  // 2026-05-13 · chat-only friction-free — new 'chat' surface kind.
  // Boundary, not a whole-array golden: legitimate growth (shared-app
  // tools, browser-read, …) must not fail this test. A leak of the
  // WebTerminal / PtyShell families — which require `--tools webterm`
  // opt-in — must fail it. Family names come from the existing
  // constants; do not hand-write a parallel list.
  test("'chat' exposes readonly + Edit + Bash, no WebTerminal* tools", () => {
    const s = toolSurface('chat');
    const names = s.specs.map((t) => t.name);
    expect(names).toContain('Edit');
    expect(names).toContain('Bash');
    expect(interactiveFamilyLeaksOnChat(names)).toEqual([]);
  });

  test("'chat' rejects WebTerminal* tools (must opt into 'webterm')", async () => {
    const s = toolSurface('chat');
    await expect(
      s.dispatch('WebTerminalList', {}, { cwd: '.', signal: new AbortController().signal }),
    ).rejects.toThrow(ToolSafetyError);
  });

  test("'chat' Bash dispatches against ctx.cwd", async () => {
    const s = toolSurface('chat');
    const result = await s.dispatch(
      'Bash',
      { command: '' },
      { cwd: '/tmp', signal: new AbortController().signal },
    ) as { output: string };
    expect(result.output).toContain('(no command supplied)');
  });

  test("'webterm' is a superset of chat + WT-L-1 triple + WT-C-2 screenshot", () => {
    const chatNames = toolSurface('chat').specs.map((t) => t.name);
    const names = toolSurface('webterm').specs.map((t) => t.name);
    expect(missingWebtermBoundaryNames(names, chatNames)).toEqual([]);
  });

  // Boundary helpers must distinguish "grew a harmless tool" from "leaked
  // an opt-in family". Whole-array goldens collapsed those into one fail.
  test("chat boundary fails on a PtyShell family leak, not on harmless growth", () => {
    const chatNames = toolSurface('chat').specs.map((t) => t.name);
    expect(interactiveFamilyLeaksOnChat([...chatNames, PTY_SHELL_TOOL_NAMES[0]])).toEqual([
      PTY_SHELL_TOOL_NAMES[0],
    ]);
    expect(interactiveFamilyLeaksOnChat([...chatNames, WEB_TERMINAL_TOOL_NAMES[0]])).toEqual([
      WEB_TERMINAL_TOOL_NAMES[0],
    ]);
    expect(interactiveFamilyLeaksOnChat([...chatNames, 'HarmlessProbe'])).toEqual([]);
  });

  test("webterm boundary fails when a required interactive family is stripped", () => {
    const chatNames = toolSurface('chat').specs.map((t) => t.name);
    const names = toolSurface('webterm').specs.map((t) => t.name);
    const withoutWebTerminal = names.filter(
      (n) => !(WEB_TERMINAL_TOOL_NAMES as readonly string[]).includes(n),
    );
    expect(missingWebtermBoundaryNames(withoutWebTerminal, chatNames)).toEqual([
      ...WEB_TERMINAL_TOOL_NAMES,
    ]);
    const withoutPtyShell = names.filter(
      (n) => !(PTY_SHELL_TOOL_NAMES as readonly string[]).includes(n),
    );
    if (ptyAvailable()) {
      expect(missingWebtermBoundaryNames(withoutPtyShell, chatNames)).toEqual([
        ...PTY_SHELL_TOOL_NAMES,
      ]);
    } else {
      expect(missingWebtermBoundaryNames(withoutPtyShell, chatNames)).toEqual([]);
    }
  });

  test("'webterm' rejects unknown tool name", async () => {
    const s = toolSurface('webterm');
    await expect(
      s.dispatch('NotARealTool', {}, { cwd: '.', signal: new AbortController().signal }),
    ).rejects.toThrow(ToolSafetyError);
  });

  test("'webterm' Bash dispatches against ctx.cwd (chat-friction-free PR-2)", async () => {
    const s = toolSurface('webterm');
    // Empty command short-circuits in dispatchBash without spawning.
    const result = await s.dispatch(
      'Bash',
      { command: '' },
      { cwd: '/tmp', signal: new AbortController().signal },
    ) as { output: string; exitCode: number | null };
    expect(typeof result.output).toBe('string');
    expect(result.output).toContain('(no command supplied)');
  });

  test("'webterm' WebTerminalList rejects when neither args nor ctx supply sessionId", async () => {
    const s = toolSurface('webterm');
    await expect(
      s.dispatch('WebTerminalList', {}, { cwd: '.', signal: new AbortController().signal }),
    ).rejects.toThrow(/sessionId required/);
  });

  test("'webterm' WebTerminalList auto-injects ctx.sessionId when args.sessionId missing", async () => {
    const s = toolSurface('webterm');
    const result = await s.dispatch(
      'WebTerminalList',
      {},
      { cwd: '.', signal: new AbortController().signal, sessionId: 'sess-from-ctx' },
    );
    expect(result).toEqual({ sessionId: 'sess-from-ctx', terminals: [] });
  });

  test("'webterm' WebTerminalList: explicit args.sessionId overrides ctx.sessionId", async () => {
    const s = toolSurface('webterm');
    const result = await s.dispatch(
      'WebTerminalList',
      { sessionId: 'sess-explicit' },
      { cwd: '.', signal: new AbortController().signal, sessionId: 'sess-from-ctx' },
    );
    expect(result).toEqual({ sessionId: 'sess-explicit', terminals: [] });
  });

  test("'webterm' WebTerminalList returns empty array for unknown session", async () => {
    const s = toolSurface('webterm');
    const result = await s.dispatch(
      'WebTerminalList',
      { sessionId: 'no-such-session' },
      { cwd: '.', signal: new AbortController().signal },
    );
    expect(result).toEqual({ sessionId: 'no-such-session', terminals: [] });
  });
});

describe('createDaemonRuntime — tools opt', () => {
  let cleanupConfigDir: (() => void) | undefined;
  let toolCwd: string;

  beforeEach(() => {
    toolCwd = mkdtempSync(join(tmpdir(), 'elanous-tools-runtime-'));
  });

  afterEach(() => {
    delete process.env.ELANOUS_TOOL_CWD;
    cleanupConfigDir?.();
    cleanupConfigDir = undefined;
    rmSync(toolCwd, { recursive: true, force: true });
  });

  /** Helper — point `~/.elanous/config.json` (via setElanousConfigDir) at a
   *  scratch tmp dir for tests that exercise the persisted
   *  `global.tools` resolution. The user-config reader is lazy-required
   *  inside createDaemonRuntime so we can swap the root per-test
   *  without touching the user's real config. */
  function withUserConfig(globalCfg: { tools?: string }): void {
    const { mkdtempSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    const { tmpdir } = require('node:os') as typeof import('node:os');
    const { join } = require('node:path') as typeof import('node:path');
    const {
      setElanousConfigDir,
      resetElanousConfigDir,
    } = require('../src/elanous-config-dir') as typeof import('../src/elanous-config-dir');
    const dir = mkdtempSync(join(tmpdir(), 'elanous-tools-cfg-'));
    setElanousConfigDir(dir);
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, global: globalCfg, tabs: {} }, null, 2),
    );
    cleanupConfigDir = () => resetElanousConfigDir();
  }

  test("default = 'webterm' (2026-05-13 align fallback with commander description)", () => {
    // Pre-2026-05-13 fallback was 'none' but the CLI option said
    // 'Default = webterm' — the mismatch silenced every tool when
    // users didn't pass `--tools`. New fallback honours the
    // commander promise so the PWA's sticky webterm workflow
    // (chat reads WebTerminalSnapshot of an open PTY) keeps
    // working out of the box.
    const runtime = createDaemonRuntime(runtimeOpts({ toolCwd }));
    expect(runtime.tools).toBe('webterm');
    expect(runtime.toolCwd).toBe(toolCwd);
  });

  test("explicit tools='none' still produces an empty surface", () => {
    const runtime = createDaemonRuntime(runtimeOpts({ tools: 'none', toolCwd }));
    expect(runtime.tools).toBe('none');
    expect(runtime.toolCwd).toBeUndefined();
  });

  test("explicit tools='readonly' wires the surface", () => {
    const runtime = createDaemonRuntime(runtimeOpts({ tools: 'readonly', toolCwd }));
    expect(runtime.tools).toBe('readonly');
    expect(runtime.toolCwd).toBe(toolCwd);
  });

  test("explicit tools='webterm' wires the surface + toolCwd", () => {
    const runtime = createDaemonRuntime(runtimeOpts({ tools: 'webterm', toolCwd }));
    expect(runtime.tools).toBe('webterm');
    expect(runtime.toolCwd).toBe(toolCwd);
  });

  test("explicit tools='chat' wires the lighter surface + toolCwd (opt-in lighter surface · no WebTerminal*)", () => {
    const runtime = createDaemonRuntime(runtimeOpts({ tools: 'chat', toolCwd }));
    expect(runtime.tools).toBe('chat');
    expect(runtime.toolCwd).toBe(toolCwd);
  });

  // ── user-config resolution (replaces removed ELANOUS_TOOLS env path) ──

  test("user-config 'global.tools=chat' activates the lighter surface", () => {
    withUserConfig({ tools: 'chat' });
    const { tools } = createDaemonRuntime(runtimeOpts({ toolCwd }));
    expect(tools).toBe('chat');
  });

  test("user-config 'global.tools=readonly' activates the readonly surface", () => {
    withUserConfig({ tools: 'readonly' });
    const { tools } = createDaemonRuntime(runtimeOpts({ toolCwd }));
    expect(tools).toBe('readonly');
  });

  test("user-config 'global.tools=webterm' is the same as omitting it (default)", () => {
    withUserConfig({ tools: 'webterm' });
    const { tools } = createDaemonRuntime(runtimeOpts({ toolCwd }));
    expect(tools).toBe('webterm');
  });

  test("user-config 'global.tools=all' is honoured as the webterm alias", () => {
    withUserConfig({ tools: 'all' });
    const { tools } = createDaemonRuntime(runtimeOpts({ toolCwd }));
    expect(tools).toBe('webterm');
  });

  test("user-config 'global.tools=none' produces an empty surface", () => {
    withUserConfig({ tools: 'none' });
    const runtime = createDaemonRuntime(runtimeOpts({ toolCwd }));
    expect(runtime.tools).toBe('none');
    expect(runtime.toolCwd).toBeUndefined();
  });

  test("explicit opts.tools beats the persisted user-config preference", () => {
    withUserConfig({ tools: 'readonly' });
    const { tools } = createDaemonRuntime(runtimeOpts({ tools: 'webterm', toolCwd }));
    expect(tools).toBe('webterm');
  });

  test("invalid user-config 'global.tools' value falls through to the default ('webterm')", () => {
    // Pre-2026-05-13 a typo silently disabled the surface. Now it
    // falls through to the safest permissive default — the
    // sticky-webterm workflow stays alive.
    withUserConfig({ tools: 'all-the-tools-please' });
    const runtime = createDaemonRuntime(runtimeOpts({ toolCwd }));
    expect(runtime.tools).toBe('webterm');
    expect(runtime.toolCwd).toBe(toolCwd);
  });

  test('ELANOUS_TOOL_CWD env applied when tools=readonly (orthogonal — cwd env is separate)', () => {
    process.env.ELANOUS_TOOL_CWD = '/tmp';
    const { toolCwd: resolvedToolCwd } = createDaemonRuntime(runtimeOpts({ tools: 'readonly' }));
    expect(resolvedToolCwd).toBe('/tmp');
  });

  test('explicit toolCwd opt wins over env', () => {
    process.env.ELANOUS_TOOL_CWD = '/should/not/be/used';
    const { toolCwd } = createDaemonRuntime(runtimeOpts({ tools: 'readonly', toolCwd: '/explicit' }));
    expect(toolCwd).toBe('/explicit');
  });
});
