import { test, expect } from 'bun:test';
import { savePendingRedesign, readPendingRedesign, clearPendingRedesign } from './mission-pending-redesign.js';

test('pending-redesign 라운드트립 save→read→clear (CC3)', () => {
  const id = 'test-cc3-redesign-roundtrip';
  clearPendingRedesign(id);
  expect(readPendingRedesign(id)).toBeNull();
  savePendingRedesign(id, '역제안: [미션 A] YouTube 계약 · [미션 B] Obsidian 저장 · [미션 C] 전달 어댑터');
  const r = readPendingRedesign(id);
  expect(r?.comment).toContain('미션 A');
  expect(r?.at).toBeDefined();
  clearPendingRedesign(id);
  expect(readPendingRedesign(id)).toBeNull();
});

test('save 최신 우선 갱신', () => {
  const id = 'test-cc3-redesign-latest';
  savePendingRedesign(id, '첫 역제안');
  savePendingRedesign(id, '갱신 역제안');
  expect(readPendingRedesign(id)?.comment).toBe('갱신 역제안');
  clearPendingRedesign(id);
});
