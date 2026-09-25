// M2 memory Glacier — cold 기억 S3 이관·복원 단위테스트(in-memory S3 mock).
import { describe, test, expect } from 'bun:test';
import { openSurfaceEventsDb, recordEvent, queryEvents, applyMemoryDecay } from './surface-events.js';
import { archiveColdEvents, restoreFromArchive, searchArchive, ensureArchiveTable, withReconsolidation, type ArchiveS3Deps } from './memory-archive.js';

// in-memory S3 mock (aws cli 없이 계층 로직 검증).
function mockS3(): ArchiveS3Deps & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    available: () => true,
    put: (id, json) => { store.set(id, json); },
    get: (id) => store.get(id) ?? null,
  };
}

const old = (days: number) => new Date(Date.now() - days * 8.64e7).toISOString();

describe('archiveColdEvents — cold 기억 S3 이관(삭제 아님)', () => {
  test('cold 는 S3 보관 + 로컬 events 제거 + 메타 잔류, hot/warm 은 유지', () => {
    const db = openSurfaceEventsDb(':memory:');
    const s3 = mockS3();
    // cold 될 낡은 저현저
    recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: '낡은 삼성 발송', summary: '삼성 낡음', importance: 3, ts: old(300) });
    // hot 유지될 최근 중요
    recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'alert', text: '최근 중요', importance: 9, ts: old(1) });
    applyMemoryDecay(db);                       // 1건 cold, 1건 hot

    const r = archiveColdEvents(db, s3);
    expect(r.archived).toBe(1);
    expect(s3.store.size).toBe(1);              // S3 에 본문 보관
    // 로컬 events 에서 cold 제거(hot 만 남음)
    const local = queryEvents(db, {});
    expect(local.length).toBe(1);
    expect(local[0]!.importance).toBe(9);       // hot 만 잔류
    // 메타는 events_archive 에 잔류(존재는 앎)
    expect(searchArchive(db, '삼성').length).toBe(1);
    db.close();
  });

  test('S3 불가 시 no-op(로컬 보존)', () => {
    const db = openSurfaceEventsDb(':memory:');
    recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: '낡음', importance: 3, ts: old(300) });
    applyMemoryDecay(db);
    const r = archiveColdEvents(db, { available: () => false, put: () => {}, get: () => null });
    expect(r.archived).toBe(0);
    expect(queryEvents(db, {}).length).toBe(1); // 로컬 보존
    db.close();
  });
});

describe('restoreFromArchive — 느린 복원(S3 fetch → events 재삽입·미엘린 강화)', () => {
  test('복원 시 events 재삽입 + recall_count++ + tier=warm + 메타 제거', () => {
    const db = openSurfaceEventsDb(':memory:');
    const s3 = mockS3();
    const id = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: '아카이브될 KORU 발송', summary: 'KORU 재진입', importance: 3, ts: old(300) });
    applyMemoryDecay(db);
    archiveColdEvents(db, s3);
    expect(queryEvents(db, {}).length).toBe(0); // 로컬 비었음(아카이브됨)

    const restored = restoreFromArchive(db, id, s3);
    expect(restored).not.toBeNull();
    const local = queryEvents(db, {});
    expect(local.length).toBe(1);                // 복원됨
    expect(local[0]!.tier).toBe('warm');         // 재활성화(warm)
    expect(local[0]!.recall_count).toBe(1);      // 복원=회상→미엘린 강화
    expect(searchArchive(db, 'KORU').length).toBe(0); // 메타 제거(events 로 이동)
    db.close();
  });

  test('메타 없음/S3 미존재 → null', () => {
    const db = openSurfaceEventsDb(':memory:');
    ensureArchiveTable(db);
    expect(restoreFromArchive(db, 'nope', mockS3())).toBeNull();
    db.close();
  });

  test('★ B4 — 복원 시 refs 에 reconsolidations 마커 누적(비파괴·감사)', () => {
    const db = openSurfaceEventsDb(':memory:');
    const s3 = mockS3();
    const id = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'digest', text: '재응고 대상', summary: 'KORU', importance: 3, refs: JSON.stringify({ signalId: 'z' }), ts: old(300) });
    applyMemoryDecay(db);
    archiveColdEvents(db, s3);
    const restored = restoreFromArchive(db, id, s3);
    const refs = JSON.parse(restored!.refs as string) as { signalId: string; reconsolidations: number };
    expect(refs.reconsolidations).toBe(1);   // 첫 reconsolidation
    expect(refs.signalId).toBe('z');         // 기존 refs 보존(비파괴)
    // DB 에도 반영.
    const local = queryEvents(db, {});
    expect(JSON.parse(local[0]!.refs as string).reconsolidations).toBe(1);
    db.close();
  });
});

describe('withReconsolidation — reconsolidation 카운트 비파괴 누적', () => {
  test('기존 refs 보존 + reconsolidations 증분', () => {
    expect(JSON.parse(withReconsolidation(JSON.stringify({ a: 1 })))).toEqual({ a: 1, reconsolidations: 1 });
    expect(JSON.parse(withReconsolidation(JSON.stringify({ reconsolidations: 2 })))).toEqual({ reconsolidations: 3 });
  });
  test('null/빈/비JSON refs → 새로 시작(fail-soft)', () => {
    expect(JSON.parse(withReconsolidation(null))).toEqual({ reconsolidations: 1 });
    expect(JSON.parse(withReconsolidation(''))).toEqual({ reconsolidations: 1 });
    expect(JSON.parse(withReconsolidation('not json'))).toEqual({ reconsolidations: 1 });
  });
});
