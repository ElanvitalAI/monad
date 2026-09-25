// C5a (2026-07-16) — 공통 스트리밍 코어(single-flight keep-latest 편집 루프). 결정론 테스트:
// 가짜 시계 + 수동 타이머 큐 주입. throttle·keep-latest·dedup·minInitialChars·retry_after
// suspend·maxFailures·flush·generation guard 검증.

import { describe, test, expect } from 'bun:test';
import { createDraftStreamLoop, type DraftStreamLoopDeps } from '../src/session/streaming/draft-stream-loop.js';

/** 결정론 하니스 — 가짜 시계 + 수동 타이머 큐. advance(ms) 로 시간 진행 + due 콜백 발화. */
function harness() {
  let t = 1_000_000; // 큰 시작값(현실 Date.now 유사)
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const edits: string[] = [];
  let editImpl: (text: string) => Promise<void> = async (text) => { edits.push(text); };
  const deps: DraftStreamLoopDeps = {
    edit: (text) => editImpl(text),
    now: () => t,
    schedule: (fn, ms) => {
      const entry = { at: t + ms, fn, cancelled: false };
      timers.push(entry);
      return () => { entry.cancelled = true; };
    },
  };
  return {
    deps, edits,
    setEdit: (fn: (text: string) => Promise<void>) => { editImpl = fn; },
    /** 시간 진행 + due 타이머 발화 + 마이크로태스크 flush. */
    async advance(ms: number) {
      t += ms;
      const due = timers.filter((e) => !e.cancelled && e.at <= t).sort((a, b) => a.at - b.at);
      for (const e of due) { e.cancelled = true; e.fn(); await flushMicro(); }
      await flushMicro();
    },
    async tick() { await flushMicro(); },
  };
}
function flushMicro(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }

describe('createDraftStreamLoop', () => {
  test('첫 update 는 즉시 편집(throttle 미적용)', async () => {
    const h = harness();
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 1000 });
    loop.update('a');
    await h.tick();
    expect(h.edits).toEqual(['a']);
  });

  test('keep-latest — throttle 창 내 연속 update 는 최신만 전송', async () => {
    const h = harness();
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 1000 });
    loop.update('a');        // 즉시 전송
    await h.tick();
    loop.update('ab');       // 창 내 — 지연
    loop.update('abc');      // 최신으로 덮음
    await h.tick();
    expect(h.edits).toEqual(['a']);          // 아직 2번째 미전송
    await h.advance(1000);                    // throttle 경과
    expect(h.edits).toEqual(['a', 'abc']);   // 최신만(ab 는 drop)
  });

  test('saturated dedup — 마지막 전송과 동일 텍스트는 편집 스킵', async () => {
    const h = harness();
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 1000 });
    loop.update('x');
    await h.tick();
    await h.advance(1000);
    loop.update('x');        // 동일 → no-op
    await h.advance(1000);
    expect(h.edits).toEqual(['x']);  // 1회만
  });

  test('minInitialChars — 첫 전송을 최소 길이까지 지연', async () => {
    const h = harness();
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 1000, minInitialChars: 5 });
    loop.update('ab');       // 5자 미달 → 미전송
    await h.advance(2000);
    expect(h.edits).toEqual([]);
    loop.update('abcdef');   // 5자 이상 → 전송
    await h.tick();
    expect(h.edits).toEqual(['abcdef']);
  });

  test('flush — pending 즉시 전송(throttle/minInitial 우회)', async () => {
    const h = harness();
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 1000, minInitialChars: 100 });
    loop.update('short');    // minInitial 미달 → 대기
    await h.tick();
    expect(h.edits).toEqual([]);
    await loop.flush();      // 강제
    expect(h.edits).toEqual(['short']);
  });

  test('retry_after suspend — rate-limit 시 그만큼 park 후 재시도', async () => {
    const h = harness();
    let calls = 0;
    h.setEdit(async (text) => {
      calls++;
      if (calls === 1) { const e: any = new Error('429'); e.retry_after = 3; throw e; }
      h.edits.push(text);
    });
    const loop = createDraftStreamLoop(
      { ...h.deps, retryAfterMs: (err: any) => (err?.retry_after != null ? err.retry_after * 1000 : null) },
      { throttleMs: 1000 },
    );
    loop.update('hi');
    await h.tick();          // 1번째 편집 → 429 → suspend 3000ms
    expect(h.edits).toEqual([]);
    await h.advance(1000);   // suspend 미경과
    expect(h.edits).toEqual([]);
    await h.advance(2500);   // suspend(3000) 경과
    expect(h.edits).toEqual(['hi']);  // 재시도 성공
  });

  test('maxConsecutiveFailures — 비-ratelimit 연속 실패 N 후 stop', async () => {
    const h = harness();
    h.setEdit(async () => { throw new Error('boom'); });
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 0, maxConsecutiveFailures: 2 });
    loop.update('a');
    await h.tick();
    loop.update('b');
    await h.advance(0);
    loop.update('c');
    await h.advance(0);
    expect(loop.isStopped()).toBe(true);       // 2회 실패 → stop
  });

  test('stop — 이후 update 무시', async () => {
    const h = harness();
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 0 });
    loop.stop();
    loop.update('a');
    await h.tick();
    expect(h.edits).toEqual([]);
    expect(loop.isStopped()).toBe(true);
  });

  test('bump — 세대 증가·새 스트림 첫 편집 즉시', async () => {
    const h = harness();
    const loop = createDraftStreamLoop(h.deps, { throttleMs: 1000 });
    loop.update('turn1');
    await h.tick();
    expect(loop.generation()).toBe(0);
    loop.bump();             // 턴 경계
    expect(loop.generation()).toBe(1);
    loop.update('turn2');    // 새 스트림 → 즉시(lastSentAt 리셋)
    await h.tick();
    expect(h.edits).toEqual(['turn1', 'turn2']);
  });
});

// 🩸 2026-09-25 — flush 가 진행 중인 편집을 «마이크로태스크 스핀»으로 기다려, 편집(HTTP·매크로태스크)이 영영 끝나지 못하고
//    프로세스가 CPU 100% 로 멈췄다(운영 넥서스 health 무응답). 편집이 타이머로 끝나는 상황에서 flush 가 반드시 끝나야 한다.
test('flush while an edit is in flight waits for the edit via the event loop (no microtask spin)', async () => {
  const sent: string[] = [];
  const loop = createDraftStreamLoop({
    edit: (text: string) => new Promise<void>((resolve) => setTimeout(() => { sent.push(text); resolve(); }, 30)),
  } as never, { throttleMs: 0, minInitialChars: 0 } as never);
  loop.update('확');
  await Promise.resolve();          // 첫 편집이 in-flight 가 되게
  loop.update('확인 — footer');      // 짧은 답: final 이 첫 조각 전송 중에 온다
  const done = await Promise.race([loop.flush().then(() => 'flushed'), new Promise((r) => setTimeout(() => r('timeout'), 2000))]);
  expect(done).toBe('flushed');
  expect(sent.at(-1)).toBe('확인 — footer');
});
