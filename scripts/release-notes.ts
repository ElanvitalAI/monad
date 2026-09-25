#!/usr/bin/env bun
// 릴리스 변경 기록 «초안» — 두 ref 사이의 착지(squash 커밋 제목)를 묶어 GitHub Release 본문 초안을 낸다.
//   bun scripts/release-notes.ts --from <ref> [--to <ref>] [--json]
// 정책 = 내부 문서 `MANUAL-versioning-and-release-2026-09-25` §A 4 — 초안을 «자동»으로 내고 공개용 요약은 사람이 다듬는다.
// ⛔ 이것은 «초안»이다: 제목이 한국어로 길고 내부 트랙 표식이 섞여 있어 그대로 공개하지 않는다.
// ⛔ 묶음은 «바뀐 경로»로 가른다(제목 낱말로 추측하지 않는다) — 문서만 바뀐 착지는 «문서», 시험만이면 «시험».
import { spawnSync } from 'node:child_process';

export interface LandedCommit { sha: string; subject: string; files: string[] }
export type NoteSection = 'change' | 'test' | 'docs';
export interface ReleaseNotesDraft {
  from: string;
  to: string;
  total: number;
  sections: Record<NoteSection, Array<{ sha: string; pr: number | null; title: string }>>;
}

const DOC_PATH = /^(docs\/|\.rules\/|README|AGENTS\.md$|CLAUDE\.md$)/;
const TEST_PATH = /(\.test\.[cm]?[jt]sx?$|^test\/)/;

export function sectionOf(files: readonly string[]): NoteSection {
  if (files.length > 0 && files.every((f) => DOC_PATH.test(f))) return 'docs';
  if (files.length > 0 && files.every((f) => TEST_PATH.test(f) || DOC_PATH.test(f))) return 'test';
  return 'change';
}

/** 제목 끝의 `(#123)` 을 PR 번호로 떼어 낸다 — 없으면 null(직접 커밋). */
export function splitPr(subject: string): { title: string; pr: number | null } {
  const m = /\s*\(#(\d+)\)\s*$/.exec(subject);
  return m ? { title: subject.slice(0, m.index).trim(), pr: Number(m[1]) } : { title: subject.trim(), pr: null };
}

export function draftReleaseNotes(commits: readonly LandedCommit[], from: string, to: string): ReleaseNotesDraft {
  const sections: ReleaseNotesDraft['sections'] = { change: [], test: [], docs: [] };
  for (const c of commits) {
    const { title, pr } = splitPr(c.subject);
    sections[sectionOf(c.files)].push({ sha: c.sha.slice(0, 12), pr, title });
  }
  return { from, to, total: commits.length, sections };
}

export function renderReleaseNotes(d: ReleaseNotesDraft): string {
  const label: Record<NoteSection, string> = { change: '변경', test: '시험', docs: '문서' };
  const lines = [`<!-- 초안: ${d.from}..${d.to} · 착지 ${d.total}건 — 공개 전에 사람이 요약한다 -->`, ''];
  for (const key of ['change', 'test', 'docs'] as const) {
    const items = d.sections[key];
    if (items.length === 0) continue;
    lines.push(`## ${label[key]} (${items.length})`, '');
    for (const it of items) lines.push(`- ${it.title}${it.pr === null ? ` (${it.sha})` : ` (#${it.pr})`}`);
    lines.push('');
  }
  return lines.join('\n');
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패 rc=${r.status}: ${(r.stderr ?? '').trim()}`);
  return r.stdout;
}

/** `from..to` 의 first-parent 착지와 각 착지가 바꾼 경로. */
export function readLandedCommits(from: string, to: string): LandedCommit[] {
  const out = git(['log', '--first-parent', '--reverse', '--format=%x1e%H%x1f%s', '--name-only', `${from}..${to}`]);
  return out.split('\x1e').filter((b) => b.trim()).map((block) => {
    const [head, ...rest] = block.split('\n');
    const [sha, subject] = head!.split('\x1f');
    return { sha: sha!, subject: subject ?? '', files: rest.map((l) => l.trim()).filter(Boolean) };
  });
}

if (import.meta.main) {
  const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const from = arg('--from');
  const to = arg('--to') ?? 'HEAD';
  if (!from) { console.error('사용: bun scripts/release-notes.ts --from <ref> [--to <ref>] [--json]'); process.exit(2); }
  try {
    const draft = draftReleaseNotes(readLandedCommits(from, to), from, to);
    console.log(process.argv.includes('--json') ? JSON.stringify(draft) : renderReleaseNotes(draft));
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }
}
