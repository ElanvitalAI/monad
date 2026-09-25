// ── DocOps P1 · 문서 큐레이션 감지 엔진 (2026-07-13) ─────────────────────────
//
// se-doc-map(READ-ONLY 감지)의 다음 층 — "무엇을 정리할 수 있나"를 결정론
// 규칙으로 감지해 **제안**을 만든다. 실행(아카이브 이동·supersede 마킹)은
// 별도 apply 단계 + HITL(대표 검토) 뒤에만.
//
// 원칙 (PLAN-doc-knowledge-infra-overhaul §5 자율성 경계):
//   • 삭제 금지 — 아카이브(_archive/) 이동까지만. git 이력 보존.
//   • 링크 보존 — 활성 문서가 참조하는 파일은 이동 후보에서 자동 배제(blocked).
//   • 보수 게이트 — 애매하면 제안하지 않는다(놓침 < 오정리).
//
// 감지 축:
//   ① supersede 클러스터 — 같은 prefix+topic 에 날짜 다른 문서 2+ → 구본에
//      successor 마킹 제안(비파괴·프론트매터).
//   ② archive 후보 — 세션 이력 성격(handoff/recap) + stale 점수 임계 이상 +
//      일정 나이 초과 + 활성 문서 인바운드 참조 0.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '../../hasher.js';
import { isCurationAction, isCurationStatus, type CurationAction, type CurationStatus } from '../../knowledge/kgs/types.js';
import { kindOfPrefix, staleScore, type DocEntry } from './doc-inventory.js';
// 다운스트림(doc-curation-apply)이 이 모듈에서 CurationAction 을 가져오므로 canonical 타입 re-export.
export type { CurationAction, CurationStatus };

/** Existing CurationProposal JSON queue item. Evidence is mandatory before review. */
export interface CurationItem {
  action: CurationAction;
  /** repo 상대 경로 (docs/...). */
  path: string;
  filename: string;
  reason: string;
  inboundRefs: number;
  // ── add/update 전용 — archive 액션은 targetDoc/증거/diff 개념이 없어 생략(optional). ──
  targetDocument?: string;
  evidenceQuote?: string;
  sourcePath?: string;
  diff?: string;
  confidence?: number;
  detectorVersion?: string;
  /** update — 같은 topic 의 최신본(repo 상대). */
  successor?: string;
  liveRefs?: number;
  staleRefs?: number;
  blocked?: string;
}

export interface CurationProposal {
  generatedAt: string;
  scanned: number;
  items: CurationItem[];
  status: CurationStatus;
  inputDocumentHash: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  idempotencyKey: string;
  /** Representative approval must bind this exact proposal hash. */
  approvalHash?: string;
  suppressed?: boolean;
  /** Additive observability summary emitted by the deterministic WIKI claim proposer. */
  wikiClaimStatistics?: {
    receivedClaims: number;
    proposedItems: number;
    discardedClaims: number;
    discarded: {
      reason: 'no-matching-wiki-page';
      sourcePaths: string[];
    };
  };
}

export function assertCurationProposal(value: unknown): asserts value is CurationProposal {
  const p = value as Partial<CurationProposal>;
  if (!p || typeof p !== 'object' || !isCurationStatus(p.status)
    || typeof p.inputDocumentHash !== 'string' || typeof p.model !== 'string'
    || typeof p.promptVersion !== 'string' || typeof p.schemaVersion !== 'string'
    || typeof p.idempotencyKey !== 'string' || !Array.isArray(p.items)) throw new Error('invalid curation proposal');
  for (const item of p.items) {
    if (!item || !isCurationAction(item.action) || !item.path || !item.targetDocument || !item.evidenceQuote
      || !item.sourcePath || !item.diff || typeof item.confidence !== 'number'
      || item.confidence < 0 || item.confidence > 1 || !item.detectorVersion) throw new Error('invalid curation item');
  }
}

function queueItem(item: Omit<CurationItem, 'targetDocument' | 'evidenceQuote' | 'sourcePath' | 'diff' | 'confidence' | 'detectorVersion'>): CurationItem {
  return {
    ...item, targetDocument: item.path, evidenceQuote: item.reason, sourcePath: item.path,
    diff: item.action === 'update' ? `append/merge superseded_by: ${item.successor ?? ''}` : `archive-only: ${item.path}`,
    confidence: item.action === 'archive' ? 0.9 : 0.95, detectorVersion: 'doc-curation-v2',
  };
}

export interface CurationOpts {
  nowMs?: number;
  /** archive 후보 stale 점수 하한 (기본 70 — 보수). */
  staleFloor?: number;
  /** archive 후보 최소 나이(일 · 기본 60). */
  minAgeDays?: number;
  /** 파일 본문 로더 (테스트 주입 — 기본 fs). */
  readFile?: (repoRelPath: string) => string;
  repoRoot?: string;
  /** 참조자를 '살아있는 참조'로 치는 stale 상한 (기본 60 — 이상이면 stale 참조).
   *  2026-07-14 대표 지시: 참조가 있어도 그 참조 문서가 stale 이면 배제하지 않는다. */
  refStaleFloor?: number;
  /** _index.md 등재 상대경로 집합 — 등재 문서는 trailhead 로 blocked. */
  indexLinks?: Set<string>;
  /** Existing serialized proposal keys; matching reruns are suppressed, never duplicated. */
  existingIdempotencyKeys?: ReadonlySet<string>;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
}

/** 전 활성 문서 1패스 — 본문에서 참조된 .md 파일명(basename) 카운트.
 *  markdown 링크·위키링크·플레인 언급 전부 잡는다(보수 — 참조가 있으면 이동 금지).
 *  자기 자신 참조와 _index.md(트레일헤드 등재는 참조로 안 침 — 등재는 지도지
 *  의존이 아님) 발신은 제외. */
export function buildInboundRefMap(
  entries: DocEntry[],
  readFile: (repoRelPath: string) => string,
): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  const known = new Set(entries.map((e) => e.filename));
  for (const e of entries) {
    if (e.filename === '_index.md') continue;
    let text: string;
    try { text = readFile(e.path); } catch { continue; }
    const seen = new Set<string>();
    for (const m of text.matchAll(/([A-Za-z0-9._\-]+\.md)\b/g)) {
      const base = m[1]!.split('/').pop()!;
      if (base === e.filename) continue; // 자기 참조 제외
      if (!known.has(base)) continue;
      if (seen.has(base)) continue; // 문서당 1회 (참조 문서 수 기준)
      seen.add(base);
      const arr = refs.get(base) ?? [];
      arr.push(e.filename);
      refs.set(base, arr);
    }
  }
  return refs;
}

/** 하위호환 래퍼 — 참조 문서 수. */
export function countInboundRefs(
  entries: DocEntry[],
  readFile: (repoRelPath: string) => string,
): Map<string, number> {
  const m = buildInboundRefMap(entries, readFile);
  return new Map([...m.entries()].map(([k, v]) => [k, v.length]));
}

/** supersede 클러스터 — 같은 prefix+topic 에 날짜 있는 문서 2+.
 *  최신(날짜 최대)이 successor, 나머지가 구본. */
export function findSupersedeClusters(entries: DocEntry[]): Array<{ successor: DocEntry; olders: DocEntry[] }> {
  const byKey = new Map<string, DocEntry[]>();
  for (const e of entries) {
    if (!e.date || e.topic === '(untitled)') continue;
    const key = `${e.prefix}:${e.topic}`;
    const arr = byKey.get(key) ?? [];
    arr.push(e);
    byKey.set(key, arr);
  }
  const out: Array<{ successor: DocEntry; olders: DocEntry[] }> = [];
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    const successor = sorted[0]!;
    const olders = sorted.slice(1).filter((e) => e.date !== successor.date); // 동일 날짜는 병렬 문서로 보고 제외
    if (olders.length > 0) out.push({ successor, olders });
  }
  return out.sort((a, b) => b.olders.length - a.olders.length);
}

/** 감지 본체 — 결정론·READ-ONLY. */
export function buildCurationProposal(entries: DocEntry[], opts: CurationOpts = {}): CurationProposal {
  const nowMs = opts.nowMs ?? Date.now();
  const staleFloor = opts.staleFloor ?? 70;
  const minAgeDays = opts.minAgeDays ?? 60;
  const repoRoot = opts.repoRoot ?? process.cwd();
  const readFile = opts.readFile ?? ((rel: string) => readFileSync(join(repoRoot, rel), 'utf-8'));

  const model = opts.model ?? 'deterministic-doc-curate';
  const promptVersion = opts.promptVersion ?? 'doc-curation-rules-v1';
  const schemaVersion = opts.schemaVersion ?? 'docops-curation-v1';
  const inputDocumentHash = hashContent(entries.map((e) => `${e.path}\0${readFile(e.path)}`).sort().join('\n'));
  const idempotencyKey = hashContent(`${inputDocumentHash}\0${model}\0${promptVersion}\0${schemaVersion}`);
  if (opts.existingIdempotencyKeys?.has(idempotencyKey)) {
    return { generatedAt: new Date(nowMs).toISOString(), scanned: entries.length, items: [], status: 'proposed', inputDocumentHash, model, promptVersion, schemaVersion, idempotencyKey, suppressed: true };
  }

  const refMap = buildInboundRefMap(entries, readFile);
  const refCount = (f: string): number => refMap.get(f)?.length ?? 0;
  // 참조자 품질 판정(2026-07-14 대표 지시) — 참조가 있어도 그 참조 문서
  // 자체가 stale 이면 '살아있는 참조'가 아니다(곰팡이가 곰팡이를 붙잡는
  // 것을 허용하지 않는다). live = stale 점수 < refStaleFloor.
  const refStaleFloor = opts.refStaleFloor ?? 60;
  const staleByName = new Map(entries.map((e) => [e.filename, staleScore(e, nowMs)]));
  const isLiveReferencer = (f: string): boolean => (staleByName.get(f) ?? 0) < refStaleFloor;
  const items: CurationItem[] = [];

  // ① supersede 마킹 (비파괴 — 참조 여부와 무관하게 제안 가능·apply 도 안전)
  for (const { successor, olders } of findSupersedeClusters(entries)) {
    for (const old of olders) {
      items.push(queueItem({
        action: 'update',
        path: old.path,
        filename: old.filename,
        successor: successor.path,
        inboundRefs: refCount(old.filename),
        reason: `같은 topic(:) 최신본 존재 — `,
      }));
    }
  }

  // ② archive 후보 (보수 게이트 4중)
  const supersededPaths = new Set(items.map((i) => i.path));
  for (const e of entries) {
    const kind = kindOfPrefix(e.prefix);
    if (kind !== 'handoff' && kind !== 'recap') continue; // 세션 이력 성격만
    if (!e.date) continue;
    const ageDays = (nowMs - Date.parse(e.date)) / 86400_000;
    if (ageDays < minAgeDays) continue;
    const score = staleScore(e, nowMs);
    if (score < staleFloor) continue;
    const referencers = refMap.get(e.filename) ?? [];
    const liveOnes = referencers.filter(isLiveReferencer);
    const staleOnes = referencers.length - liveOnes.length;
    const item: CurationItem = {
      action: 'archive',
      path: e.path,
      filename: e.filename,
      inboundRefs: referencers.length,
      liveRefs: liveOnes.length,
      staleRefs: staleOnes,
      reason: `세션 이력(${e.prefix}) · ${Math.round(ageDays)}일 경과 · stale ${score}` +
        (supersededPaths.has(e.path) ? ' · supersede 구본' : '') +
        (staleOnes > 0 && liveOnes.length === 0 ? ` · 참조 ${staleOnes}곳 전원 stale(무효)` : ''),
    };
    // trailhead(_index) 등재 문서는 canonical 지도 소속 — 자동 이동 배제(등재 해제는 사람 결정).
    const rel = e.path.replace(/^docs\//, '');
    if (opts.indexLinks?.has(rel)) {
      item.blocked = 'trailhead(_index) 등재 — 등재 해제는 사람 결정';
    } else if (liveOnes.length > 0) {
      item.blocked = `살아있는 문서 ${liveOnes.length}곳이 참조 (${liveOnes.slice(0, 3).join(', ')}${liveOnes.length > 3 ? ' …' : ''})`;
    }
    items.push(queueItem(item));
  }

  return { generatedAt: new Date(nowMs).toISOString(), scanned: entries.length, items, status: 'proposed', inputDocumentHash, model, promptVersion, schemaVersion, idempotencyKey };
}

/** 제안 → 사람용 md 리포트. */
export function renderProposalMd(p: CurationProposal): string {
  const marks = p.items.filter((i) => i.action === 'update');
  const archives = p.items.filter((i) => i.action === 'archive' && !i.blocked);
  const blocked = p.items.filter((i) => i.action === 'archive' && i.blocked);
  const L: string[] = [
    `# 문서 큐레이션 제안 (DocOps P1) — ${p.generatedAt.slice(0, 10)}`,
    '',
    `> 감지 = 결정론 규칙 · 실행은 HITL(검토 후 --apply). **삭제 없음 — 아카이브 이동/프론트매터 마킹만.**`,
    '',
    `스캔 ${p.scanned}개 → supersede 마킹 ${marks.length} · 아카이브 이동 가능 ${archives.length} · 참조로 배제 ${blocked.length}`,
    '',
    `## ① supersede 마킹 (비파괴 · ${marks.length})`,
    ...marks.slice(0, 200).map((i) => `- \`${i.path}\` → 최신본 \`${i.successor}\``),
    marks.length > 200 ? `- … 외 ${marks.length - 200}건 (JSON 전체 참조)` : '',
    '',
    `## ② 아카이브 이동 가능 (참조 0 · ${archives.length})`,
    ...archives.slice(0, 200).map((i) => `- \`${i.path}\` — ${i.reason}`),
    archives.length > 200 ? `- … 외 ${archives.length - 200}건` : '',
    '',
    `## ③ 참조 존재로 자동 배제 (${blocked.length}) — 수동 검토 대상`,
    ...blocked.slice(0, 50).map((i) => `- \`${i.path}\` — ${i.blocked}`),
    blocked.length > 50 ? `- … 외 ${blocked.length - 50}건` : '',
  ];
  return L.filter((l) => l !== '').join('\n') + '\n';
}
