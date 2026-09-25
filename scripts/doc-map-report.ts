#!/usr/bin/env bun
// ── DocOps P0 · 주간 문서맵 갭 리포트 (2026-07-13) ───────────────────────────
// se-doc-map(READ-ONLY 감지)을 주기화 — docs/ 실태·갭을 주 1회 텔레그램
// report 채널로. 파일 생성/이동/삭제 없음(정리 실행은 P1 정리 루프 소관·HITL).
//
// cron: 0 9 * * 1 (KST 월요일 아침) — `monad schedule` registry 관리.
// 사용: bun scripts/doc-map-report.ts [--dry-run]  (dry-run = 콘솔만·발송 안 함)
//
// PLAN: 내부 문서 `PLAN-doc-knowledge-infra-overhaul-2026-07-13` §4 P0.

import { scanDocs, parseIndexLinks, indexGaps, staleScore } from '../src/autopilot/discovery/doc-inventory.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const docsDir = join(repoRoot, 'docs');

const entries = scanDocs(docsDir); // _archive/_superseded 제외
let totalAllMd = 0;
try {
  totalAllMd = Number(execFileSync('bash', ['-c', `find ${docsDir} -name '*.md' | wc -l`], { encoding: 'utf-8' }).trim()) || 0;
} catch { /* 참고 지표 — 실패 무해 */ }

const indexPath = join(docsDir, '_index.md');
const indexLinks = existsSync(indexPath) ? parseIndexLinks(readFileSync(indexPath, 'utf-8')) : new Set<string>();
const gaps = indexGaps(entries, indexLinks);

// prefix 분포 상위
const byPrefix = new Map<string, number>();
for (const e of entries) byPrefix.set(e.prefix, (byPrefix.get(e.prefix) ?? 0) + 1);
const prefixTop = [...byPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  .map(([p, n]) => `${p} ${n}`).join(' · ');

// stale 상위 (오래됨+미완 체크박스 가중 — doc-inventory staleScore)
const nowMs = Date.now();
const staleTop = entries
  .map((e) => ({ e, score: staleScore(e, nowMs) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);

const openBoxTotal = entries.reduce((a, e) => a + e.openBoxes, 0);

const lines = [
  `📚 주간 문서맵 리포트 (DocOps P0)`,
  `총 ${entries.length}개 (루트 활성 · 전체 트리 ${totalAllMd}) — ${prefixTop}`,
  `⚠️ trailhead(_index) 미등록: ${gaps.length}개 · 미완 체크박스: ${openBoxTotal}개`,
  ``,
  `🕸 stale 상위 5 (오래됨+미완 가중):`,
  ...staleTop.map(({ e, score }, i) => `${i + 1}. ${e.filename} (score ${score.toFixed(1)} · 미완 ${e.openBoxes})`),
  ``,
  `상세 맵: bun scripts/se-doc-map.ts · 정리 실행은 P1 정리 루프(HITL) 예정`,
];
const msg = lines.join('\n');

if (process.argv.includes('--dry-run')) {
  console.log(msg);
  console.log('\n[dry-run — 발송 안 함]');
  process.exit(0);
}

const sent = sendOutbound(msg, 'report');
console.log(sent ? `doc-map 리포트 발송 완료 (${entries.length}개 스캔 · 갭 ${gaps.length})` : 'doc-map 리포트 발송 실패 — 콘솔 폴백:\n' + msg);
