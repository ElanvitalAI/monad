// ── DocOps · 직렬 야간 실행 + 승인 적용 게이트 (미션 668871 arc3 페이즈6·2026-07-14) ──
//
// arc1(안전한 제안·승인)·arc3(위키 claim 제안·docs-lint 링크 정합)가 만든 탐지기/제안기를 **야간
// 오케스트레이터**로 묶는다. 새 scheduler/apply 엔진 없이 기존 조각을 고정 순서로 호출:
//   ① docs-lint 링크 정합 → ②③ 후보 검색 + 로컬 판정 → ④ doc-curate 큐 기록.
// 규율(미션 불변식): 사이클당 10~20건 · 1-worker 직렬 · 건별 checkpoint · 제한 재시도 · fail-closed ·
//   로컬 전용(loopback·외부 egress 거부·원격 fallback 금지) · 승인된 배치만 snapshot 후 원자 적용 →
//   링크 재검사 성공 시 verified · 메트릭을 telemetry 에. 매매/arming/safety/재부팅 코어 무접촉.
//
// 무거운 의존(scanDocs·lintDocLinks·wiki-claim·search·doc-curation-apply·schedule)은 전부 주입 —
// 이 모듈은 **오케스트레이션 로직**(직렬·checkpoint·fail-closed·로컬가드·승인게이트·메트릭)만.

import type { CurationProposal } from './doc-curation.js';

/**
 * 로컬 전용 가드(fail-closed) — 모델 URL 이 loopback 이 아니면 throw. 비-loopback·원격 fallback 거부.
 * url 미설정(undefined) = 외부 모델 호출 없음(안전·통과). 미션 불변식: 클라우드 LLM 호출 0.
 */
export function assertLoopbackModelUrl(url: string | undefined): void {
  if (!url) return;
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { throw new Error(`모델 URL 파싱 실패(fail-closed): ${url}`); }
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!loopback) throw new Error(`비-loopback 모델 URL 거부(로컬 전용·fail-closed): ${host}`);
}

export interface NightlyItem {
  /** 대상 문서(repo 상대). */
  path: string;
}

export const NIGHTLY_STALENESS_DOCUMENT_LIMIT = 20;

export interface NightlyStalenessStageResult {
  checked: number;
  byAxis: {
    removedIdentifiers: number;
    brokenLinks: number;
    supersededMarked: number;
    staleScoreOverThreshold: number;
  };
  /** removedIdentifiers 축에 걸린 문서 전체 목록; runner가 표시 상한을 적용한다. */
  removedIdentifierDocuments: string[];
}

export interface NightlyStalenessSuccess extends NightlyStalenessStageResult {
  status: 'measured';
  removedIdentifierDocumentsTruncated: boolean;
}

export interface NightlyStalenessFailure {
  status: 'failed';
  error: string;
}

export type NightlyStalenessMetrics = NightlyStalenessSuccess | NightlyStalenessFailure;

export interface NightlyMetrics {
  processed: number;
  candidates: number;   // ① 링크 정합 finding 누적
  proposals: number;    // ④ 큐에 기록된 proposal item 수
  suppressed: number;   // 멱등 억제(중복)
  errors: number;       // fail-closed 로 건너뛴 건
  retries: number;
  durationMs: number;
  /** 저장소 전체 늙음 평가. 미지정이면 기존 사이클과 동일하게 생략한다. */
  staleness?: NightlyStalenessMetrics;
}

export interface NightlyDeps {
  /** 배치 선정 — 오래된/변경 문서 N건(주입: scanDocs 기반). */
  selectBatch: (limit: number) => NightlyItem[];
  /** ① docs-lint 링크·외부 포인터 정합 → finding 수(주입: lintDocLinks 등). */
  lintStage: (item: NightlyItem) => number | Promise<number>;
  /** ②③ 후보 검색 + 로컬 판정 → proposal(주입: 하이브리드검색+wiki-claim/supersede). null=제안 없음. */
  proposeStage: (item: NightlyItem) => CurationProposal | null;
  /** ④ doc-curate 큐 기록(주입). suppressed=멱등 억제. */
  recordStage: (p: CurationProposal) => { suppressed: boolean };
  /** 로컬 전용 가드 — loopback-only·외부 egress·원격 fallback 거부. 위반이면 throw(fail-closed). */
  assertLocalOnly: () => void;
  /** 건별 checkpoint(주입: 영속). */
  checkpoint?: (item: NightlyItem, ok: boolean) => void;
  /** 저장소 전체 늙음 평가 — 제공되면 문서별 루프와 분리해 사이클당 한 번 실행한다. */
  stalenessStage?: () => NightlyStalenessStageResult | Promise<NightlyStalenessStageResult>;
  /** 메트릭 방출(주입: telemetry). */
  emitMetrics?: (m: NightlyMetrics) => void;
  now?: () => number;
}

export interface NightlyOpts {
  /** 사이클당 처리 건수(10~20 권장·상한 20·하한 1). */
  batchLimit?: number;
  /** 건별 재시도 상한(기본 1). */
  maxRetryPerItem?: number;
}

/**
 * 야간 DocOps 사이클 — 1-worker 직렬·건별 checkpoint·fail-closed·로컬 전용. 승인/적용은 안 함(제안만).
 * 로컬 전용 가드가 사전 실패(throw)하면 아무 것도 처리하지 않는다(fail-closed·부작용 0).
 */
export async function runNightlyDocOpsCycle(deps: NightlyDeps, opts: NightlyOpts = {}): Promise<NightlyMetrics> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const limit = Math.min(Math.max(opts.batchLimit ?? 15, 1), 20); // 10~20·상한 20
  const maxRetry = Math.max(opts.maxRetryPerItem ?? 1, 0);
  const m: NightlyMetrics = { processed: 0, candidates: 0, proposals: 0, suppressed: 0, errors: 0, retries: 0, durationMs: 0 };

  // ★ 로컬 전용 사전 가드(fail-closed) — 위반이면 사이클 자체를 안 돈다(문서 무변경).
  deps.assertLocalOnly();

  if (deps.stalenessStage) {
    try {
      const staleness = await deps.stalenessStage();
      const removedIdentifierDocuments = staleness.removedIdentifierDocuments.slice(0, NIGHTLY_STALENESS_DOCUMENT_LIMIT);
      m.staleness = {
        status: 'measured',
        checked: staleness.checked,
        byAxis: staleness.byAxis,
        removedIdentifierDocuments,
        removedIdentifierDocumentsTruncated: staleness.removedIdentifierDocuments.length > removedIdentifierDocuments.length,
      };
    } catch (error) {
      m.staleness = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const batch = deps.selectBatch(limit).slice(0, limit);
  for (const item of batch) { // ★ 1-worker 직렬(동시성 없음·고정 순서)
    let ok = false;
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      try {
        m.candidates += await deps.lintStage(item);   // ① 링크·외부 포인터 정합
        const p = deps.proposeStage(item);        // ②③ 후보검색 + 로컬판정
        if (p) {                                  // ④ 큐 기록(자동 적용 없음)
          const r = deps.recordStage(p);
          if (r.suppressed) m.suppressed += 1;
          else m.proposals += p.items.length;
        }
        ok = true;
        break;
      } catch {
        if (attempt < maxRetry) { m.retries += 1; continue; }
        m.errors += 1; // fail-closed — 이 건만 실패, 다음 건 계속(사이클 안 죽음)
      }
    }
    m.processed += 1;
    try { deps.checkpoint?.(item, ok); } catch { /* fail-soft */ }
  }

  m.durationMs = now() - t0;
  try { deps.emitMetrics?.(m); } catch { /* fail-soft */ }
  return m;
}

export interface ApplyApprovedDeps {
  /** 승인 proposal 원자 적용(주입: applyCurationProposal — snapshot·비삭제·archive-only). 적용 수 반환. */
  applyProposal: (p: CurationProposal) => number;
  /** 적용 후 링크 재검사 → 남은 broken 링크 수(주입: docs-lint). */
  recheckBrokenLinks: () => number;
  /** verified 전이(주입: 큐 상태). */
  markVerified: (idempotencyKey: string) => void;
}

/**
 * 승인 적용 게이트 — 승인된 대표 배치만 snapshot 후 원자 적용 → 링크 재검사 성공(broken=0) 시 verified.
 * 승인 안 된 proposal 은 어떤 문서도 변경하지 않는다(status !== 'approved' → applied 0).
 */
export function applyApprovedBatch(
  proposal: CurationProposal, deps: ApplyApprovedDeps,
): { applied: number; verified: boolean } {
  if (proposal.status !== 'approved') return { applied: 0, verified: false }; // 미승인 → 문서 무변경
  const applied = deps.applyProposal(proposal); // snapshot·비삭제·archive-only 는 applyCurationProposal 이 보장
  const broken = deps.recheckBrokenLinks();
  const verified = broken === 0;
  if (verified) deps.markVerified(proposal.idempotencyKey);
  return { applied, verified };
}
