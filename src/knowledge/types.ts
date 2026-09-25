// ── PFC-S4.2 + S4.3 types ──

export type KnowledgeKind =
  | 'all'
  | 'rca'
  | 'a3'
  | 'incident'
  | 'wiki'
  | 'repomap'
  | 'note';

export interface KnowledgeNote {
  /** Absolute filesystem path. */
  path: string;
  /** Vault-relative path with forward slashes. */
  relPath: string;
  frontmatter: Record<string, unknown>;
  /** First 300 chars of body OR fulltext match context (±200 chars). */
  excerpt: string;
  /** Full body — only when caller requested include_body. */
  body?: string;
}

export interface KnowledgeQueryInput {
  tags?: readonly string[];       // AND — all must be present
  fulltext?: string;              // regex pattern
  kind?: KnowledgeKind;
  limit?: number;                 // default 20, max 100
  offset?: number;
  include_body?: boolean;
}

export interface KnowledgeQueryResult {
  results: KnowledgeNote[];
  total: number;                  // pre-offset/limit total match count
  truncated: boolean;
}

export interface KnowledgeWriteInput {
  rel_path: string;               // vault-relative; validated
  body: string;                   // markdown body (no frontmatter)
  frontmatter?: Record<string, unknown>;
  kind?: Exclude<KnowledgeKind, 'all'>;
  tags?: readonly string[];
  overwrite?: boolean;            // default false
  strict_schema?: boolean;        // default true
}

export type KnowledgeWriteResult =
  | { ok: true; path: string; relPath: string }
  | {
      ok: false;
      reasonOneLine: string;
      errors: Array<{ path: string[]; message: string; code: string }>;
    };
