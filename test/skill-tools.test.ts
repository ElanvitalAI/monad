// ── skill-tools (Bash bridge) tests ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBashTool, dispatchBash } from '../src/skills/tools/index';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'skill-tools-'));
}

describe('buildBashTool', () => {
  test('schema has required command field + optional timeout', () => {
    const tool = buildBashTool();
    expect(tool.name).toBe('Bash');
    const schema = tool.parameters as any;
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['command']);
    expect(schema.properties.command.type).toBe('string');
    expect(schema.properties.timeout.type).toBe('number');
  });
});

describe('dispatchBash — happy path', () => {
  test('echo captures stdout, exit 0', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo hello' }, { cwd: dir });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('hello');
      expect(r.output.trim()).toBe('hello');
      expect(r.timedOut).toBe(false);
      expect(r.aborted).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('runs in the requested cwd', async () => {
    const dir = tmpDir();
    try {
      writeFileSync(join(dir, 'marker.txt'), 'present');
      const r = await dispatchBash({ command: 'cat marker.txt' }, { cwd: dir });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe('present');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('process.env inherited — PATH works for common tools', async () => {
    // `node` / `python3` should be reachable via inherited PATH.
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'which node || which python3 || echo no-interp' }, { cwd: dir });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toMatch(/^no-interp/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLAUDECODE env var exported to child', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo $CLAUDECODE' }, { cwd: dir });
      expect(r.stdout.trim()).toBe('1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('node one-liner works (proves nodejs skills can execute)', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: `node -e "console.log(2+2)"` }, { cwd: dir });
      if (r.exitCode !== 0) return;  // no node in CI — skip quietly
      expect(r.stdout.trim()).toBe('4');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('python3 one-liner works (proves python skills can execute)', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: `python3 -c "print(6*7)"` }, { cwd: dir });
      if (r.exitCode !== 0) return;  // no python3 in CI — skip quietly
      expect(r.stdout.trim()).toBe('42');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dispatchBash — failure modes', () => {
  test('non-zero exit prepended with [exit N]', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'exit 3' }, { cwd: dir });
      expect(r.exitCode).toBe(3);
      expect(r.output).toContain('[exit 3]');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('stderr is captured and joined when stdout also present', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo out; echo err >&2' }, { cwd: dir });
      expect(r.stdout.trim()).toBe('out');
      expect(r.stderr.trim()).toBe('err');
      expect(r.output).toContain('out');
      expect(r.output).toContain('err');
      expect(r.output).toContain('--- stderr ---');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('empty command → graceful no-op result', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: '' }, { cwd: dir });
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain('no command');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('missing command arg treated as empty', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({}, { cwd: dir });
      expect(r.output).toContain('no command');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dispatchBash — timeout', () => {
  test('command exceeding timeout is killed with [timed out] marker', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash(
        { command: 'sleep 10' },
        { cwd: dir, defaultTimeoutMs: 100 },
      );
      expect(r.timedOut).toBe(true);
      expect(r.output).toContain('[timed out');
      expect(r.durationMs).toBeLessThan(5000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 10000);

  test('per-call timeout overrides default', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash(
        { command: 'sleep 10', timeout: 50 },
        { cwd: dir, defaultTimeoutMs: 60_000 },
      );
      expect(r.timedOut).toBe(true);
      expect(r.durationMs).toBeLessThan(5000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 10000);

  test('per-call timeout is capped at maxTimeoutMs', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash(
        { command: 'sleep 10', timeout: 999_999_999 },
        { cwd: dir, maxTimeoutMs: 80 },
      );
      expect(r.timedOut).toBe(true);
      // If cap wasn't enforced we'd hang for 10s; must finish well before.
      expect(r.durationMs).toBeLessThan(5000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 10000);
});

describe('dispatchBash — abort', () => {
  test('AbortSignal kills in-flight subprocess', async () => {
    const dir = tmpDir();
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 20);
      const r = await dispatchBash(
        { command: 'sleep 10' },
        { cwd: dir, signal: ctrl.signal },
      );
      expect(r.aborted).toBe(true);
      expect(r.output).toContain('[aborted]');
      expect(r.durationMs).toBeLessThan(5000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 10000);

  test('already-aborted signal short-circuits', async () => {
    const dir = tmpDir();
    try {
      const ctrl = new AbortController();
      ctrl.abort();
      const r = await dispatchBash(
        { command: 'sleep 10' },
        { cwd: dir, signal: ctrl.signal },
      );
      expect(r.aborted).toBe(true);
      expect(r.durationMs).toBeLessThan(3000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 5000);
});

describe('dispatchBash — output truncation', () => {
  test('output past cap gets head+tail with elision marker', async () => {
    const dir = tmpDir();
    try {
      // Produce ~10KB of output, cap at 2KB.
      const r = await dispatchBash(
        { command: `for i in $(seq 1 300); do echo "line-$i-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; done` },
        { cwd: dir, maxOutputChars: 2000 },
      );
      expect(r.exitCode).toBe(0);
      expect(r.output.length).toBeLessThan(2500);
      expect(r.output).toContain('line-1-');        // head kept
      expect(r.output).toContain('line-300-');      // tail kept
      expect(r.output).toContain('chars elided');   // marker present
      expect(r.output).toContain('truncated at 2000 chars');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 15000);

  test('output at/under cap is NOT truncated', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo small' }, { cwd: dir });
      expect(r.output).not.toContain('elided');
      expect(r.output).not.toContain('truncated');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dispatchBash — shell selection', () => {
  test('shell: zsh respected when present', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo $ZSH_VERSION' }, { cwd: dir, shell: 'zsh' });
      // When zsh isn't installed the spawn error shows up in stderr
      // and the test degrades gracefully.
      if (r.exitCode === 127 || r.output.includes('spawn error')) return;
      expect(r.stdout.trim().length).toBeGreaterThan(0);  // zsh prints its version
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('unknown shell falls back to bash', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo $BASH_VERSION' }, { cwd: dir, shell: 'fake-shell' });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim().length).toBeGreaterThan(0);  // bash version printed
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('shell: sh is allowed (POSIX fallback)', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo sh-ran' }, { cwd: dir, shell: 'sh' });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('sh-ran');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ─── Track G: sandbox opt-through ─────────────────────────────────

describe('dispatchBash — sandbox (Track G)', () => {
  test('default sandboxed=false', async () => {
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo x' }, { cwd: dir });
      expect(r.sandboxed).toBe(false);
      expect(r.sandboxTool).toBe('none');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('sandbox=auto on darwin sets sandboxed=true', async () => {
    if (process.platform !== 'darwin') return;
    const dir = tmpDir();
    try {
      const r = await dispatchBash({ command: 'echo sandboxed-bash' }, { cwd: dir, sandbox: 'auto' });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('sandboxed-bash');
      expect(r.sandboxed).toBe(true);
      expect(r.sandboxTool).toBe('sandbox-exec');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('per-call args.sandbox wins over opts.sandbox', async () => {
    if (process.platform !== 'darwin') return;
    const dir = tmpDir();
    try {
      const r = await dispatchBash(
        { command: 'echo dual', sandbox: 'auto' },
        { cwd: dir, sandbox: 'off' },
      );
      expect(r.sandboxed).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('tool schema surfaces sandbox + network enums', () => {
    const tool = buildBashTool();
    const schema = tool.parameters as any;
    expect(schema.properties.sandbox.enum).toEqual(['off', 'auto', 'strict']);
    expect(schema.properties.network.enum).toEqual(['inherit', 'off']);
  });
});
