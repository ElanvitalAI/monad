// NEXUS · CLI helper for backend implementations (Phase N-3.5 PR υ)
//
// Shared spawn + capture for KeychainBackend (`security`) and
// OnePasswordBackend (`op`). Pluggable for tests via the
// `runCli` injection point.

interface BunSpawnLike {
  spawn(opts: {
    cmd: string[];
    stdin?: 'pipe' | 'ignore';
    stdout: 'pipe' | 'ignore';
    stderr: 'pipe' | 'ignore';
    env?: Record<string, string>;
  }): {
    pid: number;
    stdin: WritableStreamDefaultWriter | { write: (input: string) => void; end: () => void } | null;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    exited: Promise<number>;
  };
}

declare const Bun: BunSpawnLike;

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliOpts {
  stdin?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type RunCli = (cmd: string[], opts?: CliOpts) => Promise<CliResult>;

const DEFAULT_TIMEOUT_MS = 5000;

export const runCli: RunCli = async (cmd, opts = {}) => {
  const child = Bun.spawn({
    cmd,
    stdin: opts.stdin !== undefined ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    ...(opts.env ? { env: opts.env } : {}),
  });
  if (opts.stdin !== undefined && child.stdin && typeof (child.stdin as { write?: unknown }).write === 'function') {
    try {
      (child.stdin as { write(s: string): void; end(): void }).write(opts.stdin);
      (child.stdin as { write(s: string): void; end(): void }).end();
    } catch { /* ignore */ }
  }

  const stdout = child.stdout ? await streamToString(child.stdout) : '';
  const stderr = child.stderr ? await streamToString(child.stderr) : '';

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exitCode = await Promise.race<number>([
    child.exited,
    new Promise<number>((resolve) => setTimeout(() => resolve(124), timeoutMs)),
  ]);
  return { stdout, stderr, exitCode };
};

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } catch { /* ignore */ }
  return out;
}

/** Test seam — backends accept a `runCliImpl` opt that defaults to
 *  the real spawn-based runner above. Tests pass a stub that returns
 *  programmable {stdout,stderr,exitCode} per cmd[0]. */
export function makeStubRunCli(handlers: Record<string, (cmd: string[], opts?: CliOpts) => CliResult | Promise<CliResult>>): RunCli {
  return async (cmd, opts) => {
    const tool = cmd[0]?.split('/').pop() ?? cmd[0] ?? '';
    const handler = handlers[tool] ?? handlers['*'];
    if (!handler) {
      return { stdout: '', stderr: `no stub handler for ${tool}`, exitCode: 127 };
    }
    return handler(cmd, opts);
  };
}
