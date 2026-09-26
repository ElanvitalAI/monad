// PLAN §7 P2 — registry write 경로의 arbiter 집행 통합 테스트. mock adapter(setPtyAdapterForTesting)로
// 실 PTY 없이 write 게이팅·canWrite·requestPtyTakeover 검증. 격리 tmp ELANOUS_STATE_DIR(manifest 무접촉).
import { test, expect, describe, afterEach, spyOn } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ELANOUS_STATE_DIR = mkdtempSync(join(tmpdir(), 'registry-arbiter-'));

const { startPty, setPtyAdapterForTesting, requestPtyTakeover, unregisterPty } = await import('./registry.js');
const { debug } = await import('../debug/log.js');

function mockAdapter(writes: string[]) {
  return {
    pid: 4242,
    write: (s: string) => { writes.push(s); },
    kill: () => {},
    resize: () => {},
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
  };
}

describe('registry P2 arbiter 집행', () => {
  afterEach(() => setPtyAdapterForTesting(null));

  test('auto 모드: agent write ✓ · human write no-op(denied)', () => {
    const writes: string[] = [];
    const log = spyOn(debug, 'log');
    setPtyAdapterForTesting(() => mockAdapter(writes));
    const h = startPty({ cmd: 'x', accessMode: 'auto', transitionPolicy: 'open', detach: true });
    h.write('hi', 'agent');
    expect(writes).toEqual(['hi']);
    const controlWrites = log.mock.calls.filter(([category, event]) => category === 'pty.control' && event === 'write');
    expect(controlWrites).toEqual([['pty.control', 'write', { ptyId: h.id, actor: 'agent', mode: 'auto', bytes: 2 }]]);
    expect(JSON.stringify(controlWrites)).not.toContain('hi');
    h.write('x', 'human');       // auto+human → 거부
    expect(writes).toEqual(['hi']); // no-op(변화 없음)
    expect(log.mock.calls.filter(([category, event]) => category === 'pty.control' && event === 'write')).toHaveLength(1);
    expect(log.mock.calls.filter(([category, event]) => category === 'pty.arbiter' && event === 'write-denied')).toHaveLength(1);
    expect(h.canWrite('agent')).toBe(true);
    expect(h.canWrite('human')).toBe(false);
    log.mockRestore();
    unregisterPty(h.id);
  });

  test('read 모드: 둘 다 no-op(관찰 전용)', () => {
    const writes: string[] = [];
    setPtyAdapterForTesting(() => mockAdapter(writes));
    const h = startPty({ cmd: 'x', accessMode: 'read', detach: true });
    h.write('a', 'agent');
    h.write('h', 'human');
    expect(writes).toEqual([]);
    unregisterPty(h.id);
  });

  test('기본(write+human) 비파괴 — actor 생략 시 그대로 허용', () => {
    const writes: string[] = [];
    const log = spyOn(debug, 'log');
    setPtyAdapterForTesting(() => mockAdapter(writes));
    const h = startPty({ cmd: 'x', detach: true }); // 기본 accessMode='write'
    h.write('abc');                                  // 기본 actor='human'
    expect(writes).toEqual(['abc']);
    expect(log.mock.calls.filter(([category, event]) => category === 'pty.control' && event === 'write'))
      .toEqual([['pty.control', 'write', { ptyId: h.id, actor: 'human', mode: 'write', bytes: 3 }]]);
    log.mockRestore();
    unregisterPty(h.id);
  });

  test('requestPtyTakeover: human on auto+open → write 승격 후 human write 허용', () => {
    const writes: string[] = [];
    setPtyAdapterForTesting(() => mockAdapter(writes));
    const h = startPty({ cmd: 'x', accessMode: 'auto', transitionPolicy: 'open', detach: true });
    expect(h.canWrite('human')).toBe(false);
    expect(requestPtyTakeover(h.id, 'human')).toBe(true);
    expect(h.accessMode).toBe('write');
    h.write('now', 'human');
    expect(writes).toEqual(['now']);
    unregisterPty(h.id);
  });

  test('takeover 조율: 사람 takeover 후 agent 는 canWrite=false 로 감지(셀프힐 신호)', () => {
    const writes: string[] = [];
    setPtyAdapterForTesting(() => mockAdapter(writes));
    const h = startPty({ cmd: 'x', accessMode: 'auto', transitionPolicy: 'open', detach: true });
    expect(h.canWrite('agent')).toBe(true);         // 자율 구동 중
    h.write('a', 'agent'); expect(writes).toEqual(['a']);
    requestPtyTakeover(h.id, 'human');              // 사람이 제어 가져감(auto→write)
    expect(h.canWrite('agent')).toBe(false);        // agent 가 이양 감지 → 드라이버 셀프힐(중단)
    h.write('b', 'agent'); expect(writes).toEqual(['a']); // 이후 agent write 는 거부(조용히 유실 아님·드라이버가 선제 중단)
    unregisterPty(h.id);
  });

  test('requestPtyTakeover: auto+locked → 거부(보호된 자율·무간섭)', () => {
    setPtyAdapterForTesting(() => mockAdapter([]));
    const h = startPty({ cmd: 'x', accessMode: 'auto', transitionPolicy: 'locked', detach: true });
    expect(requestPtyTakeover(h.id, 'human')).toBe(false);
    expect(h.accessMode).toBe('auto'); // 불변
    unregisterPty(h.id);
  });
});
