// Capture substrate · SelfReportFrame contract (PLAN P0).
// Pure serialize/parse round-trip + ChannelBus pub/sub (per-surface +
// aggregate fleet channel) + fail-soft on malformed messages.

import { describe, expect, test } from 'bun:test';

import { ChannelBus } from '../src/terminal-matrix/channel-bus.js';
import {
  type SelfReportFrame,
  SELF_REPORT_AGGREGATE_CHANNEL,
  channelForSurface,
  validateSelfReportFrame,
  frameToChannelMessage,
  channelMessageToFrame,
  publishSelfReportFrame,
  subscribeSurfaceFrames,
  subscribeAllFrames,
  snapshotSurfaceFrames,
} from '../src/capture/self-report-frame.js';

function mkFrame(over: Partial<SelfReportFrame> = {}): SelfReportFrame {
  return {
    surfaceId: 'tui:1234',
    instance: 'prod',
    kind: 'tui',
    mode: 'self-report',
    text: '❯ /command\n status bar',
    cols: 80,
    rows: 24,
    cursor: { row: 3, col: 5 },
    at: 1_700_000_000_000,
    ...over,
  };
}

describe('SelfReportFrame · channel naming', () => {
  test('per-surface channel has :<id> suffix; aggregate is outside that namespace', () => {
    expect(channelForSurface('tui:1234')).toBe('tui-observe:tui:1234');
    expect(SELF_REPORT_AGGREGATE_CHANNEL).toBe('tui-observe-fleet');
    // No surfaceId — not even 'fleet' — can collide with the aggregate.
    expect(channelForSurface('fleet')).not.toBe(SELF_REPORT_AGGREGATE_CHANNEL);
    expect(channelForSurface('x')).not.toBe(SELF_REPORT_AGGREGATE_CHANNEL);
  });
});

describe('SelfReportFrame · validate', () => {
  test('a well-formed frame validates (null = ok)', () => {
    expect(validateSelfReportFrame(mkFrame())).toBeNull();
  });
  test('rejects bad kind / mode / missing fields', () => {
    expect(validateSelfReportFrame(mkFrame({ kind: 'bogus' as never }))).toBe('kind');
    expect(validateSelfReportFrame(mkFrame({ mode: 'nope' as never }))).toBe('mode');
    expect(validateSelfReportFrame({ ...mkFrame(), surfaceId: '' })).toBe('surfaceId');
    expect(validateSelfReportFrame({ ...mkFrame(), instance: '' })).toBe('instance');
    expect(validateSelfReportFrame(null)).toBe('not an object');
  });
  test('cursor optional but must be well-formed when present', () => {
    expect(validateSelfReportFrame(mkFrame({ cursor: undefined }))).toBeNull();
    expect(validateSelfReportFrame({ ...mkFrame(), cursor: { row: 1 } })).toBe('cursor');
  });
});

describe('SelfReportFrame · serialize round-trip', () => {
  test('frame → message → frame preserves all fields', () => {
    const f = mkFrame({ pngRef: '/tmp/x.png' });
    const msg = { channel: channelForSurface(f.surfaceId), at: f.at, ...frameToChannelMessage(f) };
    const back = channelMessageToFrame(msg as never);
    expect(back).toEqual(f);
  });
  test('round-trip strictly equal when optionals (cursor/pngRef) absent', () => {
    const f = mkFrame({ cursor: undefined });
    const msg = { channel: channelForSurface(f.surfaceId), at: f.at, ...frameToChannelMessage(f) };
    const back = channelMessageToFrame(msg as never);
    expect(back).toEqual(f);
    // No explicit `undefined` keys leaked in.
    expect(Object.prototype.hasOwnProperty.call(back, 'cursor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(back, 'pngRef')).toBe(false);
  });
  test('screen text, including ANSI colours, rides as raw payload', () => {
    const f = mkFrame({ text: '\x1b[32mgreen\x1b[0m' });
    expect(frameToChannelMessage(f).payload).toBe(f.text);
    expect(channelMessageToFrame({
      channel: channelForSurface(f.surfaceId),
      at: f.at,
      ...frameToChannelMessage(f),
    } as never)?.text).toBe(f.text);
  });
  test('non-self-report message → null (fail-soft)', () => {
    expect(channelMessageToFrame({ channel: 'k8s:logs', from: 'x', at: 1, payload: 'hi' } as never)).toBeNull();
  });
});

describe('SelfReportFrame · ChannelBus pub/sub', () => {
  test('publish reaches per-surface subscriber', () => {
    const bus = new ChannelBus();
    const got: SelfReportFrame[] = [];
    subscribeSurfaceFrames(bus, 'tui:1', (fr) => got.push(fr));
    publishSelfReportFrame(bus, mkFrame({ surfaceId: 'tui:1' }));
    expect(got).toHaveLength(1);
    expect(got[0]!.surfaceId).toBe('tui:1');
  });

  test('publish ALSO reaches the aggregate fleet channel', () => {
    const bus = new ChannelBus();
    const fleet: SelfReportFrame[] = [];
    subscribeAllFrames(bus, (fr) => fleet.push(fr));
    publishSelfReportFrame(bus, mkFrame({ surfaceId: 'tui:a', instance: 'prod' }));
    publishSelfReportFrame(bus, mkFrame({ surfaceId: 'tui:b', instance: 'test:axon' }));
    expect(fleet.map((f) => f.surfaceId)).toEqual(['tui:a', 'tui:b']);
    expect(fleet.map((f) => f.instance)).toEqual(['prod', 'test:axon']);
  });

  test('per-surface subscriber does NOT see other surfaces', () => {
    const bus = new ChannelBus();
    const a: SelfReportFrame[] = [];
    subscribeSurfaceFrames(bus, 'tui:a', (fr) => a.push(fr));
    publishSelfReportFrame(bus, mkFrame({ surfaceId: 'tui:b' }));
    expect(a).toHaveLength(0);
  });

  test('snapshot replays recent frames without subscribing', () => {
    const bus = new ChannelBus();
    publishSelfReportFrame(bus, mkFrame({ surfaceId: 'tui:s', text: 'frame-1' }));
    publishSelfReportFrame(bus, mkFrame({ surfaceId: 'tui:s', text: 'frame-2' }));
    const snap = snapshotSurfaceFrames(bus, 'tui:s');
    expect(snap.map((f) => f.text)).toEqual(['frame-1', 'frame-2']);
  });

  test('late joiner with {replay:true} gets backlog', () => {
    const bus = new ChannelBus();
    publishSelfReportFrame(bus, mkFrame({ surfaceId: 'tui:r', text: 'past' }));
    const got: string[] = [];
    subscribeSurfaceFrames(bus, 'tui:r', (fr) => got.push(fr.text), { replay: true });
    expect(got).toEqual(['past']);
  });

  test('publish is fail-soft — a throwing bus never propagates', () => {
    const brokenBus = { publish() { throw new Error('boom'); } } as unknown as ChannelBus;
    expect(() => publishSelfReportFrame(brokenBus, mkFrame())).not.toThrow();
  });
});

describe('SelfReportFrame · runId join anchor (K4)', () => {
  test('runId 있으면 round-trip 보존(프레임→run join)', () => {
    const f = mkFrame({ runId: 'run-k4-anchor' });
    const back = channelMessageToFrame(frameToChannelMessage(f) as never);
    expect(back?.runId).toBe('run-k4-anchor');
    expect(back).toEqual(f);   // 완전 round-trip 정합
  });

  test('runId 부재 시 ABSENT 유지(explicit undefined 키 없음·round-trip 정합)', () => {
    const f = mkFrame();   // runId 없음
    const msg = frameToChannelMessage(f);
    expect('runId' in (msg.meta as Record<string, unknown>)).toBe(false);   // meta 에 키 자체 없음
    const back = channelMessageToFrame(msg as never);
    expect('runId' in (back as object)).toBe(false);
    expect(back).toEqual(f);
  });

  test('validate — runId 타입 오류·빈 문자열 거부(MF1·round-trip 정합)', () => {
    expect(validateSelfReportFrame(mkFrame({ runId: 'ok' }))).toBeNull();
    expect(validateSelfReportFrame({ ...mkFrame(), runId: 123 })).toBe('runId');
    // 빈 runId 는 무효 — absent 여야(serialization truthy-check 가 삭제하므로 계약 일치)
    expect(validateSelfReportFrame({ ...mkFrame(), runId: '' })).toBe('runId');
  });

  test('실 ChannelBus pub/sub 경로에서도 runId 보존(구독자가 join anchor 수신)', () => {
    const bus = new ChannelBus();
    const got: SelfReportFrame[] = [];
    subscribeSurfaceFrames(bus, 'tui:1234', (f) => got.push(f));
    publishSelfReportFrame(bus, mkFrame({ runId: 'run-bus-1' }));
    expect(got).toHaveLength(1);
    expect(got[0]!.runId).toBe('run-bus-1');   // 버스 왕복 후에도 runId 도달(프레임→run join 라이브)
  });
});
