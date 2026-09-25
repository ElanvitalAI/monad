import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { hybridQueryKnowledge, ingestDocFile, ingestDocsDir, openKnowledgeDb, queryKnowledge, type EmbedFn } from '../src/domains/knowledge.js';

const embed: EmbedFn = async () => ({ vector: new Float32Array([1, 2, 3]), model: 'test-model' });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-doc-path-key-'));
  const dbPath = join(root, 'knowledge.db');
  return { root, dbPath, close: (db: Database) => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

describe('knowledge document path keys', () => {
  test('keeps same-basename documents from distinct trees and directories', async () => {
    const f = fixture();
    const treeA = join(f.root, 'pilot', 'docs');
    const treeB = join(f.root, 'axon', 'docs');
    mkdirSync(treeA, { recursive: true });
    mkdirSync(treeB, { recursive: true });
    const a = join(treeA, 'PLAN-shared.md');
    const b = join(treeB, 'PLAN-shared.md');
    writeFileSync(a, '# pilot document');
    writeFileSync(b, '# axon document');
    const db = openKnowledgeDb(f.dbPath);

    await ingestDocFile(db, { path: a, embed });
    await ingestDocFile(db, { path: b, embed });

    const rows = db.prepare(`SELECT id, source_ref, text FROM docs WHERE kind = 'docs' ORDER BY source_ref`).all() as Array<{ id: string; source_ref: string; text: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.source_ref)).toEqual([resolve(b), resolve(a)].sort());
    expect(new Set(rows.map(row => row.id)).size).toBe(2);
    expect(rows.every(row => row.id.includes(row.source_ref))).toBe(true);
    expect(await queryKnowledge(db, 'document', { embed, kind: 'docs', k: 2 })).toHaveLength(2);
    expect(await hybridQueryKnowledge(db, 'document', { embed, kind: 'docs', k: 2 })).toHaveLength(2);
    f.close(db);
  });

  test('defaults to recursive doc-lint taxonomy, excludes archives, and preserves same basenames', async () => {
    const f = fixture();
    const docs = join(f.root, 'docs');
    const nested = join(docs, 'feature');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(docs, '_archive'), { recursive: true });
    mkdirSync(join(docs, 'archive'), { recursive: true });
    mkdirSync(join(docs, '_superseded'), { recursive: true });
    writeFileSync(join(docs, 'PLAN-shared.md'), '# root plan');
    writeFileSync(join(nested, 'PLAN-shared.md'), '# nested plan');
    writeFileSync(join(nested, 'MANUAL-nested.md'), '# nested manual');
    writeFileSync(join(nested, 'FINDING-observation.md'), '# nested finding');
    writeFileSync(join(nested, 'MEASUREMENT-observation.md'), '# nested measurement');
    writeFileSync(join(nested, 'SCENARIO-outside-taxonomy.md'), '# outside taxonomy');
    writeFileSync(join(docs, '_archive', 'PLAN-archived.md'), '# archived');
    writeFileSync(join(docs, 'archive', 'REPORT-archived.md'), '# archived');
    writeFileSync(join(docs, '_superseded', 'FEATURE-superseded.md'), '# superseded');
    const db = openKnowledgeDb(f.dbPath);

    const first = await ingestDocsDir(db, { dir: docs, embed });
    expect(first.files).toBe(5);
    expect(first.chunks).toBe(5);
    const rows = db.prepare(`SELECT source_ref FROM docs WHERE kind = 'docs' ORDER BY source_ref`).all() as Array<{ source_ref: string }>;
    expect(rows.map(row => row.source_ref)).toEqual([
      resolve(docs, 'PLAN-shared.md'),
      resolve(nested, 'FINDING-observation.md'),
      resolve(nested, 'MANUAL-nested.md'),
      resolve(nested, 'MEASUREMENT-observation.md'),
      resolve(nested, 'PLAN-shared.md'),
    ]);
    expect(new Set(rows.map(row => row.source_ref)).size).toBe(5);

    const callsBeforeUnchanged = first.chunks;
    const second = await ingestDocsDir(db, { dir: docs, embed: async (text) => {
      throw new Error(`unchanged file was re-embedded: ${text}`);
    } });
    expect(second).toMatchObject({ chunks: 0, unchanged: 5 });
    expect(callsBeforeUnchanged).toBe(5);

    const explicit = await ingestDocsDir(db, { dir: nested, pattern: /^SCENARIO-.*\.md$/i, embed });
    expect(explicit.files).toBe(1);
    f.close(db);
  });

  test('migrates absolute legacy ids, FTS, and uniquely matched state in place without changing embeddings', () => {
    const f = fixture();
    const source = join(f.root, 'ingest-tree', 'docs', 'PLAN-legacy.md');
    const originalEmbedding = new Uint8Array(new Float32Array([9, 8, 7]).buffer);
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.run(`CREATE TABLE docs_ingest_state(file TEXT PRIMARY KEY, mtime_ms INTEGER NOT NULL, chunk_count INTEGER NOT NULL, ingested_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`)
      .run('docs:PLAN-legacy.md#0', '2026-07-01T00:00:00.000Z', 'legacy text', source, originalEmbedding);
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run('docs:PLAN-legacy.md#0', 'legacy text');
    db.prepare(`INSERT INTO docs_ingest_state VALUES (?, 1, 1, ?)`)
      .run('PLAN-legacy.md', '2026-07-01T00:00:00.000Z');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    const expectedId = `docs:${source}#0`;
    const once = db.prepare(`SELECT id, source_ref, embedding FROM docs`).get() as { id: string; source_ref: string; embedding: Uint8Array };
    expect({ id: once.id, source_ref: once.source_ref }).toEqual({ id: expectedId, source_ref: source });
    expect(Array.from(once.embedding)).toEqual(Array.from(originalEmbedding));
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: expectedId });
    expect(db.prepare(`SELECT file FROM docs_ingest_state`).get()).toEqual({ file: source });
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM docs`).get()).toEqual({ count: 1 });
    expect(db.prepare(`SELECT file FROM docs_ingest_state`).get()).toEqual({ file: source });
    f.close(db);
  });

  test('migrates Windows absolute legacy ids and state keys in place', () => {
    const f = fixture();
    const source = 'C:\\monad\\pilot\\docs\\PLAN-windows.md';
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.run(`CREATE TABLE docs_ingest_state(file TEXT PRIMARY KEY, mtime_ms INTEGER NOT NULL, chunk_count INTEGER NOT NULL, ingested_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`)
      .run('docs:PLAN-windows.md#0', '2026-07-01T00:00:00.000Z', 'Windows legacy text', source, new Uint8Array([9, 8, 7]));
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run('docs:PLAN-windows.md#0', 'Windows legacy text');
    db.prepare(`INSERT INTO docs_ingest_state VALUES (?, 1, 1, ?)`)
      .run('PLAN-windows.md', '2026-07-01T00:00:00.000Z');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id FROM docs`).get()).toEqual({ id: `docs:${source}#0` });
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: `docs:${source}#0` });
    expect(db.prepare(`SELECT file FROM docs_ingest_state`).get()).toEqual({ file: source });
    f.close(db);
  });

  test('preserves relative source_ref and state because migration provenance is unrecoverable', () => {
    const f = fixture();
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.run(`CREATE TABLE docs_ingest_state(file TEXT PRIMARY KEY, mtime_ms INTEGER NOT NULL, chunk_count INTEGER NOT NULL, ingested_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`)
      .run('docs:legacy-relative-doc.md#0', '2026-07-01T00:00:00.000Z', 'legacy text', 'legacy-relative-doc.md', new Uint8Array([9, 8, 7]));
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run('docs:legacy-relative-doc.md#0', 'legacy text');
    db.prepare(`INSERT INTO docs_ingest_state VALUES (?, 1, 1, ?)`)
      .run('legacy-relative-doc.md', '2026-07-01T00:00:00.000Z');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id, source_ref FROM docs`).get()).toEqual({ id: 'docs:legacy-relative-doc.md#0', source_ref: 'legacy-relative-doc.md' });
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: 'docs:legacy-relative-doc.md#0' });
    expect(db.prepare(`SELECT file FROM docs_ingest_state`).get()).toEqual({ file: 'legacy-relative-doc.md' });
    f.close(db);
  });

  test('leaves already path-keyed document ids unchanged during migration', () => {
    const f = fixture();
    const source = join(f.root, 'ingest-tree', 'docs', 'PLAN-current.md');
    const currentId = `docs:${source}#0`;
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`)
      .run(currentId, '2026-07-01T00:00:00.000Z', 'current text', source, new Uint8Array([1, 2, 3]));
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run(currentId, 'current text');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id FROM docs`).get()).toEqual({ id: currentId });
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: currentId });
    f.close(db);
  });

  test('preserves both rows and state keys when a path-key collision has different content or embeddings', () => {
    const f = fixture();
    const source = join(f.root, 'ingest-tree', 'docs', 'PLAN-collision.md');
    const targetId = `docs:${source}#0`;
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.run(`CREATE TABLE docs_ingest_state(file TEXT PRIMARY KEY, mtime_ms INTEGER NOT NULL, chunk_count INTEGER NOT NULL, ingested_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`).run('docs:PLAN-collision.md#0', '2026-07-01T00:00:00.000Z', 'legacy text', source, new Uint8Array([1, 2, 3]));
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`).run(targetId, '2026-07-01T00:00:00.000Z', 'different text', source, new Uint8Array([4, 5, 6]));
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run('docs:PLAN-collision.md#0', 'legacy text');
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run(targetId, 'different text');
    db.prepare(`INSERT INTO docs_ingest_state VALUES (?, 1, 1, ?)`).run('PLAN-collision.md', '2026-07-01T00:00:00.000Z');
    db.prepare(`INSERT INTO docs_ingest_state VALUES (?, 2, 1, ?)`).run(source, '2026-07-02T00:00:00.000Z');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(new Set((db.prepare(`SELECT id FROM docs`).all() as Array<{ id: string }>).map(row => row.id))).toEqual(new Set(['docs:PLAN-collision.md#0', targetId]));
    expect(new Set((db.prepare(`SELECT id FROM docs_fts`).all() as Array<{ id: string }>).map(row => row.id))).toEqual(new Set(['docs:PLAN-collision.md#0', targetId]));
    expect(new Set((db.prepare(`SELECT file FROM docs_ingest_state`).all() as Array<{ file: string }>).map(row => row.file))).toEqual(new Set(['PLAN-collision.md', source]));
    f.close(db);
  });

  test('merges a collision only when every stored document field and embedding match', () => {
    const f = fixture();
    const source = join(f.root, 'ingest-tree', 'docs', 'PLAN-duplicate.md');
    const targetId = `docs:${source}#0`;
    const embedding = new Uint8Array([1, 2, 3]);
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    for (const id of ['docs:PLAN-duplicate.md#0', targetId]) {
      db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`).run(id, '2026-07-01T00:00:00.000Z', 'same text', source, embedding);
      db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run(id, 'same text');
    }
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id, embedding FROM docs`).all()).toHaveLength(1);
    expect(db.prepare(`SELECT id FROM docs`).get()).toEqual({ id: targetId });
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: targetId });
    f.close(db);
  });

  test('moves legacy FTS onto the target id when a merged target has no FTS row', async () => {
    const f = fixture();
    const source = join(f.root, 'ingest-tree', 'docs', 'PLAN-partial-fts.md');
    const targetId = `docs:${source}#0`;
    const embedding = new Uint8Array(new Float32Array([1, 2, 3]).buffer);
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    for (const id of ['docs:PLAN-partial-fts.md#0', targetId]) {
      db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`).run(id, '2026-07-01T00:00:00.000Z', 'searchable text', source, embedding);
    }
    // 부분 마이그레이션 — 대상 docs 행은 있지만 대상 FTS 행은 없고, 레거시만 FTS 색인됨.
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run('docs:PLAN-partial-fts.md#0', 'searchable text');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id FROM docs`).all()).toEqual([{ id: targetId }]);
    expect(db.prepare(`SELECT id FROM docs_fts`).all()).toEqual([{ id: targetId }]);
    const found = await hybridQueryKnowledge(db, 'searchable', { embed, kind: 'docs', k: 2 });
    expect(found.map(m => m.id)).toContain(targetId);
    f.close(db);
  });

  test('leaves arbitrary non-doc-prefixed basename ids from other pipelines unchanged', () => {
    const f = fixture();
    const source = join(f.root, 'alpha-reports', '2026-07-01-weekly.md');
    const alphaId = 'alpha:2026-07-01-weekly.md#0';
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'alpha', NULL, ?, ?, 'test-model', ?, 'finance')`)
      .run(alphaId, '2026-07-01T00:00:00.000Z', 'alpha text', source, new Uint8Array([1, 2, 3]));
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run(alphaId, 'alpha text');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id, source_ref FROM docs`).get()).toEqual({ id: alphaId, source_ref: source });
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: alphaId });
    f.close(db);
  });

  test('leaves legacy docs without source_ref unchanged because their path key is unrecoverable', () => {
    const f = fixture();
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, NULL, 'test-model', ?, 'monad')`)
      .run('docs:unrecoverable.md#0', '2026-07-01T00:00:00.000Z', 'unrecoverable text', new Uint8Array([1, 2, 3]));
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id, source_ref FROM docs`).get()).toEqual({ id: 'docs:unrecoverable.md#0', source_ref: null });
    f.close(db);
  });

  test('records a completion marker and does not rescan on the second open', () => {
    const f = fixture();
    let db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT name FROM knowledge_schema_migrations`).all()).toEqual([{ name: 'doc-path-keys-v1' }]);
    const source = join(f.root, 'tree', 'docs', 'PLAN-late-legacy.md');
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`)
      .run('docs:PLAN-late-legacy.md#0', '2026-07-01T00:00:00.000Z', 'late legacy text', source, new Uint8Array([1, 2, 3]));
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run('docs:PLAN-late-legacy.md#0', 'late legacy text');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    expect(db.prepare(`SELECT id FROM docs`).get()).toEqual({ id: 'docs:PLAN-late-legacy.md#0' });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM knowledge_schema_migrations WHERE name = 'doc-path-keys-v1'`).get()).toEqual({ count: 1 });
    f.close(db);
  });

  test('rolls back docs, FTS, state, and completion marker when migration fails', () => {
    const f = fixture();
    const source = join(f.root, 'tree', 'docs', 'PLAN-rollback.md');
    const legacyId = 'docs:PLAN-rollback.md#0';
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.run(`CREATE TABLE docs_ingest_state(file TEXT PRIMARY KEY, mtime_ms INTEGER NOT NULL, chunk_count INTEGER NOT NULL, ingested_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'docs', NULL, ?, ?, 'test-model', ?, 'monad')`)
      .run(legacyId, '2026-07-01T00:00:00.000Z', 'rollback text', source, new Uint8Array([1, 2, 3]));
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run(legacyId, 'rollback text');
    db.prepare(`INSERT INTO docs_ingest_state VALUES (?, 1, 1, ?)`).run('PLAN-rollback.md', '2026-07-01T00:00:00.000Z');
    db.run(`CREATE TRIGGER fail_path_key BEFORE UPDATE OF id ON docs BEGIN SELECT RAISE(ABORT, 'injected path migration failure'); END`);
    db.close();

    expect(() => openKnowledgeDb(f.dbPath)).toThrow('injected path migration failure');
    db = new Database(f.dbPath);
    expect(db.prepare(`SELECT id FROM docs`).get()).toEqual({ id: legacyId });
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: legacyId });
    expect(db.prepare(`SELECT file FROM docs_ingest_state`).get()).toEqual({ file: 'PLAN-rollback.md' });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_schema_migrations'`).get()).toEqual({ count: 0 });
    f.close(db);
  });

  test('uses kind-specific path ids and migrates non-doc legacy rows without changing embeddings', async () => {
    const f = fixture();
    const source = join(f.root, 'tree', 'memory', 'REPORT-memory.md');
    mkdirSync(join(f.root, 'tree', 'memory'), { recursive: true });
    writeFileSync(source, '# memory document');
    const originalEmbedding = new Uint8Array(new Float32Array([6, 5, 4]).buffer);
    let db = new Database(f.dbPath);
    db.run(`CREATE TABLE docs(id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, sector_tags TEXT, text TEXT NOT NULL, source_ref TEXT, embed_model TEXT NOT NULL, embedding BLOB NOT NULL, domain TEXT)`);
    db.run(`CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, search_text, tokenize = 'porter')`);
    db.prepare(`INSERT INTO docs VALUES (?, ?, 'memory', NULL, ?, ?, 'test-model', ?, 'monad')`)
      .run('docs:REPORT-memory.md#0', '2026-07-01T00:00:00.000Z', 'legacy memory', source, originalEmbedding);
    db.prepare(`INSERT INTO docs_fts VALUES (?, ?)`).run('docs:REPORT-memory.md#0', 'legacy memory');
    db.close();

    db = openKnowledgeDb(f.dbPath);
    const expectedId = `memory:${source}#0`;
    const migrated = db.prepare(`SELECT id, kind, embedding FROM docs`).get() as { id: string; kind: string; embedding: Uint8Array };
    expect({ id: migrated.id, kind: migrated.kind }).toEqual({ id: expectedId, kind: 'memory' });
    expect(Array.from(migrated.embedding)).toEqual(Array.from(originalEmbedding));
    expect(db.prepare(`SELECT id FROM docs_fts`).get()).toEqual({ id: expectedId });

    const secondSource = join(f.root, 'tree', 'memory', 'REPORT-current.md');
    writeFileSync(secondSource, '# current memory');
    await ingestDocFile(db, { path: secondSource, kind: 'memory', embed });
    expect(db.prepare(`SELECT id FROM docs WHERE source_ref = ?`).get(secondSource)).toEqual({ id: `memory:${secondSource}#0` });
    f.close(db);
  });

  test('uses path-keyed incremental state so unchanged files avoid re-embedding', async () => {
    const f = fixture();
    const docs = join(f.root, 'tree', 'docs');
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, 'PLAN-incremental.md'), '# unchanged');
    const db = openKnowledgeDb(f.dbPath);

    const first = await ingestDocsDir(db, { dir: docs, embed });
    const second = await ingestDocsDir(db, { dir: docs, embed });

    expect(first.chunks).toBe(1);
    expect(second).toMatchObject({ chunks: 0, unchanged: 1, refreshed: 0 });
    expect(db.prepare(`SELECT file FROM docs_ingest_state`).get()).toEqual({ file: resolve(docs, 'PLAN-incremental.md') });
    f.close(db);
  });
});
