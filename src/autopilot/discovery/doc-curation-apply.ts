// ── DocOps P1 · 큐레이션 적용기 (HITL 이후 실행) ─────────────────────────────
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assertCurationProposal, type CurationAction, type CurationItem, type CurationProposal } from './doc-curation.js';

export interface ApplyResult {
  marked: number;
  archived: number;
  snapshots: string[];
  skipped: Array<{ path: string; why: string }>;
}

/** update is append/merge only: it never removes prose or an existing history marker. */
export function markSuperseded(text: string, successorRelPath: string): string {
  if (/^---[\s\S]*?\bstatus:\s*superseded\b[\s\S]*?---/m.test(text.slice(0, 500))) return text;
  const fields = `status: superseded\nsuperseded_by: ${successorRelPath}`;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end > 0) return `${text.slice(0, end)}\n${fields}${text.slice(end)}`;
  }
  return `---\n${fields}\n---\n\n${text}`;
}

function snapshotBefore(repoRoot: string, proposal: CurationProposal, item: CurationItem, source: string): string {
  const dir = join(repoRoot, '.docops-history', proposal.idempotencyKey);
  mkdirSync(dir, { recursive: true });
  const snapshot = join(dir, `${basename(item.path)}.before`);
  if (!existsSync(snapshot)) writeFileSync(snapshot, source);
  return snapshot;
}

/** Applies only representative-approved update/archive items; add has no automatic write path. */
export function applyCurationProposal(
  proposal: CurationProposal,
  opts: { repoRoot?: string; archiveDir?: string; only?: CurationAction } = {},
): ApplyResult {
  assertCurationProposal(proposal);
  if (proposal.status !== 'approved' || proposal.approvalHash !== proposal.idempotencyKey) {
    throw new Error('curation apply requires representative-approved proposal hash');
  }
  const repoRoot = opts.repoRoot ?? process.cwd();
  const archiveDir = opts.archiveDir ?? join(repoRoot, 'docs', '_archive');
  const result: ApplyResult = { marked: 0, archived: 0, snapshots: [], skipped: [] };
  const items = proposal.items.filter((i) => !opts.only || i.action === opts.only);
  for (const item of items) {
    if (item.action === 'add') { result.skipped.push({ path: item.path, why: 'add requires separate approved authoring path' }); continue; }
    const abs = join(repoRoot, item.path);
    if (!existsSync(abs)) { result.skipped.push({ path: item.path, why: '파일 없음(이미 이동?)' }); continue; }
    const before = readFileSync(abs, 'utf-8');
    result.snapshots.push(snapshotBefore(repoRoot, proposal, item, before));
    if (item.action === 'update') {
      try {
        const after = markSuperseded(before, item.successor ?? '');
        if (after !== before) { writeFileSync(abs, after); result.marked++; }
        else result.skipped.push({ path: item.path, why: '이미 마킹됨(멱등)' });
      } catch (e) { result.skipped.push({ path: item.path, why: `마킹 실패: ${e instanceof Error ? e.message : String(e)}` }); }
      continue;
    }
    if (item.blocked) { result.skipped.push({ path: item.path, why: `blocked: ${item.blocked}` }); continue; }
    const dest = join(archiveDir, basename(item.path));
    if (existsSync(dest)) { result.skipped.push({ path: item.path, why: '_archive 에 동명 파일 존재' }); continue; }
    try { mkdirSync(archiveDir, { recursive: true }); renameSync(abs, dest); result.archived++; }
    catch (e) { result.skipped.push({ path: item.path, why: `이동 실패: ${e instanceof Error ? e.message : String(e)}` }); }
  }
  return result;
}
