// ── C4 (Phase 3 Bundle 4) — group memory + shell index ──
//
// HANDOFF Phase 3 / ROADMAP §6 C4: "group memory + shell index". 팀 전체가
// 공유하는 shell history/metadata store. 어떤 채널에서 어떤 persona 가
// 어떤 shell 을 spawn 했는지 추적 + 검색.
//
// Pure store — host (sqlite / 외부 KV) 주입. 본 모듈은 in-memory 구현 +
// query API.

export interface ShellGroupRecord {
  readonly shellId: string;
  /** Channel where the shell was spawned (Discord channel id or
   *  elanous session id). */
  readonly channelId: string;
  readonly persona: string;
  /** Verb / command label. */
  readonly verb: string;
  /** Description / args summary (short). */
  readonly description?: string;
  /** ISO timestamp. */
  readonly spawnedAt: string;
  /** ISO timestamp — set on completion. */
  readonly endedAt?: string;
  readonly exitCode?: number;
  readonly outcome?: string;
  /** Optional tail snippet (cap by caller). */
  readonly tail?: string;
}

export interface GroupShellMemoryFilter {
  readonly channelId?: string;
  readonly persona?: string;
  readonly verb?: string;
  /** Records ended after this ISO timestamp. */
  readonly sinceIso?: string;
  /** Records with non-zero exit only. */
  readonly failedOnly?: boolean;
  /** Cap on results. Default 50. */
  readonly limit?: number;
}

export interface GroupShellMemory {
  /** Add new record (on shell spawn). */
  recordSpawn(record: Omit<ShellGroupRecord, 'endedAt' | 'exitCode' | 'outcome' | 'tail'>): void;
  /** Update on completion. */
  recordEnd(shellId: string, end: { endedAt: string; exitCode?: number; outcome?: string; tail?: string }): boolean;
  /** Snapshot. */
  list(filter?: GroupShellMemoryFilter): readonly ShellGroupRecord[];
  /** Get by id. */
  get(shellId: string): ShellGroupRecord | null;
  /** Diagnostic — total record count. */
  size(): number;
  /** Drop records older than `keepAfterIso`. Returns dropped count. */
  prune(keepAfterIso: string): number;
}

const DEFAULT_LIMIT = 50;

export interface GroupShellMemoryOpts {
  /** Hard cap on total records (drops oldest beyond). Default 1000. */
  readonly cap?: number;
}

export function createGroupShellMemory(opts: GroupShellMemoryOpts = {}): GroupShellMemory {
  const records: ShellGroupRecord[] = [];
  const byId = new Map<string, ShellGroupRecord>();
  const cap = opts.cap ?? 1000;

  const evictBeyondCap = (): void => {
    while (records.length > cap) {
      const removed = records.shift();
      if (removed) byId.delete(removed.shellId);
    }
  };

  return {
    recordSpawn(record) {
      const full: ShellGroupRecord = { ...record };
      records.push(full);
      byId.set(full.shellId, full);
      evictBeyondCap();
    },
    recordEnd(shellId, end) {
      const existing = byId.get(shellId);
      if (!existing) return false;
      const updated: ShellGroupRecord = {
        ...existing,
        endedAt: end.endedAt,
        ...(end.exitCode !== undefined ? { exitCode: end.exitCode } : {}),
        ...(end.outcome !== undefined ? { outcome: end.outcome } : {}),
        ...(end.tail !== undefined ? { tail: end.tail } : {}),
      };
      byId.set(shellId, updated);
      const idx = records.findIndex((r) => r.shellId === shellId);
      if (idx >= 0) records[idx] = updated;
      return true;
    },
    list(filter = {}) {
      const limit = filter.limit ?? DEFAULT_LIMIT;
      const sinceMs = filter.sinceIso ? new Date(filter.sinceIso).getTime() : -Infinity;
      const out: ShellGroupRecord[] = [];
      // Walk newest → oldest.
      for (let i = records.length - 1; i >= 0; i -= 1) {
        const r = records[i]!;
        if (filter.channelId && r.channelId !== filter.channelId) continue;
        if (filter.persona && r.persona !== filter.persona) continue;
        if (filter.verb && r.verb !== filter.verb) continue;
        if (filter.failedOnly && (r.exitCode === undefined || r.exitCode === 0)) continue;
        if (sinceMs > -Infinity) {
          const endMs = r.endedAt ? new Date(r.endedAt).getTime() : new Date(r.spawnedAt).getTime();
          if (endMs < sinceMs) continue;
        }
        out.push(r);
        if (out.length >= limit) break;
      }
      return out;
    },
    get(shellId) {
      return byId.get(shellId) ?? null;
    },
    size() {
      return records.length;
    },
    prune(keepAfterIso) {
      const cutoff = new Date(keepAfterIso).getTime();
      let dropped = 0;
      while (records.length > 0) {
        const oldest = records[0]!;
        const ts = oldest.endedAt
          ? new Date(oldest.endedAt).getTime()
          : new Date(oldest.spawnedAt).getTime();
        if (ts >= cutoff) break;
        records.shift();
        byId.delete(oldest.shellId);
        dropped += 1;
      }
      return dropped;
    },
  };
}
