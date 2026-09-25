/**
 * 문서 큐레이션 — DocOps P1 계약 (2026-07-13).
 *
 * 핵심 계약: ① 감지는 결정론·READ-ONLY ② 참조 문서는 아카이브 자동 배제
 * ③ 적용은 삭제 없음(이동/마킹만)·멱등.
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DocEntry } from './doc-inventory.js';
import { buildCurationProposal, countInboundRefs, findSupersedeClusters, renderProposalMd } from './doc-curation.js';
import { applyCurationProposal, markSuperseded } from './doc-curation-apply.js';

const NOW = Date.parse('2026-07-13T00:00:00Z');

function entry(over: Partial<DocEntry>): DocEntry {
  return {
    path: `docs/${over.filename ?? 'X.md'}`, filename: 'X.md', prefix: 'HANDOFF', topic: 'foo',
    date: '2026-04-01', sizeBytes: 1000, openBoxes: 8, doneBoxes: 2, subdir: '',
    ...over,
  };
}

describe('findSupersedeClusters — 같은 prefix+topic 최신본 판정', () => {
  it('2+ 문서 클러스터에서 최신=successor·구본 목록', () => {
    const es = [
      entry({ filename: 'PLAN-log-2026-05-01.md', prefix: 'PLAN', topic: 'log', date: '2026-05-01' }),
      entry({ filename: 'PLAN-log-2026-07-01.md', prefix: 'PLAN', topic: 'log', date: '2026-07-01' }),
      entry({ filename: 'PLAN-other-2026-07-01.md', prefix: 'PLAN', topic: 'other', date: '2026-07-01' }),
    ];
    const clusters = findSupersedeClusters(es);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.successor.filename).toBe('PLAN-log-2026-07-01.md');
    expect(clusters[0]!.olders.map((e) => e.filename)).toEqual(['PLAN-log-2026-05-01.md']);
  });

  it('동일 날짜 병렬 문서·무날짜·(untitled) 는 제외', () => {
    const es = [
      entry({ filename: 'A.md', prefix: 'PLAN', topic: 'x', date: '2026-07-01' }),
      entry({ filename: 'B.md', prefix: 'PLAN', topic: 'x', date: '2026-07-01' }),
      entry({ filename: 'C.md', prefix: 'PLAN', topic: '(untitled)', date: '2026-06-01' }),
    ];
    expect(findSupersedeClusters(es).length).toBe(0);
  });
});

describe('countInboundRefs — 활성 문서 참조 스캔', () => {
  it('링크·플레인 언급 카운트 · 자기참조/_index 발신 제외 · 문서당 1회', () => {
    const es = [
      entry({ filename: 'A.md', path: 'docs/A.md' }),
      entry({ filename: 'B.md', path: 'docs/B.md' }),
      entry({ filename: '_index.md', path: 'docs/_index.md' }),
    ];
    const bodies: Record<string, string> = {
      'docs/A.md': '자기 A.md 언급(제외) + [b](B.md) 그리고 다시 B.md 재언급(1회만)',
      'docs/B.md': '아무 참조 없음',
      'docs/_index.md': 'A.md B.md — 트레일헤드 등재는 참조 아님',
    };
    const refs = countInboundRefs(es, (p) => bodies[p] ?? '');
    expect(refs.get('B.md')).toBe(1);
    expect(refs.get('A.md')).toBeUndefined();
  });
});

describe('buildCurationProposal — 보수 게이트', () => {
  const readEmpty = () => '';

  it('archive 후보: handoff/recap + 60일+ + stale 임계 + 참조 0 전부 충족해야', () => {
    const es = [
      entry({ filename: 'HANDOFF-old-2026-04-01.md', prefix: 'HANDOFF', topic: 'old', date: '2026-04-01', openBoxes: 10, doneBoxes: 0 }),
      entry({ filename: 'HANDOFF-recent-2026-07-01.md', prefix: 'HANDOFF', topic: 'recent', date: '2026-07-01', openBoxes: 10, doneBoxes: 0 }), // 나이 미달
      entry({ filename: 'PLAN-old-2026-04-01.md', prefix: 'PLAN', topic: 'plan-old', date: '2026-04-01', openBoxes: 10, doneBoxes: 0 }),       // 성격 미달
    ];
    const p = buildCurationProposal(es, { nowMs: NOW, readFile: readEmpty });
    const archives = p.items.filter((i) => i.action === 'archive');
    expect(archives.map((i) => i.filename)).toEqual(['HANDOFF-old-2026-04-01.md']);
    expect(archives[0]!.blocked).toBeUndefined();
  });

  it('참조 있는 archive 후보는 blocked (링크 보존)', () => {
    const es = [
      entry({ filename: 'HANDOFF-ref-2026-04-01.md', path: 'docs/HANDOFF-ref-2026-04-01.md', prefix: 'HANDOFF', topic: 'ref', date: '2026-04-01', openBoxes: 10, doneBoxes: 0 }),
      entry({ filename: 'PLAN-live.md', path: 'docs/PLAN-live.md', prefix: 'PLAN', topic: 'live', date: '2026-07-01' }),
    ];
    const p = buildCurationProposal(es, {
      nowMs: NOW,
      readFile: (path) => (path === 'docs/PLAN-live.md' ? '참조: HANDOFF-ref-2026-04-01.md' : ''),
    });
    const a = p.items.find((i) => i.action === 'archive');
    expect(a?.blocked).toContain('참조');
  });

  it('renderProposalMd — 사람용 리포트에 3구획', () => {
    const es = [entry({ filename: 'HANDOFF-old-2026-04-01.md', prefix: 'HANDOFF', topic: 'old', date: '2026-04-01', openBoxes: 9, doneBoxes: 1 })];
    const md = renderProposalMd(buildCurationProposal(es, { nowMs: NOW, readFile: readEmpty }));
    expect(md).toContain('supersede 마킹');
    expect(md).toContain('아카이브 이동 가능');
    expect(md).toContain('삭제 없음');
  });
});

describe('적용기 — 삭제 없음·멱등', () => {
  it('markSuperseded — 프론트매터 유무 양쪽 + 멱등', () => {
    const noFm = markSuperseded('# 본문\n내용', 'docs/NEW.md');
    expect(noFm.startsWith('---\nstatus: superseded\nsuperseded_by: docs/NEW.md\n---')).toBe(true);
    expect(noFm).toContain('# 본문');
    const withFm = markSuperseded('---\ntitle: x\n---\n\n# 본문', 'docs/NEW.md');
    expect(withFm).toContain('title: x');
    expect(withFm).toContain('status: superseded');
    expect(markSuperseded(noFm, 'docs/NEW.md')).toBe(noFm); // 멱등
  });

  it('applyCurationProposal — 이동/마킹 실행 · blocked 스킵 · 원본 보존', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-curate-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'OLD.md'), '# old');
    writeFileSync(join(dir, 'docs', 'MARK.md'), '# mark');
    writeFileSync(join(dir, 'docs', 'REF.md'), '# ref');
    const r = applyCurationProposal({
      generatedAt: 'x', scanned: 3, status: 'approved', inputDocumentHash: 'input', model: 'local', promptVersion: 'p1', schemaVersion: 's1', idempotencyKey: 'approved-key', approvalHash: 'approved-key',
      items: [
        { action: 'archive', path: 'docs/OLD.md', targetDocument: 'docs/OLD.md', filename: 'OLD.md', inboundRefs: 0, reason: 'r', evidenceQuote: 'q', sourcePath: 'docs/OLD.md', diff: 'archive-only', confidence: .9, detectorVersion: 'v1' },
        { action: 'update', path: 'docs/MARK.md', targetDocument: 'docs/MARK.md', filename: 'MARK.md', successor: 'docs/NEW.md', inboundRefs: 0, reason: 'r', evidenceQuote: 'q', sourcePath: 'docs/MARK.md', diff: 'append/merge', confidence: .9, detectorVersion: 'v1' },
        { action: 'archive', path: 'docs/REF.md', targetDocument: 'docs/REF.md', filename: 'REF.md', inboundRefs: 2, reason: 'r', evidenceQuote: 'q', sourcePath: 'docs/REF.md', diff: 'archive-only', confidence: .9, detectorVersion: 'v1', blocked: '참조 2곳' },
      ],
    }, { repoRoot: dir });
    expect(r.archived).toBe(1);
    expect(r.marked).toBe(1);
    expect(r.skipped.length).toBe(1);
    expect(existsSync(join(dir, 'docs', '_archive', 'OLD.md'))).toBe(true);  // 이동(삭제 아님)
    expect(existsSync(join(dir, 'docs', 'OLD.md'))).toBe(false);
    expect(existsSync(join(dir, 'docs', 'REF.md'))).toBe(true);              // blocked 보존
    expect(readFileSync(join(dir, 'docs', 'MARK.md'), 'utf-8')).toContain('status: superseded');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('doc-lint — L0 컨벤션 (경고만)', () => {
  it('R1 prefix · R2 date · R3 status · R4 trailhead', async () => {
    const { KNOWN_PREFIXES, lintDoc } = await import('./doc-lint.js');
    expect([...KNOWN_PREFIXES].sort()).toEqual([
      'ALIGNMENT', 'APPENDIX', 'ARCHITECTURE', 'ARCHIVE', 'AUDIT', 'BACKLOG',
      'CAPABILITIES', 'DESIGN', 'FEATURE', 'FINDING', 'HANDOFF', 'INCIDENT',
      'MANUAL', 'MAP', 'MEASUREMENT', 'PLAN', 'RECAP', 'REPORT', 'RESEARCH',
      'RFC', 'ROADMAP', 'SCHEME', 'SPIKE', 'VISION', 'WIKI',
    ]);
    // R1 — 미지 prefix
    expect(lintDoc('WEIRD-thing.md').some((w) => w.rule === 'prefix')).toBe(true);
    expect(lintDoc('FINDING-observation.md').some((w) => w.rule === 'prefix')).toBe(false);
    expect(lintDoc('MEASUREMENT-observation.md').some((w) => w.rule === 'prefix')).toBe(false);
    // R2 — 세션성 prefix 무날짜
    expect(lintDoc('PLAN-no-date.md').some((w) => w.rule === 'date')).toBe(true);
    expect(lintDoc('PLAN-ok-2026-07-13.md').some((w) => w.rule === 'date')).toBe(false);
    // R3 — status에는 종류 축과 생명주기 축이 섞여 있다.
    const kindStatusWarnings = lintDoc('PLAN-x-2026-07-13.md', { text: '---\nstatus: handoff\n---\n' }).filter((w) => w.rule === 'frontmatter-status');
    expect(kindStatusWarnings).toHaveLength(1);
    expect(kindStatusWarnings[0]!.message).toBe("status 'handoff'는 문서 종류 축 — 생명주기(active|superseded|archived) 미기재");
    const parenthesizedKindWarnings = lintDoc('PLAN-x-2026-07-13.md', { text: '---\nstatus: roadmap (트랙 · 날짜 · 지시 문면)\n---\n' }).filter((w) => w.rule === 'frontmatter-status');
    expect(parenthesizedKindWarnings).toHaveLength(1);
    expect(parenthesizedKindWarnings[0]!.message).toBe("status 'roadmap (트랙 · 날짜 · 지시 문면)'는 문서 종류 축 — 생명주기(active|superseded|archived) 미기재");
    expect(lintDoc('PLAN-x-2026-07-13.md', { text: '---\nstatus: superseded\n---\n' }).some((w) => w.rule === 'frontmatter-status')).toBe(false);
    expect(lintDoc('PLAN-x-2026-07-13.md', { text: '---\ntitle: no-status\n---\n' }).some((w) => w.rule === 'frontmatter-status')).toBe(false);
    const unknownStatusWarnings = lintDoc('PLAN-x-2026-07-13.md', { text: '---\nstatus: done\n---\n' }).filter((w) => w.rule === 'frontmatter-status');
    expect(unknownStatusWarnings).toHaveLength(1);
    expect(unknownStatusWarnings[0]!.message).toBe("status 'done' — 알 수 없는 값; 종류 또는 생명주기(active|superseded|archived)여야");
    // R4 — trailhead 미등록
    const links = new Set(['FEATURE-in-2026-07-13.md']);
    expect(lintDoc('FEATURE-in-2026-07-13.md', { indexLinks: links, relPath: 'FEATURE-in-2026-07-13.md' }).some((w) => w.rule === 'trailhead')).toBe(false);
    expect(lintDoc('FEATURE-out-2026-07-13.md', { indexLinks: links, relPath: 'FEATURE-out-2026-07-13.md' }).some((w) => w.rule === 'trailhead')).toBe(true);
    // 메타 파일 제외
    expect(lintDoc('_index.md').length).toBe(0);
  });
});

describe('참조자 품질 판정 (2026-07-14 대표 지시 — 적극 정리)', () => {
  it('참조자 전원이 stale 이면 참조가 있어도 아카이브 가능', async () => {
    const { buildCurationProposal } = await import('./doc-curation.js');
    const es = [
      entry({ filename: 'HANDOFF-target-2026-04-01.md', path: 'docs/HANDOFF-target-2026-04-01.md', prefix: 'HANDOFF', topic: 'target', date: '2026-04-01', openBoxes: 10, doneBoxes: 0 }),
      // 참조자 — 자신도 stale (오래된 미완 핸드오프)
      entry({ filename: 'HANDOFF-oldref-2026-04-02.md', path: 'docs/HANDOFF-oldref-2026-04-02.md', prefix: 'HANDOFF', topic: 'oldref', date: '2026-04-02', openBoxes: 10, doneBoxes: 0 }),
    ];
    const p = buildCurationProposal(es, {
      nowMs: NOW,
      readFile: (path) => (path === 'docs/HANDOFF-oldref-2026-04-02.md' ? '참조: HANDOFF-target-2026-04-01.md' : ''),
    });
    const t = p.items.find((i) => i.action === 'archive' && i.filename === 'HANDOFF-target-2026-04-01.md');
    expect(t?.blocked).toBeUndefined();          // stale 참조는 무효
    expect(t?.staleRefs).toBe(1);
    expect(t?.liveRefs).toBe(0);
    expect(t?.reason).toContain('전원 stale');
  });

  it('살아있는(신선한) 참조자가 1곳이라도 있으면 여전히 blocked', async () => {
    const { buildCurationProposal } = await import('./doc-curation.js');
    const es = [
      entry({ filename: 'HANDOFF-target-2026-04-01.md', path: 'docs/HANDOFF-target-2026-04-01.md', prefix: 'HANDOFF', topic: 'target', date: '2026-04-01', openBoxes: 10, doneBoxes: 0 }),
      entry({ filename: 'FEATURE-live-2026-07-10.md', path: 'docs/FEATURE-live-2026-07-10.md', prefix: 'FEATURE', topic: 'live', date: '2026-07-10', openBoxes: 0, doneBoxes: 5 }),
    ];
    const p = buildCurationProposal(es, {
      nowMs: NOW,
      readFile: (path) => (path === 'docs/FEATURE-live-2026-07-10.md' ? '참조: HANDOFF-target-2026-04-01.md' : ''),
    });
    const t = p.items.find((i) => i.action === 'archive');
    expect(t?.blocked).toContain('살아있는 문서');
    expect(t?.blocked).toContain('FEATURE-live-2026-07-10.md');
  });

  it('trailhead(_index) 등재 문서는 아카이브 자동 배제', async () => {
    const { buildCurationProposal } = await import('./doc-curation.js');
    const es = [entry({ filename: 'HANDOFF-idx-2026-04-01.md', path: 'docs/HANDOFF-idx-2026-04-01.md', prefix: 'HANDOFF', topic: 'idx', date: '2026-04-01', openBoxes: 10, doneBoxes: 0 })];
    const p = buildCurationProposal(es, {
      nowMs: NOW, readFile: () => '',
      indexLinks: new Set(['HANDOFF-idx-2026-04-01.md']),
    });
    expect(p.items.find((i) => i.action === 'archive')?.blocked).toContain('trailhead');
  });
});


describe('HITL proposal queue contract', () => {
  it('same document/model/prompt/schema key is suppressed and evidence is present', () => {
    const es = [entry({ filename: 'HANDOFF-old-2026-04-01.md', prefix: 'HANDOFF', topic: 'old', date: '2026-04-01', openBoxes: 10, doneBoxes: 0 })];
    const first = buildCurationProposal(es, { nowMs: NOW, readFile: () => '' });
    expect(first.items[0]?.targetDocument).toBe('docs/HANDOFF-old-2026-04-01.md');
    expect(first.items[0]?.evidenceQuote).toBeTruthy();
    const second = buildCurationProposal(es, { nowMs: NOW, readFile: () => '', existingIdempotencyKeys: new Set([first.idempotencyKey]) });
    expect(second.suppressed).toBe(true); expect(second.items).toEqual([]);
  });

  it('rejects unknown action/status and unapproved apply; approved update/archive save snapshots', () => {
    expect(() => applyCurationProposal({ status: 'approved', items: [{ action: 'delete' }] } as any)).toThrow('invalid curation proposal');
    const dir = mkdtempSync(join(tmpdir(), 'doc-hitl-')); mkdirSync(join(dir, 'docs')); writeFileSync(join(dir, 'docs', 'A.md'), '# A');
    const proposal: any = { generatedAt: 'x', scanned: 1, status: 'proposed', inputDocumentHash: 'i', model: 'm', promptVersion: 'p', schemaVersion: 's', idempotencyKey: 'k', items: [{ action: 'update', path: 'docs/A.md', targetDocument: 'docs/A.md', filename: 'A.md', reason: 'r', evidenceQuote: 'q', sourcePath: 'docs/A.md', diff: 'append/merge', confidence: .9, detectorVersion: 'v', inboundRefs: 0, successor: 'docs/B.md' }] };
    expect(() => applyCurationProposal(proposal, { repoRoot: dir })).toThrow('representative-approved');
    proposal.status = 'approved'; proposal.approvalHash = 'k';
    const r = applyCurationProposal(proposal, { repoRoot: dir });
    expect(r.snapshots).toHaveLength(1); expect(existsSync(r.snapshots[0]!)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
