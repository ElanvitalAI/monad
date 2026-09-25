// ── R3 후속 · Conatus 소급 인제스트 1회 스크립트 (2026-07-07) ──
//
// openclaw 시절 X 데일리 리포트(~92) + 아침 종합 리포트(~91) md 아카이브를
// knowledge.db로 영속. 멱등 — 재실행 안전. 크론 아님(아카이브는 더 안 자람).
//
//   bun scripts/knowledge-backfill-conatus.ts [--dry]
//
// --dry: 대상 파일/청크 수만 집계(임베딩·삽입 없음).

import { openKnowledgeDb, backfillConatusReports, knowledgeStats, type EmbedFn } from '../src/domains/knowledge.js';

const dry = process.argv.includes('--dry');

const db = openKnowledgeDb();
try {
  const before = knowledgeStats(db);
  console.log(`[backfill] 시작 — 기존 코퍼스 ${before.total}건 (${before.byKind.map(k => `${k.kind} ${k.n}`).join(' · ')})`);

  const dryEmbed: EmbedFn = async () => ({ vector: new Float32Array(768), model: 'dry-run' });
  const t0 = Date.now();
  const counts = await backfillConatusReports(db, dry ? { embed: dryEmbed } : {});
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`[backfill] ${dry ? '(dry) ' : ''}xreport +${counts.xreport} · morning +${counts.morning} · skipped ${counts.skipped} · 파일유실 ${counts.missingFiles} · ${secs}s`);
  if (dry) {
    // dry 삽입분 롤백 — dry-run 모델 공간 오염 방지
    db.run(`DELETE FROM docs WHERE embed_model = 'dry-run'`);
    console.log('[backfill] dry-run 행 롤백 완료');
  }
  const after = knowledgeStats(db);
  console.log(`[backfill] 코퍼스 ${after.total}건 (${after.byKind.map(k => `${k.kind} ${k.n}`).join(' · ')})`);
} finally {
  db.close();
}
