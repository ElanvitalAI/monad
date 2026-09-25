// P3b-2 observe 서피스 어댑터 — public API(observeSurfaceFromBus)로 진행 다이제스트 throttle/dedup/
// fail-soft/정리 동작을 검증. 순수 헬퍼는 내부화(비공개)돼 버스 경유로만 관측한다.
import { describe, it, expect } from 'bun:test';
import { ChannelBus } from '../terminal-matrix/channel-bus.js';
import { publishSelfReportFrame, type SelfReportFrame } from './self-report-frame.js';
import { AGENT_MISSION_STATE_RULES, classifyFrameState } from './frame-state-detect.js';
import { execSurfaceId } from '../self-implement/executor-contract.js';
import { observeSurfaceFromBus, runWithControlObserve, type ControlObserveDigest } from './control-observe-adapter.js';

const frame = (surfaceId: string, text: string, at: number, runId?: string): SelfReportFrame => ({
  surfaceId, instance: 'test-inst', kind: 'headless', mode: 'forwarded', text, cols: 80, rows: 24, at,
  ...(runId ? { runId } : {}),
});

// 결정론 상태(실측): 'idle screen' → 'unknown', 'esc to interrupt' → 'working'(전이 유도용).
const UNKNOWN = 'idle screen';
const WORKING = 'esc to interrupt';

describe('observeSurfaceFromBus — 다이제스트 매핑', () => {
  it('프레임 → 다이제스트(surfaceId·summary·frameCount·runId·at·state=classifyFrameState)', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sess = observeSurfaceFromBus(bus, execSurfaceId('p1'), (d) => got.push(d));
    publishSelfReportFrame(bus, frame(execSurfaceId('p1'), '작업중\n마지막 줄', 1000, 'r1'));
    expect(got.length).toBe(1);
    const d = got[0]!;
    expect(d.surfaceId).toBe('exec:p1');
    expect(d.summary).toBe('마지막 줄');       // 마지막 의미있는 1줄
    expect(d.frameCount).toBe(1);
    expect(d.runId).toBe('r1');
    expect(d.at).toBe(1000);                     // frame 렌더 시각
    expect(d.state).toBe(classifyFrameState('작업중\n마지막 줄').state); // 하드코딩 아님·위임
    expect(d.unknownInput).toEqual(['작업중', '마지막 줄']);
    sess.stop();
  });

  it('agent-mission frame의 MISSION-COMPLETE를 done 다이제스트로 배선한다', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('mission-complete');
    const claudeFrame = [
      'MISSION-COMPLETE',
      '❯ 커밋하고 PR 올려줘',
      '────────────────────────────────────────',
      '⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker',
      '📁 docs/harness │ probe/claude-read… ~2 wt │ Opus 5 (1M) │ CTX 88%',
      '🖥 MacBookProM5 │ ↔ ssh │ ▤ tmux │ ❐ acp',
      '⏵⏵ bypass permissions on (shift+tab to cycle)',
    ].join('\n');
    observeSurfaceFromBus(bus, sid, (d) => got.push(d));
    publishSelfReportFrame(bus, frame(sid, claudeFrame, 1));
    expect(got[0]!.state).toBe('done');
    expect(got[0]!.state).toBe(classifyFrameState(claudeFrame, AGENT_MISSION_STATE_RULES).state);
  });

  it('summary — ANSI 제거·공백 압축·160자 잘림', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    observeSurfaceFromBus(bus, execSurfaceId('p1b'), (d) => got.push(d));
    publishSelfReportFrame(bus, frame(execSurfaceId('p1b'), `\x1b[32m컬러\x1b[0m   줄`, 1));
    expect(got[0]!.summary).toBe('컬러 줄');
    publishSelfReportFrame(bus, frame(execSurfaceId('p1b'), 'y'.repeat(300), 9999));
    expect(got[1]!.summary.length).toBe(160);
  });

  it('분류된 프레임 다이제스트에는 unknown 진단 입력을 싣지 않는다', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('p1-working');
    observeSurfaceFromBus(bus, sid, (d) => got.push(d));
    publishSelfReportFrame(bus, frame(sid, WORKING, 1));
    expect(got[0]!.state).toBe('working');
    expect(got[0]!.unknownInput).toBeUndefined();
  });

  it('runId 없으면 다이제스트에 runId 생략', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    observeSurfaceFromBus(bus, execSurfaceId('p1c'), (d) => got.push(d));
    publishSelfReportFrame(bus, frame(execSurfaceId('p1c'), 'x', 1));
    expect(got[0]!.runId).toBeUndefined();
  });
});

describe('observeSurfaceFromBus — throttle/dedup', () => {
  it('동일 state 연속은 최소간격 전까지 억제, 간격 경과 시 정확히 재-emit', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('p2');
    observeSurfaceFromBus(bus, sid, (d) => got.push(d), { minIntervalMs: 3000 });
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1000)); // 1) 첫 → emit
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1500)); // 억제(간격 500)
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 2000)); // 억제
    expect(got.length).toBe(1);
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 5000)); // 간격 4000 ≥ 3000 → emit
    expect(got.length).toBe(2);
    expect(got[1]!.frameCount).toBe(4);                     // 관측 누계는 억제 프레임 포함 증가
  });

  it('state 전이는 간격 미달이어도 즉시 emit(emitOnStateChange·unknown→working 실측)', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('p2b');
    observeSurfaceFromBus(bus, sid, (d) => got.push(d), { minIntervalMs: 3000 });
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1000)); // unknown → emit
    publishSelfReportFrame(bus, frame(sid, WORKING, 1100)); // 간격 100(<3000)이나 state 전이 → emit
    expect(got.map((d) => d.state)).toEqual(['unknown', 'working']);
  });

  it('emitOnStateChange=false 면 전이여도 간격만 본다', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('p2c');
    observeSurfaceFromBus(bus, sid, (d) => got.push(d), { minIntervalMs: 3000, emitOnStateChange: false });
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1000)); // emit
    publishSelfReportFrame(bus, frame(sid, WORKING, 1100)); // 전이지만 간격 미달 → 억제
    expect(got.length).toBe(1);
  });

  it('expectRunId 필터(strict) — 다른 run·runId 없는 프레임 모두 거부, 일치 프레임만 관측', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('prun');
    observeSurfaceFromBus(bus, sid, (d) => got.push(d), { minIntervalMs: 3000, expectRunId: 'run-me' });
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1000, 'run-other')); // 다른 run → 거부
    publishSelfReportFrame(bus, frame(sid, WORKING, 1100));              // runId 없음 → 거부(strict)
    expect(got.length).toBe(0);
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 2000, 'run-me'));    // 이 run → emit
    expect(got.length).toBe(1);
    expect(got[0]!.runId).toBe('run-me');
  });

  it('시각 역행 시 동일 state 를 장시간 억제하지 않고 즉시 emit(리셋·should-fix)', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('preg');
    observeSurfaceFromBus(bus, sid, (d) => got.push(d), { minIntervalMs: 3000 });
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 5000)); // emit(기준 at=5000)
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1000)); // 역행(1000<5000) → 억제 아니라 즉시 emit
    expect(got.length).toBe(2);
  });
});

describe('runWithControlObserve — 생명주기 seam (DI behavior)', () => {
  it('attach→run→cleanup: body 중 프레임은 sink 도달·onSettled 는 digestCount·종료 후 해제', async () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    let settled = -1;
    const sid = execSurfaceId('life1');
    const result = await runWithControlObserve(bus, sid, (d) => got.push(d), async () => {
      publishSelfReportFrame(bus, frame(sid, 'working…\n진행', 1000)); // body 중 발행 → sink 도달
      return 'RESULT';
    }, { onSettled: (n) => { settled = n; } });
    expect(result).toBe('RESULT');
    expect(got.length).toBe(1);
    expect(settled).toBe(1);
    // body 종료 후 구독 해제됨 → 이후 발행은 sink 에 안 옴.
    publishSelfReportFrame(bus, frame(sid, 'after', 9000));
    expect(got.length).toBe(1);
  });

  it('body 예외에도 cleanup(구독 해제) + onSettled 호출 + 예외 전파', async () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('life2');
    let settled = -1;
    await expect(runWithControlObserve(bus, sid, (d) => got.push(d), async () => {
      publishSelfReportFrame(bus, frame(sid, 'x', 1000));
      throw new Error('body boom');
    }, { onSettled: (n) => { settled = n; } })).rejects.toThrow('body boom');
    expect(settled).toBe(1); // 예외 경로에서도 onSettled 가 digestCount 로 호출(finally)
    publishSelfReportFrame(bus, frame(sid, 'y', 9000)); // 해제됨 → 무시
    expect(got.length).toBe(1);
  });

  it('attach 실패는 fail-soft — body 는 완주하고 결과 반환(관측이 관측대상 안 깸)', async () => {
    // subscribe 가 throw 하는 버스 목 → observeSurfaceFromBus 가 throw → attach catch → body 정상.
    const badBus = { subscribe: () => { throw new Error('subscribe boom'); }, publish: () => {}, snapshot: () => [] } as unknown as ChannelBus;
    const result = await runWithControlObserve(badBus, execSurfaceId('life3'), () => {}, async () => 42);
    expect(result).toBe(42);
  });
});

describe('observeSurfaceFromBus — lifecycle / fail-soft', () => {
  it('stop 후 프레임은 전달 안 됨(구독 해제·idempotent)', () => {
    const bus = new ChannelBus();
    const got: ControlObserveDigest[] = [];
    const sid = execSurfaceId('p3');
    const sess = observeSurfaceFromBus(bus, sid, (d) => got.push(d));
    publishSelfReportFrame(bus, frame(sid, 'a', 1));
    const n = got.length;
    sess.stop();
    sess.stop(); // idempotent
    publishSelfReportFrame(bus, frame(sid, 'b', 5000));
    expect(got.length).toBe(n);
  });

  it('sink 예외는 fail-soft — 구독 안 깨고 throttle 기준 미전진(다음 프레임 재시도)', () => {
    const bus = new ChannelBus();
    const sid = execSurfaceId('p4');
    let calls = 0;
    const sess = observeSurfaceFromBus(bus, sid, () => { calls += 1; if (calls === 1) throw new Error('sink boom'); }, { minIntervalMs: 3000 });
    expect(() => publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1000))).not.toThrow();
    expect(sess.digestCount).toBe(0); // 첫 프레임 sink 실패 → emitted 미증가
    // 간격 미달(1000→1200)이나 실패로 기준 미전진 → 재시도돼 성공 emit(전달실패 은폐 안 함).
    publishSelfReportFrame(bus, frame(sid, UNKNOWN, 1200));
    expect(sess.digestCount).toBe(1);
    sess.stop();
  });
});
