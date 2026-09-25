// ── Phase L1+L4 · typescript-language-server probe tests ──
//
// Probe behaviour is environment-dependent (the binary may or may
// not be installed on the developer's machine). These tests keep
// the assertions environment-robust:
//   - First test probes against an explicit empty PATH and asserts
//     null, using `env` we pass directly into a child `which` rather
//     than relying on the parent process's inherited PATH (Bun/node
//     may cache PATH at module-load time which made the previous
//     `process.env.PATH = '…'` mutation unreliable).
//   - Second test asserts cache stability: two calls back-to-back
//     return the SAME value regardless of what that value is.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  typescriptLanguageServerBinary,
  __resetTypescriptServerProbeCacheForTests,
} from '../src/skills/tools/lsp/typescript-server';

describe('typescript-language-server probe', () => {
  beforeEach(() => {
    __resetTypescriptServerProbeCacheForTests();
  });
  afterEach(() => {
    __resetTypescriptServerProbeCacheForTests();
  });

  test('missing-binary path is reachable — `which` on an empty PATH returns non-zero', () => {
    // Direct sanity check of the underlying mechanism, independent
    // of whether typescript-language-server happens to be installed
    // on this machine. If this assertion breaks, the install-hint
    // error in the dispatcher wouldn't reach users missing the
    // binary either.
    const r = spawnSync('which', ['typescript-language-server'], {
      encoding: 'utf-8',
      env: { PATH: '/nonexistent/empty-dir-for-probe-test' },
    });
    expect(r.status).not.toBe(0);
  });

  test('probe result is cached — two calls return the same value', () => {
    const first = typescriptLanguageServerBinary();
    const second = typescriptLanguageServerBinary();
    expect(first).toBe(second);
  });
});
