// slang_dict HITL 검토 단위테스트 — 승인/기각/게이트(인메모리 DB).
import { describe, test, expect } from 'bun:test';
import { openSlangDict, loadSlangEntries } from './slang-dict.js';
import { addEvolvedEntries } from './dict-evolve.js';
import { listPendingSlang, pendingSlangCount, approveSlang, rejectSlang, approveAllPendingSlang } from './slang-review.js';

function seedEvolved(db: ReturnType<typeof openSlangDict>): void {
  addEvolvedEntries(db, [
    { term: '반도체', canonical: '반도체 산업', type: 'entity', lang: 'ko' },
    { term: '나스닥', canonical: '나스닥', type: 'entity', lang: 'ko' },
    { term: '엘엔에프', canonical: '엘앤에프', type: 'ticker', lang: 'ko', ticker: '066970.KO' },
  ], 'llm', 0.6);
}

describe('slang HITL 검토', () => {
  test('listPending/count — 자율(llm) 항목만, seed 제외', () => {
    const db = openSlangDict(':memory:');
    seedEvolved(db);
    const pending = listPendingSlang(db);
    expect(pending.length).toBe(3);
    expect(pendingSlangCount(db)).toBe(3);
    expect(pending.every(p => p.source === 'llm')).toBe(true);
    // seed(삼전 등)는 대기 목록에 없음
    expect(pending.find(p => p.term === '삼전')).toBeUndefined();
  });

  test('approve → source=hitl·활성 편입·대기 감소', () => {
    const db = openSlangDict(':memory:');
    seedEvolved(db);
    const n = approveSlang(db, ['반도체', '없는용어']);
    expect(n).toBe(1); // 반도체만 승격(없는용어 무시)
    expect(pendingSlangCount(db)).toBe(2);
    // 승인 후 onlyReviewed 로드에 포함
    const reviewed = loadSlangEntries(db, { onlyReviewed: true }).map(e => e.term);
    expect(reviewed).toContain('반도체');
    expect(reviewed).not.toContain('나스닥'); // 미승인
  });

  test('reject → 삭제·대기 감소·seed 는 못 지움', () => {
    const db = openSlangDict(':memory:');
    seedEvolved(db);
    expect(rejectSlang(db, ['나스닥'])).toBe(1);
    expect(pendingSlangCount(db)).toBe(2);
    expect(rejectSlang(db, ['삼전'])).toBe(0); // seed 는 게이트 밖 — 미삭제
  });

  test('approve-all → 전량 승격', () => {
    const db = openSlangDict(':memory:');
    seedEvolved(db);
    expect(approveAllPendingSlang(db)).toBe(3);
    expect(pendingSlangCount(db)).toBe(0);
  });
});

describe('loadSlangEntries 게이트', () => {
  test('onlyReviewed 는 자율 제안 제외·기본은 전체', () => {
    const db = openSlangDict(':memory:');
    seedEvolved(db);
    const all = loadSlangEntries(db);
    const reviewed = loadSlangEntries(db, { onlyReviewed: true });
    expect(all.length).toBeGreaterThan(reviewed.length);
    expect(all.length - reviewed.length).toBe(3); // 자율 3건 차이
    expect(reviewed.find(e => e.term === '반도체')).toBeUndefined(); // 미검토 제외
    expect(reviewed.find(e => e.term === '삼전')).toBeTruthy();      // seed 포함
  });
});
