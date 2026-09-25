#!/usr/bin/env bun
// ── Self-Evolution SE0 · 문서 종합맵 생성 (2026-07-09) ─────────────────────
// docs/ 스캔 → 성격 포함 종합맵 → 내부 문서 `MAP-doc-inventory-<date>` 기록.
// READ-ONLY 스캔(파일 이동/삭제 없음). 사용: bun scripts/se-doc-map.ts [--write]

import { scanDocs, parseIndexLinks } from '../src/autopilot/discovery/doc-inventory.js';
import { buildDocMap } from '../src/autopilot/discovery/doc-map.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const docsDir = join(repoRoot, 'docs');

// 전체 트리(아카이브 포함) 개수 — 참고용.
let totalAllMd = 0;
try { totalAllMd = execFileSync('bash', ['-c', `find ${docsDir} -name '*.md' | wc -l`], { encoding: 'utf-8' }).trim().split(/\s+/).map(Number).pop() ?? 0; } catch { /* */ }

// _index.md(trailhead) 링크 집합 — §7 미등록 갭 감지용.
const indexPath = join(docsDir, '_index.md');
const indexLinks = existsSync(indexPath) ? parseIndexLinks(readFileSync(indexPath, 'utf-8')) : new Set<string>();

const entries = scanDocs(docsDir); // _archive/_superseded 제외
const nowMs = Date.now();
const dateLabel = new Date().toLocaleDateString('sv-SE'); // 로컬(KST) YYYY-MM-DD — 하드코딩 제거·UTC 어긋남 방지
const md = buildDocMap(entries, { nowMs, totalAllMd, dateLabel, indexLinks });

const write = process.argv.includes('--write');
if (write) {
  const out = join(docsDir, `MAP-doc-inventory-${dateLabel}.md`);
  writeFileSync(out, md + '\n');
  console.log(`문서 종합맵 기록: ${out} (스캔 ${entries.length}개 · trailhead 링크 ${indexLinks.size})`);
} else {
  console.log(md);
  console.error(`\n[미리보기 · --write 로 docs/MAP-${dateLabel}.md 기록] 스캔 ${entries.length}개 · trailhead 링크 ${indexLinks.size}`);
}
