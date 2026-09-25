// SAM (Session · Artifact · Memory) coordinator — cascade-zyu W2 Y0.
// 5-store facade: session · memory · blob · acp · knowledge. Y0 lands the
// interface + a thin delegation skeleton; Patcher (W5 Y3) wires real backends.

import type { Pack } from '../knowledge/kgs/index.js';
import type { KnowledgeCard } from '../knowledge/kgs/index.js';

export type SamStoreId = 'session' | 'memory' | 'blob' | 'acp' | 'knowledge';

export const SAM_STORE_IDS: readonly SamStoreId[] = [
  'session', 'memory', 'blob', 'acp', 'knowledge',
];

export interface SamSessionRef { sessionId: string }
export interface SamMemoryRef { name: string }
export interface SamBlobRef { blobId: string }
export interface SamAcpRef { acpSessionId: string }
export interface SamKnowledgeRef { cardId: string }

export type SamRef =
  | ({ store: 'session' } & SamSessionRef)
  | ({ store: 'memory' } & SamMemoryRef)
  | ({ store: 'blob' } & SamBlobRef)
  | ({ store: 'acp' } & SamAcpRef)
  | ({ store: 'knowledge' } & SamKnowledgeRef);

export function refKey(ref: SamRef): string {
  switch (ref.store) {
    case 'session':   return `session:${ref.sessionId}`;
    case 'memory':    return `memory:${ref.name}`;
    case 'blob':      return `blob:${ref.blobId}`;
    case 'acp':       return `acp:${ref.acpSessionId}`;
    case 'knowledge': return `knowledge:${ref.cardId}`;
  }
}

/** Lifecycle posture — routes eviction / archive decisions across the 5 stores. */
export type SamLifecycle =
  | 'transient'   // evict on session close
  | 'session'     // dropped at archive
  | 'durable'     // long-lived per-user
  | 'shared'      // cross-user / team
  | 'public';     // marketplace

export const SAM_LIFECYCLES: readonly SamLifecycle[] = [
  'transient', 'session', 'durable', 'shared', 'public',
];

export interface SamProbeRecord {
  store: SamStoreId;
  op: 'read' | 'write' | 'list' | 'pack-read' | 'pack-write';
  refKey?: string;
  ts: number;
}

/** In-memory probe for tests + dogfood — production wires to MSS M3 Signal Bus (W3 Y1). */
export class SamProbe {
  private records: SamProbeRecord[] = [];

  record(rec: Omit<SamProbeRecord, 'ts'>): void {
    this.records.push({ ...rec, ts: Date.now() });
  }

  snapshot(): readonly SamProbeRecord[] {
    return [...this.records];
  }

  clear(): void { this.records = []; }
}

/** Concrete per-store delegates — each optional. Reads default to null, writes to no-op (probe still records intent). */
export interface SamDelegates {
  session?: {
    read(ref: SamSessionRef): Promise<unknown | null>;
    write(ref: SamSessionRef, value: unknown): Promise<void>;
  };
  memory?: {
    read(ref: SamMemoryRef): Promise<unknown | null>;
    write(ref: SamMemoryRef, value: unknown): Promise<void>;
  };
  blob?: {
    read(ref: SamBlobRef): Promise<Uint8Array | null>;
    write(ref: SamBlobRef, value: Uint8Array): Promise<void>;
  };
  acp?: {
    read(ref: SamAcpRef): Promise<unknown | null>;
    write(ref: SamAcpRef, value: unknown): Promise<void>;
  };
  knowledge?: {
    read(ref: SamKnowledgeRef): Promise<KnowledgeCard | null>;
    write(card: KnowledgeCard): Promise<void>;
    readPack(slug: string, version: string): Promise<Pack | null>;
    writePack(pack: Pack): Promise<void>;
  };
}

export interface SamCoordinatorOptions {
  delegates?: SamDelegates;
  probe?: SamProbe;
}

export class SamCoordinator {
  private delegates: SamDelegates;
  private probe: SamProbe | null;

  constructor(opts: SamCoordinatorOptions = {}) {
    this.delegates = opts.delegates ?? {};
    this.probe = opts.probe ?? null;
  }

  async read(ref: SamRef): Promise<unknown | null> {
    this.probe?.record({ store: ref.store, op: 'read', refKey: refKey(ref) });
    switch (ref.store) {
      case 'session':   return this.delegates.session?.read(ref) ?? null;
      case 'memory':    return this.delegates.memory?.read(ref) ?? null;
      case 'blob':      return this.delegates.blob?.read(ref) ?? null;
      case 'acp':       return this.delegates.acp?.read(ref) ?? null;
      case 'knowledge': return this.delegates.knowledge?.read(ref) ?? null;
    }
  }

  async readKnowledgeCard(cardId: string): Promise<KnowledgeCard | null> {
    return (await this.read({ store: 'knowledge', cardId })) as KnowledgeCard | null;
  }

  async readPack(slug: string, version: string): Promise<Pack | null> {
    this.probe?.record({
      store: 'knowledge',
      op: 'pack-read',
      refKey: `pack:${slug}@${version}`,
    });
    return this.delegates.knowledge?.readPack(slug, version) ?? null;
  }

  async writeKnowledgeCard(card: KnowledgeCard): Promise<void> {
    this.probe?.record({
      store: 'knowledge',
      op: 'write',
      refKey: `knowledge:${card.id}`,
    });
    await this.delegates.knowledge?.write(card);
  }

  async writePack(pack: Pack): Promise<void> {
    const { slug, version } = pack.metadata.id;
    this.probe?.record({
      store: 'knowledge',
      op: 'pack-write',
      refKey: `pack:${slug}@${version}`,
    });
    await this.delegates.knowledge?.writePack(pack);
  }

  wiredStores(): readonly SamStoreId[] {
    const out: SamStoreId[] = [];
    if (this.delegates.session) out.push('session');
    if (this.delegates.memory) out.push('memory');
    if (this.delegates.blob) out.push('blob');
    if (this.delegates.acp) out.push('acp');
    if (this.delegates.knowledge) out.push('knowledge');
    return out;
  }
}
