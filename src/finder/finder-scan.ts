// Finder file enumeration — T4-F1.
//
// Streams file paths under a root directory for the Ctrl+T finder
// modal. Prefers `fd` (respects .gitignore + is 10-100x faster
// than find on large trees); falls back to POSIX `find -type f`
// when fd isn't installed.
//
// Streaming: callers receive paths in batches as the scanner
// reads stdout. The modal can render results as they arrive
// instead of blocking on the full enumeration — important for
// monorepos with 50k+ files.

import { spawn, type ChildProcess } from 'node:child_process';
import { getSessionCwd } from '../session/working-dir.js';

export interface FinderScanOpts {
  /** Absolute or cwd-relative root. Default getSessionCwd() (WD7). */
  root?: string;
  /** Max files to enumerate. Default 50k; scanner stops at the cap. */
  maxFiles?: number;
  /** Include hidden files. T5-H2 default true to match the user's
   *  ~/.zsh/fzf.zsh (`fd --hidden --strip-cwd-prefix --exclude .git`).
   *  Set to false to mirror plain `fd` behavior. */
  includeHidden?: boolean;
  /** Override backend (tests). */
  backend?: 'fd' | 'find';
  /** What to enumerate. Default 'file'. 'dir' powers the Alt+C
   *  directory finder (mirrors zshrc `FZF_ALT_C_COMMAND="fd --type=d"`). */
  kind?: 'file' | 'dir';
}

export interface FinderScanResult {
  paths: string[];
  truncated: boolean;
  backend: 'fd' | 'find';
  durationMs: number;
}

export interface FinderScanDeps {
  spawnImpl?: typeof spawn;
  /** Override backend detection (tests). */
  probeBackend?: () => 'fd' | 'find';
  now?: () => number;
}

const DEFAULT_MAX = 50_000;

/** Synchronous probe: which backend is resolvable on PATH? Falls
 *  back to `find` because POSIX. */
export function detectFinderBackend(): 'fd' | 'find' {
  // fd is sometimes installed as `fdfind` on debian. We only
  // probe `fd` for the MVP; users with fdfind can alias.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const r = spawnSync('fd', ['--version'], { stdio: 'ignore', timeout: 1000 });
    if (r.status === 0) return 'fd';
  } catch { /* fall through */ }
  return 'find';
}

/** Build the argv for the selected backend. Both produce
 *  newline-separated paths on stdout. Defaults align with the
 *  user's ~/.zsh/fzf.zsh:
 *
 *    FZF_DEFAULT_COMMAND="fd --hidden --strip-cwd-prefix --exclude .git"
 *
 *  So hidden-by-default = true, and .git is always excluded. The
 *  T5-H2 change inverts the prior default (hidden=false) to match
 *  the user's shell experience. */
function buildArgv(
  backend: 'fd' | 'find',
  root: string,
  hidden: boolean,
  kind: 'file' | 'dir' = 'file',
): string[] {
  const fdType = kind === 'dir' ? 'd' : 'f';
  const findType = kind === 'dir' ? 'd' : 'f';
  if (backend === 'fd') {
    const args = ['--type', fdType, '--color', 'never'];
    if (hidden) args.push('--hidden');
    args.push('--exclude', '.git');
    args.push('--exclude', 'node_modules');
    args.push('.', root);
    return ['fd', ...args];
  }
  // find fallback — mirror fd semantics:
  //   • --exclude .git / node_modules  →  -not -path entries
  //   • --hidden=false                  →  filter dotted paths
  const args: string[] = [root, '-type', findType];
  args.push('-not', '-path', '*/.git/*');
  args.push('-not', '-path', '*/node_modules/*');
  if (!hidden) args.push('-not', '-path', '*/.*');
  return ['find', ...args];
}

/** Run the scanner and collect paths into an array. Callers that
 *  want streaming should use scanFinderStreaming(). */
export async function scanFinder(
  opts: FinderScanOpts = {},
  deps: FinderScanDeps = {},
): Promise<FinderScanResult> {
  const root = opts.root ?? getSessionCwd();
  const max = opts.maxFiles ?? DEFAULT_MAX;
  const hidden = opts.includeHidden ?? true;
  const kind = opts.kind ?? 'file';
  const backend = opts.backend ?? deps.probeBackend?.() ?? detectFinderBackend();
  const now = deps.now ?? (() => Date.now());
  const spawner = deps.spawnImpl ?? spawn;
  const startedAt = now();
  const argv = buildArgv(backend, root, hidden, kind);

  const paths: string[] = [];
  let truncated = false;

  await new Promise<void>((resolve) => {
    const child: ChildProcess = spawner(argv[0]!, argv.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return;
      buf += chunk.toString('utf-8');
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line) {
          paths.push(line);
          if (paths.length >= max) {
            truncated = true;
            try { child.kill('SIGTERM'); } catch { /* ignore */ }
            resolve();
            return;
          }
        }
        idx = buf.indexOf('\n');
      }
    });
    child.on('error', () => { resolve(); });
    child.on('close', () => {
      if (!truncated && buf) {
        // flush final line without trailing newline
        paths.push(buf);
        if (paths.length > max) { paths.length = max; truncated = true; }
      }
      resolve();
    });
  });

  return {
    paths,
    truncated,
    backend,
    durationMs: now() - startedAt,
  };
}

/** Strip a root prefix so results show as relative paths. */
export function relativizeResults(paths: string[], root: string): string[] {
  const withSlash = root.endsWith('/') ? root : root + '/';
  return paths.map(p => {
    if (p === root) return '.';
    if (p.startsWith(withSlash)) return p.slice(withSlash.length);
    return p;
  });
}
