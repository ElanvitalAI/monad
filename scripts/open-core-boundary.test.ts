import { describe, expect, test } from 'bun:test';
import { computeBoundary, judgeCapability, judgeCredential, loadAssets } from './open-core-boundary.js';

// ⛔⭐ 이 시험은 «저장소의 현재 내용»을 박지 않는다.
//   📏 2026-09-22~23 에 형제 시험(resource-map-check.test.ts)이 ***네 번*** 깨졌고 네 번 다 원인이
//     「지금 몇 개가 비어 있나」를 단언한 것이었다. 구멍을 닫는 것이 «의도된 작업»인데 그 작업이
//     자를 빨갛게 만들면 ***자가 개선을 벌한다.***
//   ⇒ 여기서는 판정 «규칙»을 픽스처로 누르고, 실물엔 «성질»만 묻는다.

describe('judgeCredential', () => {
  test('대표 boundary override beats the mechanical rule in both directions', () => {
    expect(judgeCredential({ id: 'a', boundary: 'core', auth: 'api-key', free_fallback_mode: 'none' }).core).toBe(true);
    expect(judgeCredential({ id: 'b', boundary: 'addon', auth: 'none' }).core).toBe(false);
  });

  test('auth: none and free_fallback_mode: auto are core; manual and none are not', () => {
    expect(judgeCredential({ id: 'c', auth: 'none' }).core).toBe(true);
    expect(judgeCredential({ id: 'd', auth: 'api-key', free_fallback_mode: 'auto' }).core).toBe(true);
    expect(judgeCredential({ id: 'e', auth: 'api-key', free_fallback_mode: 'manual' }).core).toBe(false);
    expect(judgeCredential({ id: 'f', auth: 'api-key', free_fallback_mode: 'none' }).core).toBe(false);
  });

  test('a row with no mode reads as UNCLASSIFIED, not as an add-on decision', () => {
    const verdict = judgeCredential({ id: 'g', auth: 'api-key' });
    expect(verdict.core).toBe(false);
    // 🔑 「애드온이다」와 「아직 안 정했다」는 다른 값이다 — because 가 그것을 말한다.
    expect(verdict.because).toContain('unclassified');
  });

  test('every verdict carries its reason', () => {
    for (const row of [{ id: 'h', auth: 'none' }, { id: 'i', free_fallback_mode: 'auto' }, { id: 'j' }]) {
      expect(judgeCredential(row).because.length).toBeGreaterThan(0);
    }
  });
});

describe('judgeCapability', () => {
  test('tier free is core; owned and metered are not', () => {
    expect(judgeCapability({ id: 'ffmpeg', tier: 'free' }).core).toBe(true);
    expect(judgeCapability({ id: 'resolve', tier: 'owned' }).core).toBe(false);
    expect(judgeCapability({ id: 'higgsfield', tier: 'metered' }).core).toBe(false);
  });
});

describe('computeBoundary', () => {
  test('ORs the two axes without merging them, and never loses a row', () => {
    const report = computeBoundary(
      [{ id: 'keyless', auth: 'none' }, { id: 'paid', auth: 'api-key', free_fallback_mode: 'none' }],
      [{ id: 'ffmpeg', tier: 'free' }, { id: 'resolve', tier: 'owned' }],
    );
    expect(report.core.map((v) => v.id).sort()).toEqual(['ffmpeg', 'keyless']);
    expect(report.addon.map((v) => v.id).sort()).toEqual(['paid', 'resolve']);
    expect(report.core.length + report.addon.length).toBe(4);
  });

  test('names a row whose two axes disagree instead of letting one side win silently', () => {
    const report = computeBoundary(
      [{ id: 'macos-say', auth: 'api-key', free_fallback_mode: 'none' }],
      [{ id: 'macos-say', tier: 'free' }],
    );
    expect(report.conflicts).toEqual([{ id: 'macos-say', credential: false, capability: true }]);
  });

  test('agreeing rows produce no conflict', () => {
    const report = computeBoundary([{ id: 'x', auth: 'none' }], [{ id: 'x', tier: 'free' }]);
    expect(report.conflicts).toEqual([]);
  });

  test('surfaces unclassified credential rows by name', () => {
    const report = computeBoundary([{ id: 'todo', auth: 'api-key' }, { id: 'done', auth: 'none' }], []);
    expect(report.unclassified).toEqual(['todo']);
  });
});

describe('against the real repository', () => {
  // ⛔ 수를 박지 않는다 — 성질만 묻는다.
  test('both assets load and every verdict is attributed to an axis', () => {
    const { rows, impls } = loadAssets(process.cwd());
    expect(rows.length).toBeGreaterThan(0);
    expect(impls.length).toBeGreaterThan(0);
    const report = computeBoundary(rows, impls);
    for (const v of [...report.core, ...report.addon]) {
      expect(['credential', 'capability']).toContain(v.axis);
      expect(v.because.length).toBeGreaterThan(0);
    }
    expect(report.core.length + report.addon.length).toBe(rows.length + impls.length);
  }, 30_000);
});
