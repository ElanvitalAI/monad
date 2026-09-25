#!/usr/bin/env bun
// ── DocOps P1 · 문서 큐레이션 CLI (2026-07-13) ───────────────────────────────
// 감지(제안 생성)와 적용(HITL 후)을 분리한 2단 CLI.
//
//   bun scripts/doc-curate.ts                      # 감지 → 제안 md+json (~/.monad/doc-curation/)
//   bun scripts/doc-curate.ts --apply <json> [--only archive|supersede-mark]
//                                                  # 검토 끝난 제안 실행 (워킹트리 변경만·커밋 없음)
//
// 원칙: 삭제 금지·아카이브만·참조 문서 자동 배제(blocked). PLAN §4 P1 / §5 자율성 경계.

import { scanDocs, parseIndexLinks } from '../src/autopilot/discovery/doc-inventory.js';
import { buildCurationProposal, renderProposalMd, type CurationAction, type CurationProposal } from '../src/autopilot/discovery/doc-curation.js';
import { applyCurationProposal } from '../src/autopilot/discovery/doc-curation-apply.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const argv = process.argv.slice(2);

function argOf(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const applyPath = argOf('--apply');
if (applyPath) {
  const proposal = JSON.parse(readFileSync(applyPath, 'utf-8')) as CurationProposal;
  // 'supersede-mark' 는 v2 큐레이션에서 CurationAction 'update' 로 개명 — 레거시 플래그 별칭 유지.
  const onlyArg = argOf('--only');
  const only: CurationAction | undefined =
    onlyArg === 'supersede-mark' || onlyArg === 'update' ? 'update'
      : onlyArg === 'archive' ? 'archive'
        : undefined;
  const r = applyCurationProposal(proposal, { repoRoot, ...(only ? { only } : {}) });
  console.log(`적용 완료 — supersede 마킹 ${r.marked} · 아카이브 이동 ${r.archived} · 스킵 ${r.skipped.length}`);
  for (const s of r.skipped.slice(0, 20)) console.log(`  skip ${s.path} — ${s.why}`);
  if (r.skipped.length > 20) console.log(`  … 외 ${r.skipped.length - 20}건`);
  console.log('워킹트리 변경만 수행 — git diff 검토 후 커밋/PR 하세요.');
  process.exit(0);
}

// 감지 — 제안 생성 (READ-ONLY)
const entries = scanDocs(join(repoRoot, 'docs'));
const indexPath = join(repoRoot, 'docs', '_index.md');
const indexLinks = parseIndexLinks(require('node:fs').readFileSync(indexPath, 'utf-8'));
const proposal = buildCurationProposal(entries, { repoRoot, indexLinks });
const outDir = join(homedir(), '.monad', 'doc-curation');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toLocaleDateString('sv-SE');
const jsonPath = join(outDir, `PROPOSAL-${stamp}.json`);
const mdPath = join(outDir, `PROPOSAL-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(proposal, null, 2));
writeFileSync(mdPath, renderProposalMd(proposal));

const marks = proposal.items.filter((i) => i.action === 'update').length;
const arch = proposal.items.filter((i) => i.action === 'archive' && !i.blocked).length;
const blocked = proposal.items.filter((i) => !!i.blocked).length;
console.log(`문서 큐레이션 제안 생성 — 스캔 ${proposal.scanned} · supersede ${marks} · 아카이브 가능 ${arch} · 참조 배제 ${blocked}`);
console.log(`  검토: ${mdPath}`);
console.log(`  적용: bun scripts/doc-curate.ts --apply ${jsonPath} [--only supersede-mark|archive]`);
