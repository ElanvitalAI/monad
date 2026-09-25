// 입력 이력 시뮬레이터 계약 — 실제 저장소를 임시 경로에 열고 정리한다.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  inputHistorySimTempDirExists,
  isInputHistorySimPathInsideTemp,
  simInputHistory,
  type InputHistorySim,
} from './input-history.js';

const sims: InputHistorySim[] = [];

function trackedSim(lines: readonly string[] = []): InputHistorySim {
  const sim = simInputHistory(lines);
  sims.push(sim);
  return sim;
}

afterEach(() => {
  for (const sim of sims.splice(0)) sim.cleanup();
});

describe('simInputHistory — 입력 이력 저장소를 임시 경로에 즉시 세운다', () => {
  test('심으로 세운 이력에서 넣은 줄들이 넣은 순서대로 읽힌다', () => {
    const sim = trackedSim(['first line', '/slash command', 'third line']);

    expect(sim.lines()).toEqual(['first line', '/slash command', 'third line']);
    expect(sim.list()).toHaveLength(3);
  });

  test('기본 조회가 100개를 넘는 현재 이력의 내용과 개수를 누락하지 않는다', () => {
    const lines = Array.from({ length: 101 }, (_, index) => `history-${String(index + 1).padStart(3, '0')}`);
    const sim = trackedSim(lines);

    expect(sim.lines()).toEqual(lines);
    expect(sim.list()).toHaveLength(101);
    expect(sim.lines().at(-1)).toBe('history-101');
  });

  test('심이 연 실제 저장소 경로는 임시 디렉토리 안이고 사람 이력 경로가 아니다', () => {
    const sim = trackedSim(['isolated']);

    expect(isInputHistorySimPathInsideTemp(sim)).toBe(true);
    expect(resolve(sim.tempDir).startsWith(resolve(tmpdir()))).toBe(true);
    expect(sim.path).toBe(`${sim.tempDir}/input-history.sqlite`);
    expect(existsSync(sim.path)).toBe(true);
    expect(sim.kind).toBe('sqlite');
  });

  test('심을 정리하면 그 임시 경로가 남지 않는다', () => {
    const sim = trackedSim(['cleanup target']);
    const tempDir = sim.tempDir;

    expect(inputHistorySimTempDirExists(sim)).toBe(true);
    sim.cleanup();

    expect(existsSync(tempDir)).toBe(false);
  });

  test('여러 심을 동시에 만들어도 한쪽 정리가 다른 심의 기록과 조회를 무효화하지 않는다', () => {
    const first = trackedSim(['first-a']);
    const second = trackedSim(['second-a']);

    first.record('first-b');
    second.record('second-b');
    first.cleanup();

    expect(existsSync(first.tempDir)).toBe(false);
    expect(existsSync(second.tempDir)).toBe(true);
    expect(second.lines()).toEqual(['second-a', 'second-b']);

    second.record('second-c');
    expect(second.lines()).toEqual(['second-a', 'second-b', 'second-c']);
  });

  test('초기 줄 기록 중 실패하면 반환 전 열린 저장소와 임시 디렉토리를 정리한다', () => {
    const before = new Set(readdirSync(tmpdir()).filter(name => name.startsWith('ux-sim-input-history-')));

    expect(() => simInputHistory(['kept before failure', '   '])).toThrow('input history simulator received an empty history line');

    const leaked = readdirSync(tmpdir())
      .filter(name => name.startsWith('ux-sim-input-history-'))
      .filter(name => !before.has(name))
      .filter(name => existsSync(resolve(tmpdir(), name)));

    for (const name of leaked) rmSync(resolve(tmpdir(), name), { recursive: true, force: true });
    expect(leaked).toEqual([]);
  });

  test('큐에 넣은 두 줄은 큐 기록 경로 모양으로 한 번씩 넣은 순서대로 남고 임시 경로에 격리된다', () => {
    const sim = trackedSim();

    const first = sim.recordQueued('queued one', {
      cwd: '/tmp/ux-sim-cwd',
      activeView: 'chat',
      focusedPane: 'input',
      metadata: { provider: 'test-provider' },
    });
    const second = sim.recordQueued('queued two', {
      cwd: '/tmp/ux-sim-cwd',
      activeView: 'chat',
      focusedPane: 'input',
      metadata: { provider: 'test-provider' },
    });

    expect(sim.lines()).toEqual(['queued one', 'queued two']);
    expect(sim.lines().filter(line => line === 'queued one')).toHaveLength(1);
    expect(sim.lines().filter(line => line === 'queued two')).toHaveLength(1);
    expect(sim.list()).toEqual([
      expect.objectContaining({
        id: first.id,
        text: 'queued one',
        cwd: '/tmp/ux-sim-cwd',
        activeView: 'chat',
        focusedPane: 'input',
        metadata: { queued: true, provider: 'test-provider' },
      }),
      expect.objectContaining({
        id: second.id,
        text: 'queued two',
        cwd: '/tmp/ux-sim-cwd',
        activeView: 'chat',
        focusedPane: 'input',
        metadata: { queued: true, provider: 'test-provider' },
      }),
    ]);
    expect(isInputHistorySimPathInsideTemp(sim)).toBe(true);
    expect(resolve(sim.path).startsWith(resolve(tmpdir()))).toBe(true);
    expect(sim.path).toBe(`${sim.tempDir}/input-history.sqlite`);
  });

  test('큐 기록은 호출자 metadata가 queued를 거짓으로 줘도 큐 항목 불변식을 강제한다', () => {
    const sim = trackedSim();

    const entry = sim.recordQueued('queued invariant', {
      metadata: { queued: false, source: 'caller' },
    });

    expect(entry.metadata).toEqual({ queued: true, source: 'caller' });
    expect(sim.list()).toEqual([
      expect.objectContaining({
        text: 'queued invariant',
        metadata: { queued: true, source: 'caller' },
      }),
    ]);
  });

  test('판정 신호: 세 줄의 개수·순서·임시 경로를 한 번에 관측한다', () => {
    const sim = trackedSim(['one', 'two', 'three']);

    expect({
      count: sim.list().length,
      lines: sim.lines(),
      insideTemp: isInputHistorySimPathInsideTemp(sim),
      pathDir: dirname(sim.path),
      tempDir: sim.tempDir,
    }).toEqual({
      count: 3,
      lines: ['one', 'two', 'three'],
      insideTemp: true,
      pathDir: sim.tempDir,
      tempDir: sim.tempDir,
    });
  });
});
