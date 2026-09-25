// R3 후속 — Conatus 소급 인제스트 (backfillConatusReports). Covers: kind
// 매핑(report_md→xreport · morning_combined_md→morning), 멱등(재실행 0 추가),
// 파일 유실 fail-soft, per-file 청크 캡.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openKnowledgeDb, backfillConatusReports, knowledgeStats, type EmbedFn,
} from '../src/domains/knowledge.js';

const fakeEmbed: EmbedFn = async () => ({ vector: new Float32Array(768).fill(0.5), model: 'test-768' });

let dir: string;
let kdbPath: string;
let xPath: string;

function seedXAssetDb(rows: Array<{ date: string; kind: string; path: string }>): void {
  const xdb = new Database(xPath);
  xdb.run(`CREATE TABLE IF NOT EXISTS raw_artifact(
    date text not null, kind text not null, path text not null, sha256 text,
    primary key (date, kind, path))`);
  const ins = xdb.prepare(`INSERT OR IGNORE INTO raw_artifact(date, kind, path) VALUES (?,?,?)`);
  for (const r of rows) ins.run(r.date, r.kind, r.path);
  xdb.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kb-backfill-'));
  kdbPath = join(dir, 'knowledge.db');
  xPath = join(dir, 'x_asset.db');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('backfillConatusReports', () => {
  test('kind 매핑 + 멱등 + 유실 fail-soft', async () => {
    const rep = join(dir, 'rep.md');
    const morning = join(dir, 'morning.md');
    writeFileSync(rep, '## 헤드라인\nX 데일리 요약.\n## 자산별\n반도체 강세.', 'utf-8');
    writeFileSync(morning, '## 아침 종합\n밤사이 미국 상승.', 'utf-8');
    seedXAssetDb([
      { date: '2026-05-01', kind: 'report_md', path: rep },
      { date: '2026-05-01', kind: 'morning_combined_md', path: morning },
      { date: '2026-05-02', kind: 'report_md', path: join(dir, 'ghost.md') }, // 유실
      { date: '2026-05-01', kind: 'per_query_md', path: rep },               // 대상 외 kind
    ]);
    const db = openKnowledgeDb(kdbPath);
    try {
      const c1 = await backfillConatusReports(db, { xAssetDbPath: xPath, embed: fakeEmbed });
      expect(c1.xreport).toBe(1);
      expect(c1.morning).toBe(1);
      expect(c1.missingFiles).toBe(1);
      expect(c1.skipped).toBe(0);
      const stats = knowledgeStats(db);
      expect(stats.byKind.map(k => k.kind).sort()).toEqual(['morning', 'xreport']);

      // 멱등 — 재실행은 0 추가 (기존 id skip)
      const c2 = await backfillConatusReports(db, { xAssetDbPath: xPath, embed: fakeEmbed });
      expect(c2.xreport + c2.morning).toBe(0);
      expect(knowledgeStats(db).total).toBe(stats.total);
    } finally { db.close(); }
  });

  test('per-file 청크 캡 (maxChunksPerFile)', async () => {
    const big = join(dir, 'big.md');
    // 섹션 40개 × ~2400자 → 캡 없으면 40청크
    writeFileSync(big, Array.from({ length: 40 }, (_, i) => `## S${i}\n${'x'.repeat(2300)}`).join('\n'), 'utf-8');
    seedXAssetDb([{ date: '2026-05-03', kind: 'report_md', path: big }]);
    const db = openKnowledgeDb(kdbPath);
    try {
      const c = await backfillConatusReports(db, { xAssetDbPath: xPath, embed: fakeEmbed, maxChunksPerFile: 3 });
      expect(c.xreport).toBe(3);
    } finally { db.close(); }
  });

  test('x_asset.db 부재 → 전부 0 (no-throw)', async () => {
    const db = openKnowledgeDb(kdbPath);
    try {
      const c = await backfillConatusReports(db, { xAssetDbPath: join(dir, 'none.db'), embed: fakeEmbed });
      expect(c).toEqual({ xreport: 0, morning: 0, skipped: 0, missingFiles: 0 });
    } finally { db.close(); }
  });
});
