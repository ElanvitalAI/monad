// task#22 part2-B · execute 진행 judge — 마일스톤(debounce)/stall/카운트 (2026-07-21).
import { describe, it, expect } from 'bun:test';
import { buildExecuteProgressJudge } from '../src/harness/execute-progress-judge.js';

/** 제어 가능한 시계. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('buildExecuteProgressJudge — 마일스톤(debounce)', () => {
  it('첫 델타는 즉시 마일스톤(툴콜/파일/마지막액션)', () => {
    const c = clock();
    const msgs: string[] = [];
    const judge = buildExecuteProgressJudge((m) => msgs.push(m), { now: c.now, debounceMs: 12_000 });
    judge('⏺ Read(a.ts)\n⏺ Edit(src/x.ts)\n작업 중');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('툴콜 2');
    expect(msgs[0]).toContain('1파일');
    expect(msgs[0]).toContain('작업 중');
  });

  it('debounce — 간격 내 델타는 억제, 지나면 emit', () => {
    const c = clock();
    const msgs: string[] = [];
    const judge = buildExecuteProgressJudge((m) => msgs.push(m), { now: c.now, debounceMs: 12_000 });
    judge('⏺ Read(a)\n');       // t=0 → emit(1)
    c.advance(3_000); judge('⏺ Grep(b)\n');  // t=3s → 억제
    expect(msgs).toHaveLength(1);
    c.advance(10_000); judge('⏺ Edit(c.ts)\n'); // t=13s ≥12s → emit(2)
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toContain('툴콜 3'); // 누적
  });

  it('빈 델타는 마일스톤 안 냄', () => {
    const c = clock();
    const msgs: string[] = [];
    const judge = buildExecuteProgressJudge((m) => msgs.push(m), { now: c.now });
    judge(''); judge('   ');
    expect(msgs).toHaveLength(0);
  });
});

describe('buildExecuteProgressJudge — stall(무활동)', () => {
  it('stallMs 무활동 → stall 카드', () => {
    const c = clock();
    const msgs: string[] = [];
    const judge = buildExecuteProgressJudge((m) => msgs.push(m), { now: c.now, debounceMs: 12_000, stallMs: 45_000 });
    judge('⏺ Read(a)\n마지막 라인');   // t=0 → emit(1)·activity
    c.advance(20_000); judge('');       // t=20s → stall 아님(45s 미만)
    expect(msgs).toHaveLength(1);
    c.advance(30_000); judge('');       // t=50s → 무활동 50s ≥45s → stall
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toContain('⏳');
    expect(msgs[1]).toContain('마지막');
  });

  it('활동 재개하면 stall 타이머 리셋', () => {
    const c = clock();
    const msgs: string[] = [];
    const judge = buildExecuteProgressJudge((m) => msgs.push(m), { now: c.now, debounceMs: 1, stallMs: 45_000 });
    judge('⏺ A(x)\n'); // emit(1)
    c.advance(40_000); judge('⏺ B(y)\n'); // 활동 재개 → emit(2)·lastActivity 리셋
    c.advance(40_000); judge('');   // 무활동 40s <45s → stall 아님
    expect(msgs).toHaveLength(2);
  });
});
