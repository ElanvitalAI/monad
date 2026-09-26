import { describe, expect, test } from 'bun:test';

import type { DaemonTerminalSummary } from '@/lib/daemon-client';
import { ptyTerminalElapsedTime, ptyTerminalRowSummary } from './pty-terminal-row-summary';

const row = (
  id: string,
  overrides: Partial<DaemonTerminalSummary> = {},
): DaemonTerminalSummary => ({
  id,
  alive: true,
  correlationId: `correlation-${id}`,
  instance: 'test',
  sessionId: `session-${id}`,
  startedAt: Number.NaN,
  accessMode: null,
  ...overrides,
});

describe('ptyTerminalRowSummary', () => {
  test('falls back to an id-only summary without an empty status label', () => {
    const summary = ptyTerminalRowSummary(row('pty-id-only'));

    expect(summary.title).toBe('pty-id-only');
    // ⛔ 2026-08-14 기대값 변경(조용히 안 바꾼다) — 종전엔 `['pty-id-only']` 를 기대했다.
    //   이 검사의 «목적»은 빈 `상태:` 라벨이 안 생기는 것이고, 상세에 id 를 싣는지는 곁가지였다.
    //   브라우저 실측에서 제목이 곧 id 인 «주된 경우»에 같은 문자열이 두 번 떠서 상세에서 뺐다.
    expect(summary.details).toEqual(['생존: 실행 중', '출처: 이 행에서는 알 수 없음', '접근: 이 행에서는 알 수 없음', '소유 런: 이 행에서는 알 수 없음', '우주: test', '마지막 제어: 이 행에서는 알 수 없음']);
    expect(summary.details.join(' ')).not.toContain('상태:');
  });

  test('includes available name and status values', () => {
    const idOnly = ptyTerminalRowSummary(row('pty-id-only'));
    const summary = ptyTerminalRowSummary(row('pty-complete', {
      name: 'Build terminal',
      status: 'running',
    }));

    expect(summary.title).toBe('Build terminal');
    expect(summary.details).toEqual([
      'pty-complete',
      '상태: running',
      '생존: 실행 중',
      '출처: 이 행에서는 알 수 없음',
      '접근: 이 행에서는 알 수 없음',
      '소유 런: 이 행에서는 알 수 없음',
      '우주: test',
      '마지막 제어: 이 행에서는 알 수 없음',
    ]);
    expect(summary).not.toEqual(idOnly);
  });

  test('같은 이름의 행을 세션 소유 정보와 경과 시간으로 구별한다', () => {
    const nowMs = 172_800_000;
    const first = ptyTerminalRowSummary(row('same-name', {
      name: '같은 이름',
      sourceRoot: { name: '첫 세션', dbPath: '/sessions/first.db' },
      startedAt: nowMs - 60_000,
    }), nowMs);
    const second = ptyTerminalRowSummary(row('same-name', {
      name: '같은 이름',
      sourceRoot: { name: '둘째 세션', dbPath: '/sessions/second.db' },
      startedAt: nowMs - 3_600_000,
    }), nowMs);

    expect(first.details).toContain('세션: 첫 세션 · /sessions/first.db');
    expect(first.details).toContain('시작: 1분 전');
    expect(second.details).toContain('세션: 둘째 세션 · /sessions/second.db');
    expect(second.details).toContain('시작: 1시간 전');
    expect(first.details).not.toEqual(second.details);
  });

  test('긴 세션 경로는 앞부분을 보존해 같은 꼬리를 가진 뿌리를 구별한다', () => {
    const sharedTail = '/self-impl/apps/pwa/src/components/terminal';
    const first = ptyTerminalRowSummary(row('first-session-root', {
      sourceRoot: { name: '같은 세션', dbPath: `/axon-a477b47f${sharedTail}` },
    }));
    const second = ptyTerminalRowSummary(row('second-session-root', {
      sourceRoot: { name: '같은 세션', dbPath: `/pilot-b2431b2b${sharedTail}` },
    }));
    const firstSession = first.details.find((detail) => detail.startsWith('세션: '));
    const secondSession = second.details.find((detail) => detail.startsWith('세션: '));
    const firstPath = firstSession?.split(' · ')[1];
    const secondPath = secondSession?.split(' · ')[1];

    expect(firstPath).not.toEqual(secondPath);
    expect(firstPath?.length).toBeLessThanOrEqual(32);
    expect(secondPath?.length).toBeLessThanOrEqual(32);
  });

  test('짧은 세션 경로는 이름 뒤에 줄임표 없이 그대로 낸다', () => {
    const summary = ptyTerminalRowSummary(row('short-session-root', {
      sourceRoot: { name: '세션 이름', dbPath: '/source/monad-agent' },
    }));

    expect(summary.details).toContain('세션: 세션 이름 · /source/monad-agent');
  });

  test('경로 없는 세션 이름은 기존처럼 세션 줄에 남긴다', () => {
    const summary = ptyTerminalRowSummary(row('name-only-session-root', {
      sourceRoot: { name: '세션 이름', dbPath: '' },
    }));

    expect(summary.details).toContain('세션: 세션 이름');
  });

  test('세션 또는 시작 시각이 없으면 새 상세 칸을 만들지 않는다', () => {
    const summary = ptyTerminalRowSummary(row('without-session-details', {
      sourceRoot: undefined,
      startedAt: Number.NaN,
    }), 100_000);

    expect(summary.details.join(' ')).not.toContain('세션:');
    expect(summary.details.join(' ')).not.toContain('시작:');
  });

  test('마지막 제어 시각은 시작 시각 변환을 재사용해 한 줄로 보이고 기존 시작 줄과 구별된다', () => {
    const nowMs = 172_800_000;
    const summary = ptyTerminalRowSummary(row('recently-controlled', {
      startedAt: nowMs - 3_600_000,
      lastControlAt: nowMs - 60_000,
    }), nowMs);

    expect(summary.details).toContain('시작: 1시간 전');
    expect(summary.details.filter((detail) => detail === '마지막 제어: 1분 전')).toHaveLength(1);
    expect(summary.details.indexOf('시작: 1시간 전')).toBeLessThan(summary.details.indexOf('마지막 제어: 1분 전'));
  });

  test('마지막 제어 시각이 없으면 제어된 적 없다고 단정하지 않고 알 수 없음을 보인다', () => {
    const summary = ptyTerminalRowSummary(row('control-time-unknown'));

    expect(summary.details).toContain('마지막 제어: 이 행에서는 알 수 없음');
    expect(summary.details.join(' ')).not.toContain('제어된 적이 없다');
  });
});

describe('ptyTerminalElapsedTime', () => {
  test('기존 상대시간 경계와 유효하지 않거나 미래인 시작 시각 생략을 유지한다', () => {
    const nowMs = 172_800_000;

    expect(ptyTerminalElapsedTime(nowMs - 29_000, nowMs)).toBe('방금');
    expect(ptyTerminalElapsedTime(nowMs - 30_000, nowMs)).toBe('0분 전');
    expect(ptyTerminalElapsedTime(nowMs - 3_599_000, nowMs)).toBe('59분 전');
    expect(ptyTerminalElapsedTime(nowMs - 3_600_000, nowMs)).toBe('1시간 전');
    expect(ptyTerminalElapsedTime(nowMs - 86_400_000, nowMs)).toBe('1일 전');
    expect(ptyTerminalElapsedTime(undefined, nowMs)).toBeNull();
    expect(ptyTerminalElapsedTime(Number.NaN, nowMs)).toBeNull();
    expect(ptyTerminalElapsedTime(nowMs + 1, nowMs)).toBeNull();
  });

  test('Date 범위를 벗어난 유한 시작 시각은 예외 없이 생략한다', () => {
    const nowMs = 172_800_000;
    const terminal = row('out-of-range-started-at', { startedAt: -1e16 });

    expect(ptyTerminalElapsedTime(terminal.startedAt, nowMs)).toBeNull();
    expect(() => ptyTerminalRowSummary(terminal, nowMs)).not.toThrow();
    expect(ptyTerminalRowSummary(terminal, nowMs).details).not.toContain('시작:');
  });
});

describe('ptyTerminalRowSummary — controller와 접근 모드', () => {
  test('controller가 있는 행에만 현재 통제자를 보인다', () => {
    const controlled = ptyTerminalRowSummary(row('controlled', {
      controller: 'codex-agent',
      accessMode: 'write',
    }));
    const uncontrolled = ptyTerminalRowSummary(row('uncontrolled', {
      accessMode: 'write',
    }));

    expect(controlled.details).toContain('통제: codex-agent');
    expect(uncontrolled.details.join(' ')).not.toContain('통제:');
  });

  test('알려진 read, write, auto 접근 모드와 알 수 없는 null을 구분한다', () => {
    const read = ptyTerminalRowSummary(row('read', { accessMode: 'read' }));
    const write = ptyTerminalRowSummary(row('write', { accessMode: 'write' }));
    const auto = ptyTerminalRowSummary(row('auto', { accessMode: 'auto' }));
    const unknown = ptyTerminalRowSummary(row('unknown', { accessMode: null }));

    expect(read.details).toContain('접근: 읽기');
    expect(write.details).toContain('접근: 쓰기');
    expect(auto.details).toContain('접근: 자동');
    expect(unknown.details).toContain('접근: 이 행에서는 알 수 없음');
    expect(unknown.details).not.toEqual(write.details);
    expect(unknown.details.join(' ')).not.toContain('쓰기 불가');
  });

  test('누락되거나 유효하지 않은 런타임 접근 모드는 알 수 없음으로 표시한다', () => {
    const missing = row('missing-access-mode') as unknown as Record<string, unknown>;
    delete missing.accessMode;
    const unexpected = row('unexpected-access-mode') as unknown as Record<string, unknown>;
    unexpected.accessMode = 'admin';

    for (const terminal of [missing, unexpected]) {
      const summary = ptyTerminalRowSummary(terminal as unknown as DaemonTerminalSummary);
      expect(summary.details).toContain('접근: 이 행에서는 알 수 없음');
      expect(summary.details).not.toContain('접근: 자동');
    }
  });
});

describe('ptyTerminalRowSummary — 소유 런 사용 상태', () => {
  test('네 소유 런 상태를 서로 다른 한 줄로 구별하고 접근과 우주 사이에 둔다', () => {
    const detailsByUsage = new Map([
      ['running', '소유 런: 실행 중'],
      ['terminated-live-owner', '소유 런: 종료됐지만 터미널 유지'],
      ['no-run-id', '소유 런: 소유 런 정보 없음'],
      ['unknown', '소유 런: 이 행에서는 알 수 없음'],
    ] as const);

    for (const [ownerRunUsage, detail] of detailsByUsage) {
      const details = ptyTerminalRowSummary(row(`owner-${ownerRunUsage}`, {
        accessMode: 'write',
        ownerRunUsage,
      })).details;
      expect(details.filter((value) => value === detail)).toHaveLength(1);
      expect(details.indexOf('접근: 쓰기')).toBeLessThan(details.indexOf(detail));
      expect(details.indexOf(detail)).toBeLessThan(details.indexOf('우주: test'));
    }

    expect(new Set(detailsByUsage.values()).size).toBe(4);
  });

  test('누락되거나 유효하지 않은 소유 런 사용 상태는 이 행에서는 알 수 없음으로 표시한다', () => {
    const missing = row('missing-owner-run-usage') as unknown as Record<string, unknown>;
    delete missing.ownerRunUsage;
    const unexpected = row('unexpected-owner-run-usage') as unknown as Record<string, unknown>;
    unexpected.ownerRunUsage = 'unused';

    for (const terminal of [missing, unexpected]) {
      const details = ptyTerminalRowSummary(terminal as unknown as DaemonTerminalSummary).details;
      expect(details).toContain('소유 런: 이 행에서는 알 수 없음');
      expect(details.join(' ')).not.toContain('아무도 쓰지 않');
    }
  });
});

describe('ptyTerminalRowSummary — 한 행 스캔 계약', () => {
  test('실제 데몬 목록 행에서 살아 있는 원격 화면의 종류, 트리·워크트리, 생존, 우주와 런을 정한 순서로 낸다', () => {
    const daemonListRow: DaemonTerminalSummary = {
      id: 'remote-pty',
      name: '원격 구현',
      alive: true,
      correlationId: 'correlation-remote-pty',
      instance: 'test:remote',
      sessionId: 'session-remote-pty',
      startedAt: Number.NaN,
      status: 'running',
      kind: 'self-implement',
      nickname: 'goal-e0868-branch',
      controller: 'codex',
      accessMode: 'write',
      treeName: 'axon-a477b47f',
      worktreeName: 'goal-e0868',
      workdir: '/source/monad-agent.worktrees/fallback',
      runId: 'run-e0868',
    };

    expect(ptyTerminalRowSummary(daemonListRow).details).toEqual([
      'remote-pty',
      '상태: running',
      '종류: self-implement',
      '별명: goal-e0868-branch',
      '위치: axon-a477b47f/goal-e0868',
      '생존: 실행 중',
      '출처: 이 행에서는 알 수 없음',
      '통제: codex',
      '접근: 쓰기',
      '소유 런: 이 행에서는 알 수 없음',
      '우주: test:remote',
      '런: run-e086…',
      '마지막 제어: 이 행에서는 알 수 없음',
    ]);
  });

  test('트리 이름만 있으면 구분자 없이 위치로 낸다', () => {
    const summary = ptyTerminalRowSummary(row('tree-only', { treeName: 'axon-a477b47f' }));

    expect(summary.details).toContain('위치: axon-a477b47f');
    expect(summary.details.join(' ')).not.toContain('axon-a477b47f/');
  });

  test('워크트리 이름만 있으면 구분자 없이 위치로 낸다', () => {
    const summary = ptyTerminalRowSummary(row('worktree-only', { worktreeName: 'goal-e0868' }));

    expect(summary.details).toContain('위치: goal-e0868');
    expect(summary.details.join(' ')).not.toContain('/goal-e0868');
  });

  test('서로 다른 트리 이름은 같은 워크트리 이름의 위치를 구별한다', () => {
    const first = ptyTerminalRowSummary(row('first-tree', {
      treeName: 'axon-a477b47f', worktreeName: 'self-impl',
    }));
    const second = ptyTerminalRowSummary(row('second-tree', {
      treeName: 'pilot-b2431b2b', worktreeName: 'self-impl',
    }));

    expect(first.details).toContain('위치: axon-a477b47f/self-impl');
    expect(second.details).toContain('위치: pilot-b2431b2b/self-impl');
    expect(first.details).not.toEqual(second.details);
  });

  test('트리와 워크트리가 없으면 작업 디렉터리를 위치로 대신 낸다', () => {
    const summary = ptyTerminalRowSummary(row('cwd-pty', {
      workdir: '/source/monad-agent',
    }));

    expect(summary.details).toContain('위치: /source/monad-agent');
  });

  test('부분 누락값은 라벨이나 빈 칸을 만들지 않는다', () => {
    const summary = ptyTerminalRowSummary({
      id: 'closed-pty', alive: false, correlationId: 'c', instance: '',
      sessionId: 's', startedAt: Number.NaN, accessMode: null,
    });

    expect(summary.details).toEqual(['종료: 종료 코드 미상', '출처: 이 행에서는 알 수 없음', '접근: 이 행에서는 알 수 없음', '소유 런: 이 행에서는 알 수 없음', '마지막 제어: 이 행에서는 알 수 없음']);
    expect(summary.details.join(' ')).not.toContain('종류:');
    expect(summary.details.join(' ')).not.toContain('위치:');
    expect(summary.details.join(' ')).not.toContain('우주:');
    expect(summary.details.some((value) => value.startsWith('런: '))).toBe(false);
    expect(summary.details.join(' ')).not.toContain('별명:');
  });

  test('종료 상태를 정상, 비정상, 종료 코드 미상으로 구분한다', () => {
    expect(ptyTerminalRowSummary(row('clean', { alive: false, exitCode: 0 })).details)
      .toContain('종료: 정상 종료 (exit 0)');
    expect(ptyTerminalRowSummary(row('failed', { alive: false, exitCode: 17 })).details)
      .toContain('종료: 비정상 종료 (exit 17)');
    expect(ptyTerminalRowSummary(row('unknown', { alive: false, exitCode: null })).details)
      .toContain('종료: 종료 코드 미상');
  });

  test('세션 이름과 저장소 경로, 경과 시간만 추가하고 원시 상관·세션 ID는 노출하지 않는다', () => {
    const nowMs = 86_400_000;
    const summary = ptyTerminalRowSummary(row('bounded', {
      correlationId: 'correlation-not-rendered',
      sessionId: 'session-not-rendered',
      sourceRoot: { name: 'remote-root', dbPath: '/remote/sessions.db' },
      startedAt: nowMs - 3_600_000,
    }), nowMs);

    expect(summary.details).toContain('세션: remote-root · /remote/sessions.db');
    expect(summary.details).toContain('시작: 1시간 전');
    expect(summary.details.join(' ')).not.toContain('correlation-not-rendered');
    expect(summary.details.join(' ')).not.toContain('session-not-rendered');
    expect(summary.details.join(' ')).not.toContain(String(nowMs - 3_600_000));
  });
});

// ⛔ 2026-08-14 브라우저 실측 — 실물 PTY 행은 name 이 없어 제목이 곧 id 다.
//   그때 상세에도 id 를 실어 화면에 같은 문자열이 «두 번» 떴다.
describe('ptyTerminalRowSummary — 같은 id 를 두 번 보이지 않는다', () => {
  test('제목이 id 면 상세에서 id 를 뺀다', () => {
    const summary = ptyTerminalRowSummary({
      id: 'self_471afcd4', alive: true, correlationId: 'c', instance: 'test',
      sessionId: 's', startedAt: 1, accessMode: null,
    });
    expect(summary.title).toBe('self_471afcd4');
    expect(summary.details).not.toContain('self_471afcd4');
  });

  test('이름이 있으면 상세에 id 를 그대로 남긴다', () => {
    const summary = ptyTerminalRowSummary({
      id: 'self_471afcd4', name: '골 런', alive: true, correlationId: 'c',
      instance: 'test', sessionId: 's', startedAt: 1, accessMode: null,
    });
    expect(summary.title).toBe('골 런');
    expect(summary.details).toContain('self_471afcd4');
  });
});

describe('ptyTerminalRowSummary — 장문 값 축약', () => {
  test('긴 런, 위치, 우주를 줄이되 다섯 스캔 항목을 모두 보존한다', () => {
    const longLocation = '/private/var/folders/very-long-worktree-name-for-one-line-terminal-rows';
    const longInstance = 'test:remote-instance-with-a-name-too-long-for-a-terminal-row';
    const longRunId = '12345678-1234-1234-1234-123456789abc';
    const summary = ptyTerminalRowSummary(row('compact-pty', {
      kind: 'self-implement',
      worktreeName: longLocation,
      instance: longInstance,
      runId: longRunId,
    }));

    expect(summary.details).toEqual([
      '종류: self-implement',
      '위치: …-name-for-one-line-terminal-rows',
      '생존: 실행 중',
      '출처: 이 행에서는 알 수 없음',
      '접근: 이 행에서는 알 수 없음',
      '소유 런: 이 행에서는 알 수 없음',
      '우주: …name-too-long-for-a-terminal-row',
      '런: 12345678…',
      '마지막 제어: 이 행에서는 알 수 없음',
    ]);
    expect(summary.details.join(' ')).not.toContain(longLocation);
    expect(summary.details.join(' ')).not.toContain(longInstance);
    expect(summary.details.join(' ')).not.toContain(longRunId);
  });

  test('트리를 보존하면서 긴 워크트리 이름만 줄여 위치 한도 안에서 구별한다', () => {
    const worktreeName = 'self-impl-apps-pwa-src-components-terminal-pty-terminal-row-summary';
    const first = ptyTerminalRowSummary(row('first-long-tree', {
      treeName: 'axon-a477b47f', worktreeName,
    }));
    const second = ptyTerminalRowSummary(row('second-long-tree', {
      treeName: 'pilot-b2431b2b', worktreeName,
    }));
    const firstLocation = first.details.find((detail) => detail.startsWith('위치: '));
    const secondLocation = second.details.find((detail) => detail.startsWith('위치: '));

    expect(firstLocation).toContain('axon-a477b47f');
    expect(secondLocation).toContain('pilot-b2431b2b');
    expect(firstLocation?.replace('위치: ', '').length).toBeLessThanOrEqual(32);
    expect(secondLocation?.replace('위치: ', '').length).toBeLessThanOrEqual(32);
    expect(firstLocation).not.toEqual(secondLocation);
  });

  test('긴 트리 이름만 있으면 32자 한도 안에서 꼬리를 줄여 낸다', () => {
    const treeName = 'tree-name-that-exceeds-the-location-display-limit';
    const summary = ptyTerminalRowSummary(row('long-tree-only', { treeName }));
    const location = summary.details.find((detail) => detail.startsWith('위치: '));

    expect(location).toBe('위치: …eeds-the-location-display-limit');
    expect(location?.replace('위치: ', '').length).toBeLessThanOrEqual(32);
  });

  test('트리 이름이 32자면 긴 워크트리 없이 트리를 온전히 보존한다', () => {
    const treeName = 'tree-name-that-is-exactly-32-cha';
    const summary = ptyTerminalRowSummary(row('tree-at-limit', {
      treeName,
      worktreeName: 'long-worktree-name-that-cannot-fit',
    }));

    expect(summary.details).toContain(`위치: ${treeName}`);
  });

  test('짧은 트리와 워크트리는 줄임표 없이 조립 순서대로 낸다', () => {
    const summary = ptyTerminalRowSummary(row('short-tree-worktree', {
      treeName: 'axon-a477b47f', worktreeName: 'goal-e0868',
    }));

    expect(summary.details).toContain('위치: axon-a477b47f/goal-e0868');
    expect(summary.details.join(' ')).not.toContain('…');
  });

  test('긴 작업 디렉터리만 있으면 기존 꼬리 축약을 유지한다', () => {
    const workdir = '/private/var/folders/very-long-worktree-name-for-one-line-terminal-rows';
    const summary = ptyTerminalRowSummary(row('long-workdir-only', { workdir }));

    expect(summary.details).toContain('위치: …-name-for-one-line-terminal-rows');
    expect(summary.details.join(' ')).not.toContain(workdir);
  });

  test('짧은 런 ID와 짧은 작업 디렉터리는 줄임표 없이 그대로 낸다', () => {
    const summary = ptyTerminalRowSummary(row('short-values', {
      workdir: '/source/monad-agent',
      runId: 'run-e086',
    }));

    expect(summary.details).toContain('위치: /source/monad-agent');
    expect(summary.details).toContain('런: run-e086');
    expect(summary.details.join(' ')).not.toContain('…');
  });
});

describe('ptyTerminalRowSummary — terminal origin', () => {
  test('distinguishes human, elanous, external-tool name, and unknown reason without guessing missing metadata as human', () => {
    const human = ptyTerminalRowSummary(row('human-origin', { terminalOriginCategory: 'direct-human' }));
    const elanous = ptyTerminalRowSummary(row('elanous-origin', { terminalOriginCategory: 'elanous' }));
    const external = ptyTerminalRowSummary(row('external-origin', { terminalOriginCategory: 'external-tool', externalToolName: 'codex' }));
    const unknown = ptyTerminalRowSummary(row('unknown-origin', { terminalOriginCategory: 'unknown', terminalOriginReason: 'legacy daemon' }));
    const missing = ptyTerminalRowSummary(row('missing-origin'));

    expect(human.details).toContain('출처: 사람');
    expect(elanous.details).toContain('출처: elanous');
    expect(external.details).toContain('출처: 외부 도구 · codex');
    expect(unknown.details).toContain('출처: 이 행에서는 알 수 없음 · legacy daemon');
    expect(missing.details).toContain('출처: 이 행에서는 알 수 없음');
    expect(missing.details.join(' ')).not.toContain('출처: 사람');
    expect(new Set([human.details.join(' '), elanous.details.join(' '), external.details.join(' '), unknown.details.join(' ')])).toHaveLength(4);
  });

  test('keeps controller conditional when origin metadata is present', () => {
    expect(ptyTerminalRowSummary(row('controlled-origin', { terminalOriginCategory: 'elanous', controller: 'codex-agent' })).details)
      .toContain('통제: codex-agent');
    expect(ptyTerminalRowSummary(row('uncontrolled-origin', { terminalOriginCategory: 'elanous' })).details.join(' '))
      .not.toContain('통제:');
  });
});
