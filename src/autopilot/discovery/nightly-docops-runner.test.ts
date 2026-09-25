import { describe, it, expect } from 'bun:test';
import type { CurationProposal } from './doc-curation.js';
import {
  runNightlyDocOpsCycle, applyApprovedBatch, assertLoopbackModelUrl,
  type NightlyDeps, type NightlyItem,
} from './nightly-docops-runner.js';

describe('assertLoopbackModelUrl — 로컬 전용 가드', () => {
  it('loopback URL 통과', () => {
    expect(() => assertLoopbackModelUrl('http://localhost:11434/v1')).not.toThrow();
    expect(() => assertLoopbackModelUrl('http://127.0.0.1:11434/v1')).not.toThrow();
  });
  it('미설정(undefined) 통과 — 외부 호출 없음', () => {
    expect(() => assertLoopbackModelUrl(undefined)).not.toThrow();
  });
  it('비-loopback URL 거부(원격)', () => {
    expect(() => assertLoopbackModelUrl('https://api.openai.com/v1')).toThrow('비-loopback');
    expect(() => assertLoopbackModelUrl('http://192.168.1.5:11434')).toThrow('비-loopback');
  });
});

const proposal = (status: CurationProposal['status'] = 'proposed', items = 1): CurationProposal => ({
  generatedAt: '2026-07-14T00:00:00Z', scanned: 1,
  items: Array.from({ length: items }, () => ({
    action: 'add' as const, path: 'docs/wiki/WIKI-x.md', targetDocument: 'docs/wiki/WIKI-x.md',
    filename: 'WIKI-x.md', reason: 'r', evidenceQuote: 'q', sourcePath: 'docs/H.md', diff: 'd',
    confidence: 0.8, detectorVersion: 'v1', inboundRefs: 0,
  })),
  status, inputDocumentHash: 'h', model: 'deterministic', promptVersion: 'v1', schemaVersion: 'v1', idempotencyKey: 'k1',
});

const deps = (over: Partial<NightlyDeps> = {}): NightlyDeps => ({
  selectBatch: (n) => Array.from({ length: n }, (_, i) => ({ path: `docs/D${i}.md` })),
  lintStage: () => 1,
  proposeStage: () => proposal(),
  recordStage: () => ({ suppressed: false }),
  assertLocalOnly: () => {},
  now: () => 1000,
  ...over,
});

describe('runNightlyDocOpsCycle', () => {
  it('batchLimit 10~20 클램프(상한 20)', async () => {
    // ⛔⭐ 리뷰 should-fix(2026-07-30) — 이 export 는 **동기 반환 → Promise 반환**으로 계약이 바뀌었다.
    //    프로덕션 호출부는 `scripts/nightly-docops.ts:50` 하나이고 이미 `await` 한다(전수 확인).
    //    그 계약을 회귀로 고정한다 — 누가 동기로 되돌리면 여기서 깨진다.
    const pending = runNightlyDocOpsCycle(deps(), { batchLimit: 0 });
    expect(typeof (pending as unknown as { then?: unknown }).then).toBe('function');
    await pending;   // ⛔ 누수 금지(리뷰 should-fix) — 검사한 그 Promise 를 그대로 기다린다
    const m = await runNightlyDocOpsCycle(deps(), { batchLimit: 50 });
    expect(m.processed).toBe(20);
  });
  it('하한 1', async () => {
    const m = await runNightlyDocOpsCycle(deps(), { batchLimit: 0 });
    expect(m.processed).toBe(1);
  });

  it('1-worker 직렬 — 순서대로 처리', async () => {
    const order: string[] = [];
    await runNightlyDocOpsCycle(deps({
      selectBatch: () => [{ path: 'A' }, { path: 'B' }, { path: 'C' }],
      lintStage: (it) => { order.push(it.path); return 0; },
    }), { batchLimit: 3 });
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('로컬 전용 가드 fail-closed — 위반이면 아무 것도 처리 안 함', async () => {
    let processed = false;
    await expect(runNightlyDocOpsCycle(deps({
      assertLocalOnly: () => { throw new Error('외부 egress 감지'); },
      selectBatch: () => { processed = true; return []; },
    }))).rejects.toThrow('외부 egress');
    expect(processed).toBe(false); // selectBatch 도 안 불림(사전 가드)
  });

  it('건별 fail-closed — 한 건 실패해도 사이클 계속', async () => {
    let n = 0;
    const m = await runNightlyDocOpsCycle(deps({
      selectBatch: () => [{ path: 'A' }, { path: 'B' }, { path: 'C' }],
      lintStage: () => { if (n++ === 1) throw new Error('B 실패'); return 1; },
    }), { batchLimit: 3, maxRetryPerItem: 0 });
    expect(m.processed).toBe(3); // 전부 처리 시도
    expect(m.errors).toBe(1);    // B 만 실패
  });

  it('제한 재시도 — maxRetry 후 실패 기록', async () => {
    const m = await runNightlyDocOpsCycle(deps({
      selectBatch: () => [{ path: 'A' }],
      lintStage: () => { throw new Error('always'); },
    }), { batchLimit: 1, maxRetryPerItem: 2 });
    expect(m.retries).toBe(2);
    expect(m.errors).toBe(1);
  });

  it('건별 checkpoint 호출 + 메트릭 방출', async () => {
    const cps: Array<{ path: string; ok: boolean }> = [];
    let emitted: unknown = null;
    const m = await runNightlyDocOpsCycle(deps({
      selectBatch: () => [{ path: 'A' }, { path: 'B' }],
      checkpoint: (it, ok) => cps.push({ path: it.path, ok }),
      emitMetrics: (mm) => { emitted = mm; },
    }), { batchLimit: 2 });
    expect(cps).toEqual([{ path: 'A', ok: true }, { path: 'B', ok: true }]);
    expect(emitted).toBe(m);
    expect(m.proposals).toBe(2); // 2건 × 1 item
  });

  it('멱등 억제 카운트 — recordStage suppressed', async () => {
    const m = await runNightlyDocOpsCycle(deps({
      selectBatch: () => [{ path: 'A' }],
      recordStage: () => ({ suppressed: true }),
    }), { batchLimit: 1 });
    expect(m.suppressed).toBe(1);
    expect(m.proposals).toBe(0);
  });

  it('staleness 단계를 생략하면 기존 metrics shape와 문서별 동작을 보존한다', async () => {
    const m = await runNightlyDocOpsCycle(deps({ selectBatch: () => [{ path: 'A' }] }), { batchLimit: 1 });
    expect(m.staleness).toBeUndefined();
    expect(m.processed).toBe(1);
    expect(m.candidates).toBe(1);
  });

  it('staleness 단계를 사이클당 한 번 실행하고 목록 상한과 축별 수를 보존한다', async () => {
    let calls = 0;
    const m = await runNightlyDocOpsCycle(deps({
      stalenessStage: () => {
        calls += 1;
        return {
          checked: 3169,
          byAxis: { removedIdentifiers: 46, brokenLinks: 628, supersededMarked: 41, staleScoreOverThreshold: 107 },
          removedIdentifierDocuments: Array.from({ length: 21 }, (_, index) => `docs/D${index}.md`),
        };
      },
    }), { batchLimit: 3 });
    expect(calls).toBe(1);
    expect(m.staleness).toEqual({
      status: 'measured', checked: 3169,
      byAxis: { removedIdentifiers: 46, brokenLinks: 628, supersededMarked: 41, staleScoreOverThreshold: 107 },
      removedIdentifierDocuments: Array.from({ length: 20 }, (_, index) => `docs/D${index}.md`),
      removedIdentifierDocumentsTruncated: true,
    });
  });

  it('staleness 단계 실패를 0이 아닌 failed 상태로 내고 문서별 사이클을 계속한다', async () => {
    const m = await runNightlyDocOpsCycle(deps({
      selectBatch: () => [{ path: 'A' }, { path: 'B' }],
      stalenessStage: () => { throw new Error('git archive unavailable'); },
    }), { batchLimit: 2 });
    expect(m.staleness).toEqual({ status: 'failed', error: 'git archive unavailable' });
    expect(m.processed).toBe(2);
    expect(m.candidates).toBe(2);
  });
});

describe('applyApprovedBatch — 승인 게이트', () => {
  it('미승인 proposal 은 문서 무변경', () => {
    let applied = false;
    const r = applyApprovedBatch(proposal('proposed'), {
      applyProposal: () => { applied = true; return 1; },
      recheckBrokenLinks: () => 0,
      markVerified: () => {},
    });
    expect(r.applied).toBe(0);
    expect(applied).toBe(false); // applyProposal 안 불림
  });

  it('승인 + 링크 재검사 clean → verified', () => {
    let verifiedKey = '';
    const r = applyApprovedBatch(proposal('approved'), {
      applyProposal: () => 1,
      recheckBrokenLinks: () => 0, // broken 0 → verified
      markVerified: (k) => { verifiedKey = k; },
    });
    expect(r.applied).toBe(1);
    expect(r.verified).toBe(true);
    expect(verifiedKey).toBe('k1');
  });

  it('승인 but 링크 재검사 실패 → verified 아님', () => {
    const r = applyApprovedBatch(proposal('approved'), {
      applyProposal: () => 1,
      recheckBrokenLinks: () => 3, // 여전히 broken → verified 아님
      markVerified: () => { throw new Error('불려선 안 됨'); },
    });
    expect(r.verified).toBe(false);
  });
});
