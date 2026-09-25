import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { debug } from '../debug/log.js';
import { ToolCallTiming } from './tool-call-timing.js';

let originalFileEnabled: boolean;
let originalVerboseEnabled: boolean;

beforeEach(() => {
  const status = debug.status();
  originalFileEnabled = status.file;
  originalVerboseEnabled = status.verbose;
  debug.setFileEnabled(false);
  debug.setVerboseEnabled(true);
  debug.enable();
  debug.clear();
});

afterEach(() => {
  debug.clear();
  debug.setFileEnabled(originalFileEnabled);
  debug.setVerboseEnabled(originalVerboseEnabled);
});

describe('ToolCallTiming', () => {
  test('같은 식별자를 소비하면 양수 경과를 반환하고 기록은 한 번만 쓴다', () => {
    let now = 1_000;
    const timing = new ToolCallTiming({ now: () => now });

    timing.start('call-1');
    now += 250;
    expect(timing.consume('call-1')).toBe(250);
    expect(timing.consume('call-1')).toBeUndefined();
  });

  test('실제 0ms와 기록하지 않은 식별자의 부재값을 구별한다', () => {
    const timing = new ToolCallTiming({ now: () => 1_000 });

    timing.start('immediate');
    expect(timing.consume('immediate')).toBe(0);
    expect(timing.consume('never-started')).toBeUndefined();
  });

  test('같은 식별자를 다시 기록하면 새 시작 시각을 사용하고 FIFO의 최신 항목이 된다', () => {
    let now = 0;
    const timing = new ToolCallTiming({ now: () => now, limit: 2 });

    timing.start('first');
    now += 10;
    timing.start('second');
    now += 10;
    timing.start('first');
    timing.start('third');

    expect(timing.consume('second')).toBeUndefined();
    expect(timing.consume('first')).toBe(0);
  });

  test('상한 초과 시 가장 오래된 기록을 FIFO로 버리고 evicted 관측을 남긴다', () => {
    let now = 0;
    const timing = new ToolCallTiming({ now: () => now, limit: 2 });

    timing.start('oldest');
    now += 1;
    timing.start('middle');
    now += 1;
    timing.start('newest');

    expect(timing.size()).toBe(2);
    expect(timing.consume('oldest')).toBeUndefined();
    expect(timing.consume('middle')).toBe(1);
    const evicted = debug.events().find(event => event.category === 'chat.tool-timing' && event.event === 'evicted');
    expect(evicted).toMatchObject({
      category: 'chat.tool-timing',
      event: 'evicted',
      data: { evicted: 1, size: 2 },
    });
  });
});
