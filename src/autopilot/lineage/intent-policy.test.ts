// Lineage intent→정책 단일 관문 — 순수 판정 테스트 (H0 · RFC §3d 매트릭스 각인)
import { describe, expect, it } from 'bun:test';
import {
  mayReuseGrounding,
  mayReuseResearch,
  resolveLineagePolicy,
} from './intent-policy.js';
import { LINEAGE_STORE_KINDS } from './types.js';

describe('resolveLineagePolicy — 캐시 intent 규칙(RFC §3d)', () => {
  it('revise(골 유지) — research·grounding 둘 다 재사용', () => {
    const p = resolveLineagePolicy('revise');
    expect(p.cache).toEqual({ research: 'reuse', grounding: 'reuse' });
  });

  it('revise-goal(골 변경) — 둘 다 무효', () => {
    const p = resolveLineagePolicy('revise-goal');
    expect(p.cache).toEqual({ research: 'invalidate', grounding: 'invalidate' });
  });

  it('redecompose(재분해) — 분해 로직만 틀림·둘 다 재사용(캐시 존재 이유)', () => {
    const p = resolveLineagePolicy('redecompose');
    expect(p.cache).toEqual({ research: 'reuse', grounding: 'reuse' });
  });

  it('★ redesign(전제 전환) — research 강제 무효·grounding 유지(신규 규칙)', () => {
    const p = resolveLineagePolicy('redesign');
    expect(p.cache.research).toBe('invalidate');
    expect(p.cache.grounding).toBe('reuse');
    expect(mayReuseResearch('redesign')).toBe(false);
    expect(mayReuseGrounding('redesign')).toBe(true);
  });

  it('rerun(구현 실패) — 새 코드 재조사(grounding 무효)·research 재사용', () => {
    const p = resolveLineagePolicy('rerun');
    expect(p.cache).toEqual({ research: 'reuse', grounding: 'invalidate' });
  });
});

describe('resolveLineagePolicy — 스토어 생애주기(cancel)', () => {
  it('cancel-purge — 5-way(파일 스토어) 냉동보관·observation(logs)은 keep', () => {
    const p = resolveLineagePolicy('cancel-purge');
    // ⑥ observation 은 logs.db pull-through(미션 고유 파일 없음·전역 telemetry) → keep.
    for (const k of LINEAGE_STORE_KINDS) {
      expect(p.stores[k]).toBe(k === 'observation' ? 'keep' : 'cold-archive');
    }
  });

  it('cancel-defer — 행 유지·전부 keep(정리 안 함)', () => {
    const p = resolveLineagePolicy('cancel-defer');
    for (const k of LINEAGE_STORE_KINDS) expect(p.stores[k]).toBe('keep');
  });

  it('재실행 계열 — 스토어는 보존(keep·세대전환)', () => {
    for (const intent of ['revise', 'redecompose', 'redesign', 'rerun']) {
      const p = resolveLineagePolicy(intent);
      for (const k of LINEAGE_STORE_KINDS) expect(p.stores[k]).toBe('keep');
    }
  });

  it('미지 intent — 안전 기본(전부 keep·캐시 무효)', () => {
    const p = resolveLineagePolicy('unknown-xyz');
    for (const k of LINEAGE_STORE_KINDS) expect(p.stores[k]).toBe('keep');
    expect(p.cache).toEqual({ research: 'invalidate', grounding: 'invalidate' });
  });
});
