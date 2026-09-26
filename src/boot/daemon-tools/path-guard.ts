// MVP M1.5 A.2 — path safety primitives shared by Read + Grep.
//
// Single source of truth for two checks every fs-bound daemon tool
// must pass before touching the filesystem:
//   1. Path traversal — resolved path must stay within the tool's
//      cwd. Both `..` walks and absolute paths to other roots fail.
//   2. Sensitive deny-list — even WITHIN cwd, refuse paths matching
//      well-known credential / key patterns. Defense in depth: a
//      misconfigured cwd should not leak `~/.ssh/id_rsa`.
//
// Symlinks: `realpath` is consulted when the file exists so an
// in-cwd symlink pointing OUTSIDE the cwd is rejected. Non-existent
// targets fall back to the lexical resolution (path doesn't exist
// yet → no symlink to follow).

import { realpathSync } from 'node:fs';
import { resolve as resolvePath, sep as pathSep } from 'node:path';

import { ToolSafetyError } from './types.js';

/** Patterns that match credential / key files we never want a daemon
 *  tool to surface to an LLM, even when the request stays inside
 *  cwd. The LLM might inadvertently echo the contents in its
 *  response; this is the last line of defense. */
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.ssh\//,
  /(^|\/)\.env(\.[^/]+)?$/,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/,
  /(^|\/)\.elanous\/acp-token$/,
  /(^|\/)\.elanous\/auth\.json$/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.aws\/config$/,
  /(^|\/)\.gnupg\//,
  /(^|\/)\.netrc$/,
  /(^|\/)\.kube\/config$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.pypirc$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
];

/** SENSITIVE_PATTERNS 의 ripgrep(gitignore-style) glob 대응 — strict 정책의 Grep 이 재귀 검색에서
 *  자격증명/키 파일을 아예 읽지 않도록 `rg -g '!<glob>'` 로 제외(Phase 4b PR3). `/` 없는 glob 은 rg
 *  에서 임의 깊이 매칭이라 `.env`·`*.pem` 은 전 하위경로에서 배제된다. 패턴 리스트와 짝(드리프트 주의). */
export const SENSITIVE_GLOBS: readonly string[] = [
  '.ssh', '.env', '.env.*',
  'id_rsa', 'id_rsa.pub', 'id_ed25519', 'id_ed25519.pub', 'id_ecdsa', 'id_dsa',
  '.aws', '.gnupg', '.netrc', '.kube', '.npmrc', '.pypirc', 'acp-token', '.elanous/auth.json',
  '*.pem', '*.key', '*.p12', '*.pfx',
];

/** Resolve `input` against `cwd` and ensure the result stays inside `cwd`
 *  (following symlinks when the target exists), but WITHOUT the credential
 *  deny-list. This is the cwd-anchor half of `resolveSafe` — the `anchored`
 *  PathPolicy (turn 조립기 통일 Phase 4b). Throws `ToolSafetyError` on escape.
 *
 *  Both the cwd and the resolved target are run through `realpath` before
 *  comparison so platform symlinks (macOS `/var/folders` → `/private/var/
 *  folders`) don't read as out-of-cwd. */
export function anchoredResolve(input: string, cwd: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ToolSafetyError('path-traversal', 'empty path');
  }
  const cwdLexical = resolvePath(cwd);
  let cwdReal = cwdLexical;
  try { cwdReal = realpathSync(cwdLexical); } catch { /* cwd may not exist yet */ }
  // Lexical resolution against the lexical cwd first.
  const lexical = resolvePath(cwdLexical, input);
  if (!isWithin(lexical, cwdLexical) && !isWithin(lexical, cwdReal)) {
    throw new ToolSafetyError('path-traversal', `${input} escapes cwd`);
  }
  // Try real-path (follows symlinks). If the file doesn't exist
  // yet, fall back to the lexical path — callers' stat/read will
  // surface ENOENT meaningfully.
  let canonical = lexical;
  try {
    canonical = realpathSync(lexical);
    if (!isWithin(canonical, cwdReal)) {
      throw new ToolSafetyError(
        'path-traversal',
        `${input} resolves to ${canonical} (escapes cwd via symlink)`,
      );
    }
  } catch (err) {
    if (err instanceof ToolSafetyError) throw err;
    // ENOENT or other fs error → leave canonical as the lexical path.
  }
  return canonical;
}

/** Resolve `input` against `cwd`, ensure the result stays inside `cwd`, follows
 *  symlinks, AND is not on the credential deny-list. Throws `ToolSafetyError`
 *  on any violation. = `anchored` + deny-list = the `strict` PathPolicy.
 *
 *  Behavior-identical to before Phase 4b (anchoredResolve extracted; the
 *  deny-list loop is unchanged and runs on the same `canonical`). */
export function resolveSafe(input: string, cwd: string): string {
  const canonical = anchoredResolve(input, cwd);
  // Policies are POSIX-shaped while callers may supply Windows separators.
  const policyPath = canonical.replace(/\\/g, '/');
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(policyPath)) {
      throw new ToolSafetyError('sensitive', `${input} matches deny-list pattern ${re}`);
    }
  }
  return canonical;
}

function isWithin(target: string, root: string): boolean {
  if (target === root) return true;
  return target.startsWith(root + pathSep);
}

/** Cheap heuristic: does the byte buffer look like binary? Sniffs
 *  the first 8KB for NUL bytes or a high non-printable ratio.
 *  Identical sniff used by `Read` to refuse binary files (the LLM
 *  has nothing useful to do with raw bytes; the tool result becomes
 *  a base64 blob otherwise). */
export function isBinary(buf: Buffer | Uint8Array): boolean {
  const sample = buf.subarray(0, Math.min(8192, buf.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const c = sample[i]!;
    if (c === 0) return true; // NUL byte = definitely binary
    if (c < 9 || (c > 13 && c < 32) || c === 127) nonPrintable += 1;
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.3;
}
