import { mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { debug } from '../../debug/log.js';
import { runLedgerDir, runLedgerPath } from '../../self-implement/run-ledger.js';

type Ledger = { runId: string; jsonl: string };
type Incomplete = { runId: string; reason: string };
type ParseResult = Ledger[] | { error: Incomplete[]; ledgers: Ledger[] };

/** Reassemble only complete, unambiguous transfers; retain good runs when another run is incomplete. */
export function parsePodLedgerChunks(logs: string): ParseResult {
  const groups = new Map<string, { total: number; chunks: Map<number, string>; reason?: string }>();
  for (const line of logs.split(/\r?\n/)) {
    if (!line.startsWith('ELANOUS_RUN_LEDGER ')) continue;
    const match = /^ELANOUS_RUN_LEDGER (\S+) (\d+)\/(\d+) ([A-Za-z0-9+/=]+)$/.exec(line);
    if (!match) {
      const runId = /^ELANOUS_RUN_LEDGER (\S+)/.exec(line)?.[1];
      if (runId) {
        const group = groups.get(runId) ?? { total: 0, chunks: new Map<number, string>() };
        group.reason = 'malformed chunk';
        groups.set(runId, group);
      }
      continue;
    }
    const [, runId, partText, totalText, chunk] = match;
    const part = Number(partText);
    const total = Number(totalText);
    const group = groups.get(runId!) ?? { total, chunks: new Map<number, string>() };
    groups.set(runId!, group);
    if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || part < 1 || total < 1 || part > total || chunk!.length > 8000 || group.total !== total || group.chunks.has(part)) {
      group.reason = 'invalid or duplicate chunk';
    } else {
      group.chunks.set(part, chunk!);
    }
  }
  const ledgers: Ledger[] = [];
  const error: Incomplete[] = [];
  for (const [runId, group] of groups) {
    let reason = group.reason;
    if (!reason && group.chunks.size !== group.total) reason = 'missing chunk';
    if (!reason) {
      for (let i = 1; i <= group.total; i++) {
        if (!group.chunks.has(i)) { reason = 'missing chunk'; break; }
      }
    }
    if (!reason) {
      try {
        runLedgerPath(runId);
        let encoded = '';
        for (let i = 1; i <= group.total; i++) encoded += group.chunks.get(i)!;
        const compressed = Buffer.from(encoded, 'base64');
        if (compressed.toString('base64') !== encoded) throw new Error('invalid base64');
        const raw = gunzipSync(compressed);
        const jsonl = raw.toString('utf8');
        if (!Buffer.from(jsonl, 'utf8').equals(raw)) throw new Error('invalid UTF-8');
        ledgers.push({ runId, jsonl });
      } catch (e) { reason = e instanceof Error ? e.message : String(e); }
    }
    if (reason) error.push({ runId, reason });
  }
  return error.length ? { error, ledgers } : ledgers;
}

/** Never replace a host ledger, even if another collector races this one. */
export function collectPodLedgers(
  logs: string,
  { dir = runLedgerDir(), log = (c, e, d) => debug.log(c, e, d) }: {
    dir?: string;
    log?: (category: string, event: string, data: Record<string, unknown>) => void;
  } = {},
): void {
  const parsed = parsePodLedgerChunks(logs);
  const ledgers = Array.isArray(parsed) ? parsed : parsed.ledgers;
  for (const { runId, reason } of Array.isArray(parsed) ? [] : parsed.error) {
    log('self-implement.pod', 'ledger-collect-incomplete', { runId, reason });
  }
  for (const { runId, jsonl } of ledgers) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(runLedgerPath(runId, dir), jsonl, { flag: 'wx' });
      log('self-implement.pod', 'ledger-collected', { runId, lines: jsonl.split('\n').filter(Boolean).length, bytes: Buffer.byteLength(jsonl) });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') log('self-implement.pod', 'ledger-collect-skipped', { runId, reason: 'exists' });
      else log('self-implement.pod', 'ledger-collect-incomplete', { runId, reason: e instanceof Error ? e.message : String(e) });
    }
  }
}
