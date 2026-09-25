// ── PFC-S3 P3: experiment ledger + NOW.md handoff ──
//
// Per-goal directory under .monad/research/<goal-slug>/ that collects
// one subdir per experiment with meta.json + optional inputs/ +
// output.md. The ledger owns meta.json mutations — callers write the
// payload files themselves.
//
// Same-step baseline rule (DD-S2-3): to compare "this iteration" vs
// "previous try" the caller passes a `step` number in the metadata;
// sameStepBaseline() returns the most recent VALIDATED experiment at
// the same step. Different-step comparisons are deliberately null so
// the loop driver does not chase fake wins.
//
// NOW.md is the persistent handoff note — the autonomous loop reads
// it at turn kickoff and updates it when a turn finishes.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ExperimentStatus =
  | 'running'
  | 'validated'
  | 'invalidated'
  | 'aborted';

export interface ExperimentMeta {
  id: string;
  goalSlug: string;
  createdAt: number;
  updatedAt: number;
  step: number;                    // sequential step number for same-step baseline
  predictedDurationS?: number;
  actualDurationS?: number;
  status: ExperimentStatus;
  baselineId?: string;             // explicit override; otherwise resolved dynamically
  hypothesis?: string;
  result?: string;                  // short summary
  tags?: string[];
}

export class ExperimentLedger {
  constructor(private readonly goalRoot: string) {
    ensureDir(this.goalRoot);
    ensureDir(join(this.goalRoot, 'snapshots'));
  }

  create(
    meta: Omit<ExperimentMeta, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<ExperimentMeta, 'id'>>,
    now: number = Date.now(),
  ): ExperimentMeta {
    const id = meta.id ?? shortId();
    const full: ExperimentMeta = {
      id,
      goalSlug: meta.goalSlug,
      step: meta.step,
      createdAt: now,
      updatedAt: now,
      status: 'running',
      ...(meta.predictedDurationS !== undefined ? { predictedDurationS: meta.predictedDurationS } : {}),
      ...(meta.baselineId ? { baselineId: meta.baselineId } : {}),
      ...(meta.hypothesis ? { hypothesis: meta.hypothesis } : {}),
      ...(meta.tags ? { tags: meta.tags } : {}),
    };
    this.persistMeta(id, full);
    ensureDir(join(this.goalRoot, 'snapshots', id, 'inputs'));
    return full;
  }

  update(id: string, patch: Partial<Omit<ExperimentMeta, 'id' | 'createdAt'>>, now: number = Date.now()): ExperimentMeta {
    const current = this.get(id);
    if (!current) throw new Error(`experiment '${id}' not found`);
    const next: ExperimentMeta = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
    };
    this.persistMeta(id, next);
    return next;
  }

  get(id: string): ExperimentMeta | null {
    const path = this.metaPath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as ExperimentMeta;
    } catch {
      return null;
    }
  }

  list(filter?: { status?: ExperimentStatus; step?: number }): ExperimentMeta[] {
    const snapDir = join(this.goalRoot, 'snapshots');
    if (!existsSync(snapDir)) return [];
    const out: ExperimentMeta[] = [];
    for (const entry of readdirSync(snapDir)) {
      const meta = this.get(entry);
      if (!meta) continue;
      if (filter?.status && meta.status !== filter.status) continue;
      if (filter?.step !== undefined && meta.step !== filter.step) continue;
      out.push(meta);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** DD-S2-3: find the most recent VALIDATED experiment at the SAME
   *  step number as the target. Different-step experiments are
   *  intentionally ignored — fake-win prevention. */
  sameStepBaseline(id: string): ExperimentMeta | null {
    const target = this.get(id);
    if (!target) return null;
    if (target.baselineId) return this.get(target.baselineId);
    const peers = this.list({ step: target.step, status: 'validated' })
      .filter(m => m.id !== id && m.createdAt < target.createdAt);
    return peers.length === 0 ? null : peers[peers.length - 1]!;
  }

  writeNow(text: string): void {
    atomicWrite(join(this.goalRoot, 'NOW.md'), text);
  }

  readNow(): string | null {
    const path = join(this.goalRoot, 'NOW.md');
    if (!existsSync(path)) return null;
    try { return readFileSync(path, 'utf-8'); } catch { return null; }
  }

  /** Root dir for a given experiment id — callers can write inputs/
   *  or output.md inside. */
  experimentDir(id: string): string {
    return join(this.goalRoot, 'snapshots', id);
  }

  private metaPath(id: string): string {
    return join(this.goalRoot, 'snapshots', id, 'meta.json');
  }

  private persistMeta(id: string, meta: ExperimentMeta): void {
    const path = this.metaPath(id);
    ensureDir(dirname(path));
    atomicWrite(path, JSON.stringify(meta, null, 2));
  }
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}

function ensureDir(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}

function atomicWrite(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}
