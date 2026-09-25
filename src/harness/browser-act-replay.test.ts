// 재현 판정 — ⛔ 「됐나」가 아니라 ***「그때와 갈렸나」***이고, 실패는 «자기 이름을 대야» 한다.
import { describe, expect, test } from 'bun:test';
import { judgeReplayStep } from './browser-act-replay.js';


describe('실패한 걸음은 «자기 이름을 댄다» (2026-08-28)', () => {
  // ⛔ 실물에서 재현 2걸음이 「지금 이 조작이 «실패했다»」로만 끝나, 산출만 보고는
  //    무엇이 실패했는지(없는 페르소나였다) 알 수 없었다. 라벨은 셀 수만 있고 고칠 수 없다.
  const step = { index: 0, url: 'https://x.test', target: 'a', tolerancePx: 8,
    then: { coordinates: { x: 1, y: 1 }, captureOutcome: 'ok', ok: true } };

  test('이유를 주면 «그 이유가» 산출에 실린다', () => {
    const r = judgeReplayStep({ ...step,
      now: { coordinates: null, captureOutcome: null, ok: false, reason: 'execution-failed: unknown persona "ghost"' } });
    expect(r.outcome).toBe('failed');
    expect(r.detail).toContain('unknown persona "ghost"');
  });

  test('이유를 «안» 주면 그 사실을 «말한다» — 조용히 넘어가지 않는다', () => {
    const r = judgeReplayStep({ ...step, now: { coordinates: null, captureOutcome: null, ok: false } });
    expect(r.outcome).toBe('failed');
    expect(r.detail).toContain('이유가 «안 넘어왔다»');
  });

  test('빈 문면도 «없는 것»으로 본다 — 빈 칸을 이유로 내놓지 않는다', () => {
    const r = judgeReplayStep({ ...step, now: { coordinates: null, captureOutcome: null, ok: false, reason: '   ' } });
    expect(r.detail).toContain('이유가 «안 넘어왔다»');
  });

  test('성공한 걸음에는 이유가 «안» 붙는다', () => {
    const r = judgeReplayStep({ ...step,
      now: { coordinates: { x: 1, y: 1 }, captureOutcome: 'ok', ok: true, reason: '엉뚱한 이유' } });
    expect(r.outcome).toBe('same');
    expect(r.detail).not.toContain('엉뚱한 이유');
  });
});

describe('목적지로 판정한다 (2026-08-28)', () => {
  // ⛔⭐ 좌표는 «배치»가 바뀌면 흔들린다. 「어디로 갔나」는 «의미»다.
  const at = (over: Record<string, unknown> = {}) => ({
    index: 0, url: 'https://x.test', target: 'a', tolerancePx: 8,
    then: { coordinates: { x: 10, y: 10 }, captureOutcome: 'ok', ok: true, landedUrl: 'https://dest.test/a' },
    now: { coordinates: { x: 10, y: 10 }, captureOutcome: 'ok', ok: true, landedUrl: 'https://dest.test/a' },
    ...over,
  });

  test('좌표가 «움직여도» 목적지가 같으면 갈린 것이 아니다 — 그리고 그 이유를 말한다', () => {
    const r = judgeReplayStep(at({ now: { coordinates: { x: 400, y: 900 }, captureOutcome: 'ok', ok: true, landedUrl: 'https://dest.test/a' } }));
    expect(r.outcome).toBe('same');
    expect(r.detail).toContain('배치 변화');
  });

  test('좌표가 «같아도» 목적지가 다르면 갈린 것이다 — 좌표만 보면 못 잡는다', () => {
    const r = judgeReplayStep(at({ now: { coordinates: { x: 10, y: 10 }, captureOutcome: 'ok', ok: true, landedUrl: 'https://other.test/z' } }));
    expect(r.outcome).toBe('differs');
    expect(r.detail).toContain('목적지 https://dest.test/a → https://other.test/z');
  });

  test('둘 다 같으면 «둘 다 같다»고 말한다 — 무엇으로 같다고 했는지 밝힌다', () => {
    const r = judgeReplayStep(at());
    expect(r.outcome).toBe('same');
    expect(r.detail).toContain('목적지·좌표 둘 다 같다');
  });

  test('옛 행(목적지 «없음»)이면 좌표로 되돌아가고 «못 쟀다»고 말한다', () => {
    const r = judgeReplayStep({ index: 0, url: 'https://x.test', target: 'a', tolerancePx: 8,
      then: { coordinates: { x: 10, y: 10 }, captureOutcome: 'ok', ok: true },
      now: { coordinates: { x: 12, y: 11 }, captureOutcome: 'ok', ok: true } });
    expect(r.outcome).toBe('same');
    expect(r.detail).toContain('목적지는 «못 쟀다»');
  });

  test('한쪽만 목적지가 있으면 «비교하지 않는다» — 없는 것을 다르다고 하지 않는다', () => {
    const r = judgeReplayStep(at({ now: { coordinates: { x: 10, y: 10 }, captureOutcome: 'ok', ok: true } }));
    expect(r.outcome).toBe('same');
    expect(r.detail).toContain('못 쟀다');
  });

  test('목적지가 같아도 «화면 결과»가 갈리면 그것은 갈린 것이다', () => {
    const r = judgeReplayStep(at({ now: { coordinates: { x: 10, y: 10 }, captureOutcome: 'timeout', ok: true, landedUrl: 'https://dest.test/a' } }));
    expect(r.outcome).toBe('differs');
    expect(r.detail).toContain('화면 ok → timeout');
  });
});
