// 🚨 `OBS-T103` — 자식 PTY 가 «어디서» 떴는지가 관측에 남지 않아
//   「세션 트리와 다른 자리에서 뜬 런이 있나」를 ***원리상 셀 수 없었다***
//   (pty.spawn 100건 전수에 cwd 칸 «0개» · 2026-08-19 실측).
import { describe, expect, test } from 'bun:test';
import { spawnWorkdirObservation, startPty } from './registry.js';
import { debug } from '../debug/log.js';
import { tmpdir } from 'node:os';

describe('PTY spawn 작업 디렉토리 관측 (OBS-T103)', () => {
  test('호출자가 준 값은 caller 로 표시된다', () => {
    expect(spawnWorkdirObservation({ workdir: '/wt/x' }))
      .toEqual({ workdir: '/wt/x', workdirSource: 'caller' });
  });

  // ⛔ 이 회귀가 핵심이다: workdir «만» 남기면 두 경우가 «같은 문자열»일 수 있어
  //   fallback 여부를 못 가른다. 그래서 출처를 «따로» 낸다.
  test('안 주면 session-default 로 표시하고 값은 null 이다 — 세션 cwd 로 «채워 넣지» 않는다', () => {
    expect(spawnWorkdirObservation({}))
      .toEqual({ workdir: null, workdirSource: 'session-default' });
  });

  test('출처가 «두 값»으로 갈린다 — 이 갈림이 없으면 이 축을 못 센다', () => {
    const given = spawnWorkdirObservation({ workdir: '/same' });
    const absent = spawnWorkdirObservation({});
    expect(given.workdirSource).not.toBe(absent.workdirSource);
  });
});


describe('pty.spawn «배선» — 실제 payload 에 실려 나간다 (MEAS-T83)', () => {
  // ⛔ 순수 함수 테스트만으론 «배선»을 못 문다 — spread 를 지워도 위 테스트는 초록이다.
  //   그래서 실제 관측 payload 를 «가로채» 확인한다(무인 리뷰 should-fix · 2026-08-19).
  const capture = (workdir?: string) => {
    const seen: Record<string, unknown>[] = [];
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((_category: string, event: string, data: Record<string, unknown>) => {
      if (event === 'resolved-argv') seen.push(data);
    }) as typeof debug.log;
    try {
      const handle = startPty({ cmd: 'true', ...(workdir ? { workdir } : {}) } as Parameters<typeof startPty>[0]);
      try { handle.kill?.(); } catch { /* 종료 실패는 이 회귀의 관심사가 아니다 */ }
    } catch { /* spawn 실패해도 관측은 그 «전»에 난다 — 이 회귀가 무는 것은 payload 다 */ }
    finally { (debug as { log: typeof debug.log }).log = original; }
    return seen[0];
  };

  test('호출자가 준 workdir 가 payload 에 실린다 ⊕ 기존 필드가 그대로다', () => {
    const payload = capture(tmpdir());
    expect(payload).toBeDefined();
    expect(payload).toMatchObject({ workdir: tmpdir(), workdirSource: 'caller' });
    // ⛔ 기존 필드 비변경 — 이 회귀가 없으면 payload 를 바꾸다 소비자를 조용히 깬다
    expect(payload).toMatchObject({ requestedCmd: 'true', viaShell: false });
  });

  test('안 주면 payload 가 session-default 로 말한다 — 값을 «채워 넣지» 않는다', () => {
    const payload = capture();
    expect(payload).toMatchObject({ workdir: null, workdirSource: 'session-default' });
  });
});
