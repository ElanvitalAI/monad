import { describe, it, expect } from 'bun:test';
import { pruneExpiredPublications, type PublishLifecycleStore } from './publish-lifecycle.js';
import { PERMANENT_EXPIRES_AT } from './types.js';

// ★ 라이프사이클 GC — 만료→콜드 백업(삭제 아님)·permanent 자동 보존.
const NOW = Date.parse('2027-01-01T00:00:00.000Z');
const doc = (id: string, expiresAt: string) => ({ id: id as any, manifest: { expiresAt } as any });

function fakeStore(docs: ReturnType<typeof doc>[]): { store: PublishLifecycleStore; deleted: string[] } {
  const deleted: string[] = [];
  return { store: { list: () => docs, delete: (id) => deleted.push(id) }, deleted };
}

describe('pruneExpiredPublications', () => {
  it('만료 게시물 → 콜드 백업 + 로컬 정리', () => {
    const { store, deleted } = fakeStore([doc('a', '2026-01-01T00:00:00.000Z'), doc('b', '2026-06-01T00:00:00.000Z')]);
    const archived: string[] = [];
    const r = pruneExpiredPublications({ store, archiveToS3Cold: (id) => archived.push(id), now: () => NOW });
    expect(r.archived.sort()).toEqual(['a', 'b']);
    expect(archived.sort()).toEqual(['a', 'b']); // S3 콜드 이관됨
    expect(deleted.sort()).toEqual(['a', 'b']);  // 로컬 hot 정리
    expect(r.kept).toBe(0);
  });

  it('유효(만료 전) 게시물 → 보존(콜드 이관 안 함)', () => {
    const { store, deleted } = fakeStore([doc('fresh', '2028-01-01T00:00:00.000Z')]);
    const archived: string[] = [];
    const r = pruneExpiredPublications({ store, archiveToS3Cold: (id) => archived.push(id), now: () => NOW });
    expect(r.kept).toBe(1);
    expect(r.archived).toEqual([]);
    expect(archived).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('★ permanent(far-future expiresAt) → 자동 보존(콜드 이관 제외)', () => {
    const { store, deleted } = fakeStore([doc('perm', PERMANENT_EXPIRES_AT)]);
    const r = pruneExpiredPublications({ store, archiveToS3Cold: () => { throw new Error('permanent 는 이관 대상 아님'); }, now: () => NOW });
    expect(r.kept).toBe(1);
    expect(r.archived).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('콜드 이관 실패 → errors 기록·로컬 유지(다음 회차 재시도)', () => {
    const { store, deleted } = fakeStore([doc('x', '2026-01-01T00:00:00.000Z')]);
    const r = pruneExpiredPublications({ store, archiveToS3Cold: () => { throw new Error('s3 down'); }, now: () => NOW });
    expect(r.archived).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.id).toBe('x');
    expect(deleted).toEqual([]); // 이관 실패 시 로컬 삭제 안 함(백업 보장)
  });
});
