import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { appendRunLedgerEntry, runLedgerDir, runLedgerPath } from '../../self-implement/run-ledger.js';
import { collectPodLedgers, parsePodLedgerChunks } from './pod-ledger-collect.js';

const runId = 'run-12345678-1234-1234-1234-123456789abc';
const otherId = 'run-87654321-1234-1234-1234-123456789abc';
const origin = { podName: 'job-x-abcde', nodeName: 'node-1', podNamespace: 'test' };

// Mirrors the manifest's gzip → base64 → <=8000-character indexed lines.
function transfer(id: string, jsonl: string): string[] {
  const encoded = gzipSync(Buffer.from(jsonl)).toString('base64');
  const parts = encoded.match(/.{1,8000}/g)!;
  return parts.map((chunk, index) => `ELANOUS_RUN_LEDGER ${id} ${index + 1}/${parts.length} ${chunk}`);
}

function fixture(): { source: string; destination: string; original: Buffer; lines: string[] } {
  const source = mkdtempSync(join(tmpdir(), 'pod-ledger-source-'));
  const destination = mkdtempSync(join(tmpdir(), 'pod-ledger-host-'));
  const dir = runLedgerDir(source);
  for (let index = 0; index < 3; index++) {
    appendRunLedgerEntry({ runId, event: index === 0 ? 'start' : 'progress', data: { origin, payload: Array.from({ length: 2000 }, (_, i) => `${i}-${index}`).join(':') } }, dir);
  }
  const original = readFileSync(runLedgerPath(runId, dir));
  const chunks = transfer(runId, original.toString('utf8'));
  return { source, destination, original, lines: chunks.flatMap((chunk) => ['unrelated pod output', chunk]) };
}

describe('pod run-ledger collection', () => {
  test('restores a real writer ledger byte-for-byte with origin from interspersed, out-of-order chunks', () => {
    const f = fixture();
    try {
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const logs = ['before', ...f.lines.reverse(), 'ELANOUS_RUN_LEDGER_NONE', '{"ok":true}'].join('\n');
      collectPodLedgers(logs, { dir: runLedgerDir(f.destination), log: (_c, event, data) => events.push({ event, data }) });
      expect(parsePodLedgerChunks(logs)).toEqual([{ runId, jsonl: f.original.toString('utf8') }]);
      const restored = readFileSync(runLedgerPath(runId, runLedgerDir(f.destination)));
      expect(restored.equals(f.original)).toBe(true);
      expect(restored.toString('utf8')).toContain('job-x-abcde');
      expect(events).toContainEqual({ event: 'ledger-collected', data: { runId, lines: 3, bytes: f.original.length } });
    } finally { rmSync(f.source, { recursive: true, force: true }); rmSync(f.destination, { recursive: true, force: true }); }
  });

  test('a missing middle chunk stays incomplete while an independent run is collected', () => {
    const f = fixture();
    try {
      const chunks = transfer(runId, f.original.toString('utf8'));
      expect(chunks.length).toBeGreaterThan(2);
      const logs = [...chunks.slice(0, 1), ...chunks.slice(2), ...transfer(otherId, '{"ok":true}\n')].join('\n');
      const parsed = parsePodLedgerChunks(logs);
      expect(Array.isArray(parsed)).toBe(false);
      expect(parsed).toMatchObject({ error: [{ runId, reason: 'missing chunk' }], ledgers: [{ runId: otherId, jsonl: '{"ok":true}\n' }] });
      const events: string[] = [];
      collectPodLedgers(logs, { dir: runLedgerDir(f.destination), log: (_c, event) => events.push(event) });
      expect(() => readFileSync(runLedgerPath(runId, runLedgerDir(f.destination)))).toThrow();
      expect(events).toEqual(['ledger-collect-incomplete', 'ledger-collected']);
    } finally { rmSync(f.source, { recursive: true, force: true }); rmSync(f.destination, { recursive: true, force: true }); }
  });

  test('an existing host ledger is not overwritten', () => {
    const f = fixture();
    try {
      const dir = runLedgerDir(f.destination);
      appendRunLedgerEntry({ runId, event: 'host', data: {} }, dir);
      const before = readFileSync(runLedgerPath(runId, dir));
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      collectPodLedgers(f.lines.join('\n'), { dir, log: (_c, event, data) => events.push({ event, data }) });
      expect(readFileSync(runLedgerPath(runId, dir)).equals(before)).toBe(true);
      expect(events).toContainEqual({ event: 'ledger-collect-skipped', data: { runId, reason: 'exists' } });
    } finally { rmSync(f.source, { recursive: true, force: true }); rmSync(f.destination, { recursive: true, force: true }); }
  });

  test('duplicate or malformed parts and unsafe run ids never write files', () => {
    const dest = mkdtempSync(join(tmpdir(), 'pod-ledger-unsafe-'));
    try {
      const chunk = transfer(runId, 'one\n')[0]!;
      const unsafe = transfer('..', 'one\n')[0]!;
      const malformed = transfer(otherId, 'one\n')[0]!.replace(/.$/, '?');
      const events: string[] = [];
      collectPodLedgers([chunk, chunk, unsafe, malformed].join('\n'), { dir: runLedgerDir(dest), log: (_c, event) => events.push(event) });
      expect(events).toEqual(['ledger-collect-incomplete', 'ledger-collect-incomplete', 'ledger-collect-incomplete']);
      expect(() => readFileSync(runLedgerPath(runId, runLedgerDir(dest)))).toThrow();
    } finally { rmSync(dest, { recursive: true, force: true }); }
  });

  test('a conflicting total for one run invalidates that run', () => {
    const single = transfer(runId, 'one\n')[0]!;
    const conflicting = single.replace(' 1/1 ', ' 1/2 ');
    expect(parsePodLedgerChunks([single, conflicting].join('\n'))).toMatchObject({
      error: [{ runId, reason: 'invalid or duplicate chunk' }], ledgers: [],
    });
  });
});
