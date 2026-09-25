// ── 온톨로지 아침 브리핑 섹션 (추천2 · 2026-07-08) ────────────────────────
//
// morning-report 에 온톨로지 통찰 주입: 미국→한국 전파(lead-lag)·P7↔M7 로테이션·
// 반도체 등 핵심 체인. graph read-only. 빈 그래프면 '' (fail-soft·리포트 불변).

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { knowledgeDbPath } from './knowledge.js';
import { openKgDb, getEdges, getNode, listNodes } from './kg-store.js';
import { dedupEdges } from './kg-semis.js';

const tickerName = (db: Database, id: string): string => getNode(db, id)?.name ?? id.split(':').slice(1).join(':');

/** 온톨로지 아침 섹션 문자열. db 미지정 시 실 knowledge.db. 없으면 ''. */
export function renderOntologyMorning(opts: { db?: Database } = {}): string {
  if (!opts.db && !existsSync(knowledgeDbPath())) return '';
  const db = opts.db ?? openKgDb();
  const shouldClose = !opts.db;
  try {
    if (!listNodes(db, { kind: 'chain' }).length) return '';
    const lines: string[] = ['\n🕸 *온톨로지* (구조·인과)'];

    // 1) 미국→한국 전파 top(측정 correlates·batch·US 선행)
    //    dedupEdges: 같은 (src,dst) 쌍이 여러 validAt 으로 저장돼 중복 출력되던 버그 수정.
    const cross = dedupEdges(
      getEdges(db, { relation: 'correlates', activeOnly: true })
        .filter(e => e.sourceRef === 'batch:leadlag' && Math.abs(e.weight ?? 0) >= 0.6),
    )
      .sort((a, b) => Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0))
      .slice(0, 4);
    if (cross.length) {
      lines.push('  📡 미국→한국 전파(lead-lag):');
      for (const e of cross) {
        const dir = (e.weight ?? 0) > 0 ? '동조' : '역행';
        lines.push(`    ${tickerName(db, e.src)}→${tickerName(db, e.dst)} ${dir} ${e.weight}·${e.leadLag ?? 0}일 선행`);
      }
    }

    // 2) P7↔M7 로테이션(측정 있으면)
    const p7m7 = getEdges(db, { src: 'group:P7', dst: 'group:M7', relation: 'correlates', activeOnly: true }).sort((a, b) => (b.validAt).localeCompare(a.validAt))[0];
    if (p7m7 && p7m7.weight != null) {
      const rel = p7m7.weight < 0 ? '역관계(공급 vs 빅테크 로테이션)' : '동조';
      lines.push(`  ⚔ P7(반도체공급)↔M7(빅테크): ${rel} ${p7m7.weight}`);
    }

    return lines.length > 1 ? lines.join('\n') : '';
  } catch { return ''; } finally { if (shouldClose) db.close(); }
}
