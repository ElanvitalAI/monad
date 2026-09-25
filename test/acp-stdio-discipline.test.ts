// Hermes-ACP lessons §5 — ACP stdio discipline static lint test.
//
// Enforces: files on the server-side ACP path must not invoke
// console.log / console.info / console.warn / console.debug /
// process.stdout.write. These all land on stdout, which is
// reserved for JSON-RPC frames when monad runs as `--acp-server`
// over stdio. A single stray call corrupts the stream and the
// parent client (claude-code, zed, messenger gateway) drops.
//
// Allowed: console.error + process.stderr.write (both stderr) +
// debug.log (internal logger, never to stdio in normal mode).
//
// The canonical module list lives in
// `src/tui-client/acp-stdio-discipline.ts`; editing it is the
// right place to add coverage when a new server-side module lands.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import {
  scanAcpStdioDiscipline,
  ACP_STDIO_DISCIPLINE_MODULES,
} from '../src/tui-client/acp-stdio-discipline.js';

const REPO_ROOT = joinPath(import.meta.dir, '..');

function readModule(rel: string): string {
  return readFileSync(joinPath(REPO_ROOT, rel), 'utf-8');
}

describe('scanAcpStdioDiscipline — unit', () => {
  test('flags console.log', () => {
    expect(scanAcpStdioDiscipline(`console.log('x');`)).toHaveLength(1);
  });
  test('flags console.info / warn / debug', () => {
    expect(scanAcpStdioDiscipline(`console.info('a');`)).toHaveLength(1);
    expect(scanAcpStdioDiscipline(`console.warn('b');`)).toHaveLength(1);
    expect(scanAcpStdioDiscipline(`console.debug('c');`)).toHaveLength(1);
  });
  test('flags process.stdout.write', () => {
    expect(scanAcpStdioDiscipline(`process.stdout.write('x');`)).toHaveLength(1);
  });
  test('flags process.stdout.cork / uncork', () => {
    expect(scanAcpStdioDiscipline(`process.stdout.cork();`)).toHaveLength(1);
    expect(scanAcpStdioDiscipline(`process.stdout.uncork();`)).toHaveLength(1);
  });
  test('ignores console.error (stderr-bound)', () => {
    expect(scanAcpStdioDiscipline(`console.error('ok');`)).toHaveLength(0);
  });
  test('ignores process.stderr.write (stderr-bound)', () => {
    expect(scanAcpStdioDiscipline(`process.stderr.write('ok');`)).toHaveLength(0);
  });
  test('ignores debug.log (internal logger)', () => {
    expect(scanAcpStdioDiscipline(`debug.log('cat', 'msg');`)).toHaveLength(0);
  });
  test('reports line numbers', () => {
    const hits = scanAcpStdioDiscipline('line1\nline2\nconsole.log(1);\n');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(3);
  });
  test('multiple hits are sorted + deduped', () => {
    const src = `console.log(1); process.stdout.write('x'); console.info(2);`;
    const hits = scanAcpStdioDiscipline(src);
    expect(hits).toHaveLength(3);
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i]!.offset).toBeGreaterThan(hits[i - 1]!.offset);
    }
  });
});

describe('ACP stdio discipline — server-side modules are stdout-clean', () => {
  for (const rel of ACP_STDIO_DISCIPLINE_MODULES) {
    test(`${rel} has no stdout-bound calls`, () => {
      const source = readModule(rel);
      const hits = scanAcpStdioDiscipline(source);
      if (hits.length > 0) {
        const summary = hits.map((h) => `  L${h.line}: ${h.match}`).join('\n');
        throw new Error(
          `${rel} has ${hits.length} stdout-bound call(s) — these corrupt ACP JSON-RPC when monad runs with --acp-server over stdio. Route to stderr (console.error / process.stderr.write) or the internal debug.log:\n${summary}`,
        );
      }
      expect(hits).toEqual([]);
    });
  }
});
