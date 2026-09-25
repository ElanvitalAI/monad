// #4 self-implement 격리 누출 봉쇄(2026-07-25) 회귀 가드 — 명시 경계 마커(1순위·결정론) + isWorktree
// 자동추론 폴백. 정본 루트/하위에서 부팅해도 경계는 worktree(마커)라 정본 write 거부. 비-하니스 무회귀.
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  activateHarnessWriteBoundary,
  resolveHarnessBoundary,
  classifyHarnessWrite,
  isWithinBoundary,
  harnessMainTreeReject,
  canonicalizeForBoundary,
  harnessCommandWriteReject,
  notifyHarnessCommandStart,
  commandAction,
  __resetHarnessCommandStartForTesting,
  inspectHarnessCommandWriteTargets,
  formatUnknownCommandWriteReject,
  HARNESS_BOUNDARY_REQUESTS_ENV,
  renderShellSyntaxToken,
} from './harness-write-boundary.js';
import { harnessBoundaryEnv } from './harness-space.js';
import {
  initSessionWorkingDir,
  setSessionCwd,
  getSessionBoundary,
  __resetSessionWorkingDir,
} from '../session/working-dir.js';
import { HARNESS_SPACE_ENV, HARNESS_SPACE_ID_ENV, HARNESS_BOUNDARY_ENV, HARNESS_BOUNDARY_RESPONSES_ENV } from './harness-space.js';
import { applyEdit } from '../code-edit/apply.js';
import { ReadFileStateStore } from '../code-edit/read-state.js';
import { EditErrorCode } from '../code-edit/types.js';
import { formatBoundaryProgressLine, formatFrameStallProgressLine, formatSupervisionProgressLine, runHeadlessGoalLoopPty, watchHarnessBoundaryRequests } from '../self-implement/headless-monad-driver.js';
import { decideBoundaryApproval, parseBoundaryApprovalRequest, UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS } from '../self-implement/auto-intervene.js';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, existsSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../debug/log.js';

const harnessEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  [HARNESS_SPACE_ENV]: 'self-implement',
  [HARNESS_SPACE_ID_ENV]: 'test-branch',
  ...over,
});

describe('classifyHarnessWrite / isWithinBoundary (순수 판정)', () => {
  const b = '/repo/.worktrees/feat';
  it('경계 자신·하위 = allow', () => {
    expect(classifyHarnessWrite(b, b)).toBe('allow');
    expect(classifyHarnessWrite(`${b}/src/x.ts`, b)).toBe('allow');
  });
  it('경계 밖 = reject', () => {
    expect(classifyHarnessWrite('/repo/src/x.ts', b)).toBe('reject');
    expect(classifyHarnessWrite('/tmp/x.ts', b)).toBe('reject');
  });
  it('경계 null = allow(무회귀)', () => {
    expect(classifyHarnessWrite('/anywhere/x.ts', null)).toBe('allow');
  });
  it('prefix 함정 — 경계와 이름만 겹치는 형제 거부', () => {
    expect(classifyHarnessWrite(`${b}-old/x.ts`, b)).toBe('reject');
    expect(isWithinBoundary(`${b}-old/x.ts`, b)).toBe(false);
  });
  it('파일시스템 루트 경계 엣지 — boundary="/" 는 자식 경로를 오거부 안 함(relative 기반)', () => {
    expect(isWithinBoundary('/x/y.ts', '/')).toBe(true);   // `//` prefix 버그였으면 false
    expect(isWithinBoundary('/', '/')).toBe(true);
  });
});

describe('activateHarnessWriteBoundary — 명시 마커(결정론)', () => {
  let tmp = '';
  let wt = '';
  beforeEach(() => {
    __resetSessionWorkingDir();
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-')));
    wt = join(tmp, 'wt');
    mkdirSync(wt);
  });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('비-하니스 = 무회귀(경계 미활성)', () => {
    initSessionWorkingDir(wt);
    expect(activateHarnessWriteBoundary({}, wt)).toBeNull();
    expect(getSessionBoundary()).toBeNull();
  });

  it('명시 마커 = cwd 무관하게 마커 경로를 경계로 활성', () => {
    initSessionWorkingDir(tmp); // cwd 는 마커와 다름(정본 흉내)
    const r = activateHarnessWriteBoundary(harnessEnv({ [HARNESS_BOUNDARY_ENV]: wt }), tmp);
    expect(r).toBe(wt); // 경계는 마커(wt)지 cwd(tmp)가 아니다
    expect(getSessionBoundary()).toBe(wt);
  });

  it('마커 없음 + 비-worktree cwd = 경계 미상 → 미활성(정본 축복 방지)', () => {
    initSessionWorkingDir(wt); // 비-git 임시 dir(worktree 아님)
    expect(activateHarnessWriteBoundary(harnessEnv(), wt)).toBeNull();
    expect(getSessionBoundary()).toBeNull();
  });

  it('idempotent', () => {
    initSessionWorkingDir(tmp);
    const env = harnessEnv({ [HARNESS_BOUNDARY_ENV]: wt });
    expect(activateHarnessWriteBoundary(env, tmp)).toBe(wt);
    expect(activateHarnessWriteBoundary(env, tmp)).toBe(wt);
    expect(getSessionBoundary()).toBe(wt);
  });
});

describe('harnessMainTreeReject — 명시 마커 앵커(cwd 무관)', () => {
  let tmp = '';
  let wt = '';
  let main = '';
  beforeEach(() => {
    __resetSessionWorkingDir();
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-')));
    wt = join(tmp, 'wt'); main = join(tmp, 'main');
    mkdirSync(wt); mkdirSync(main);
  });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('비-하니스 = 즉시 null(무회귀)', () => {
    expect(harnessMainTreeReject(join(main, 'x.ts'), {}, wt)).toBeNull();
  });

  it('명시 마커: 경계 밖(정본) write 거부·경계 안 허용 — cwd 가 정본이어도', () => {
    const env = harnessEnv({ [HARNESS_BOUNDARY_ENV]: wt });
    // cwd 를 정본(main)으로 줘도 경계는 마커(wt) → 정본 write 거부(리뷰 must-fix: 정본 부팅 방어).
    expect(harnessMainTreeReject(join(main, 'src', 'x.ts'), env, main)).toContain('격리 경계 밖');
    expect(harnessMainTreeReject(join(wt, 'src', 'x.ts'), env, main)).toBeNull();
  });

  it('심링크 우회 봉쇄 — 경계 내부 심링크가 밖을 가리켜도 canonical 로 펼쳐 거부', () => {
    const link = join(wt, 'escape');
    symlinkSync(main, link); // wt/escape → main(정본)
    const env = harnessEnv({ [HARNESS_BOUNDARY_ENV]: wt });
    expect(harnessMainTreeReject(join(link, 'x.ts'), env, wt)).toContain('격리 경계 밖');
  });

  it('작업 위치 자체가 경계 밖이면 수복 불가 관측·실제 부모 기록 문장을 더해도 거부한다', () => {
    const requestPath = join(tmp, 'requests.jsonl');
    const env = harnessEnv({ [HARNESS_BOUNDARY_ENV]: wt, [HARNESS_BOUNDARY_REQUESTS_ENV]: requestPath });
    const target = join(main, 'src', 'x.ts');
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      const rejection = harnessMainTreeReject(target, env, main);
      expect(rejection).toContain('격리 경계 밖');
      expect(rejection).toContain('다른 경로를 시도해도 바뀌지 않으며, 이 요청은 부모에게 기록됐다.');
      expect(JSON.parse(readFileSync(requestPath, 'utf8'))).toMatchObject({ cwd: main, boundary: wt, target, childResponsibility: 'none' });
      const record = log.mock.calls.find(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject')?.[2] as Record<string, unknown>;
      expect(record).toMatchObject({ cwd: main, boundary: wt, target, childResponsibility: 'none' });
    } finally {
      log.mockRestore();
    }
  });

  it('수복 불가 요청 기록이 실패하면 기록됐다고 안내하지 않아도 거부한다', () => {
    const env = harnessEnv({
      [HARNESS_BOUNDARY_ENV]: wt,
      [HARNESS_BOUNDARY_REQUESTS_ENV]: join(tmp, 'missing', 'requests.jsonl'),
    });
    const target = join(main, 'src', 'x.ts');
    const rejection = harnessMainTreeReject(target, env, main);
    expect(rejection).toContain('다른 경로를 시도해도 바뀌지 않으며, 이 요청은 부모에게 기록되지 않았다.');
    expect(rejection).toContain('격리 경계 밖');
  });

  it('작업 위치가 경계 안이면 수복 가능 관측과 기존 거부 문구를 그대로 유지한다', () => {
    const env = harnessEnv({ [HARNESS_BOUNDARY_ENV]: wt });
    const target = join(main, 'src', 'x.ts');
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      expect(harnessMainTreeReject(target, env, wt)).toBe(`격리 경계 밖 쓰기 거부(하니스 격리·self-implement): ${target}. 격리 worktree(${wt}) 내부 경로로 쓰라(정본 트리 오염 금지).`);
      const record = log.mock.calls.find(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject')?.[2] as Record<string, unknown>;
      expect(record).toMatchObject({ cwd: wt, boundary: wt, target, childResponsibility: 'child' });
    } finally {
      log.mockRestore();
    }
  });
});

describe('harness boundary request mailbox', () => {
  let tmp = '';
  let boundary = '';
  let outside = '';
  let requestPath = '';
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    __resetHarnessCommandStartForTesting();
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-request-')));
    boundary = join(tmp, 'boundary');
    outside = join(tmp, 'outside');
    requestPath = join(tmp, 'requests.jsonl');
    mkdirSync(boundary); mkdirSync(outside);
    env = harnessEnv({
      [HARNESS_BOUNDARY_ENV]: boundary,
      [HARNESS_BOUNDARY_REQUESTS_ENV]: requestPath,
    });
  });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('확정된 경계 밖 경로 거부를 부모 지정 JSONL에 한 줄로 append하고 거부문은 보존한다', () => {
    const target = join(outside, 'secret.ts');
    env.MONAD_RUN_ID = 'run-boundary-reject';
    const rejection = harnessMainTreeReject(target, env, boundary, 'test');
    const lines = readFileSync(requestPath, 'utf8').trim().split('\n');
    const request = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(rejection).toBe(`격리 경계 밖 쓰기 거부(하니스 격리·self-implement): ${target}. 격리 worktree(${boundary}) 내부 경로로 쓰라(정본 트리 오염 금지).`);
    expect(lines).toHaveLength(1);
    expect(request).toMatchObject({
      boundary, cwd: boundary, kind: 'self-implement', via: 'test', path: target, target, targetKnown: true,
      runId: 'run-boundary-reject', runIdState: 'present',
    });
    expect(request.requestId).toEqual(expect.any(String));
    expect(request.timestamp).toEqual(expect.any(String));
  });

  it('거절 관측은 런 없음과 획득 불가를 null이 아닌 상태로 구분한다', () => {
    const target = join(outside, 'run-identity.ts');
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      expect(harnessMainTreeReject(target, env, boundary)).toContain('격리 경계 밖');
      const noRun = log.mock.calls.find(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject')?.[2] as Record<string, unknown>;
      expect(noRun).toMatchObject({ runId: null, runIdState: 'none' });
      expect(noRun.runId).not.toBe('');
      env.MONAD_RUN_ID = '///';
      expect(harnessMainTreeReject(target, env, boundary)).toContain('격리 경계 밖');
      const unavailable = log.mock.calls.filter(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject').at(-1)?.[2] as Record<string, unknown>;
      expect(unavailable).toMatchObject({ runId: null, runIdState: 'unavailable' });
      expect(unavailable.runId).not.toBe('');
      expect(unavailable.runIdState).not.toBe(noRun.runIdState);
    } finally {
      log.mockRestore();
    }
  });

  it('파일 경로 거부는 없는 회신 우편함을 만들지 않고 0 바이트와 mailbox별 연속 요청 수를 관측하며 거부문을 보존한다', () => {
    const responsePath = join(tmp, 'responses.jsonl');
    const otherResponsePath = join(tmp, 'other-responses.jsonl');
    env[HARNESS_BOUNDARY_RESPONSES_ENV] = responsePath;
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const target = join(outside, 'response-observed.ts');
    try {
      expect(existsSync(responsePath)).toBe(false);
      expect(harnessMainTreeReject(target, env, boundary)).toBe(`격리 경계 밖 쓰기 거부(하니스 격리·self-implement): ${target}. 격리 worktree(${boundary}) 내부 경로로 쓰라(정본 트리 오염 금지).`);
      expect(harnessMainTreeReject(join(outside, 'response-observed-second.ts'), env, boundary)).toContain('격리 경계 밖');
      env[HARNESS_BOUNDARY_RESPONSES_ENV] = otherResponsePath;
      expect(harnessMainTreeReject(join(outside, 'other-mailbox.ts'), env, boundary)).toContain('격리 경계 밖');
      const records = log.mock.calls
        .filter(([category, event]) => category === 'harness.boundary' && event === 'response-mailbox-observed')
        .map(([, , data]) => data as Record<string, unknown>);
      expect(records).toHaveLength(3);
      expect(records.map((record) => record.responseBytes)).toEqual([0, 0, 0]);
      expect(records.map((record) => record.requestCount)).toEqual([1, 2, 1]);
      expect(existsSync(responsePath)).toBe(false);
      expect(existsSync(otherResponsePath)).toBe(false);
      expect(JSON.stringify(records)).not.toContain(responsePath);
      expect(JSON.stringify(records)).not.toContain(otherResponsePath);
    } finally {
      log.mockRestore();
    }
  });

  it('미결정 셸 거부는 회신 우편함 바이트와 독립 요청 수를 관측하며 기존 거부를 유지한다', () => {
    const firstResponsePath = join(tmp, 'first-responses.jsonl');
    const firstResponse = '{"wouldApprove":true}\n';
    const responsePath = join(tmp, 'shell-responses.jsonl');
    const response = '{"wouldApprove":false}\n';
    writeFileSync(firstResponsePath, firstResponse);
    writeFileSync(responsePath, response);
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      env[HARNESS_BOUNDARY_RESPONSES_ENV] = firstResponsePath;
      expect(harnessMainTreeReject(join(outside, 'first-mailbox.ts'), env, boundary)).toContain('격리 경계 밖');
      env[HARNESS_BOUNDARY_RESPONSES_ENV] = responsePath;
      expect(harnessCommandWriteReject('MODE=test bun hidden-argument', boundary, 'test', env)).toContain('인식하지 못한 명령 MODE=test');
      expect(harnessCommandWriteReject('MODE=test bun hidden-argument', boundary, 'test', env)).toContain('인식하지 못한 명령 MODE=test');
      const records = log.mock.calls
        .filter(([category, event]) => category === 'harness.boundary' && event === 'response-mailbox-observed')
        .map(([, , data]) => data as Record<string, unknown>);
      expect(records).toHaveLength(3);
      expect(records.map((record) => record.responseBytes)).toEqual([Buffer.byteLength(firstResponse), Buffer.byteLength(response), Buffer.byteLength(response)]);
      expect(records.map((record) => record.requestCount)).toEqual([1, 1, 2]);
      expect(JSON.stringify(records)).not.toContain(firstResponsePath);
      expect(JSON.stringify(records)).not.toContain(responsePath);
    } finally {
      log.mockRestore();
    }
  });

  it('회신 요청 식별자만 이 프로세스의 요청과 짝지어 관측하고 승인·이유와 거부문은 바꾸지 않는다', () => {
    const responsePath = join(tmp, 'responses.jsonl');
    const target = join(outside, 'matched-response.ts');
    env[HARNESS_BOUNDARY_RESPONSES_ENV] = responsePath;
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      const rejection = harnessMainTreeReject(target, env, boundary);
      const requestId = (JSON.parse(readFileSync(requestPath, 'utf8')) as { requestId: string }).requestId;
      writeFileSync(responsePath, [
        JSON.stringify({ requestId: 'unrelated-request', wouldApprove: true, evidenceWhy: 'unrelated reason' }),
        JSON.stringify({ requestId, wouldApprove: false, evidenceWhy: 'matched reason' }),
      ].join('\n'));
      expect(harnessMainTreeReject(join(outside, 'matched-response-second.ts'), env, boundary)).toBe(rejection!.replace(target, join(outside, 'matched-response-second.ts')));
      const records = log.mock.calls
        .filter(([category, event]) => category === 'harness.boundary' && event === 'response-mailbox-matches-observed')
        .map(([, , data]) => data as Record<string, unknown>);
      expect(records).toEqual([{ matchedRequestCount: 1, requestCount: 2 }]);
      expect(JSON.stringify(records)).not.toContain('wouldApprove');
      expect(JSON.stringify(records)).not.toContain('evidenceWhy');
      expect(JSON.stringify(records)).not.toContain('matched reason');
    } finally {
      log.mockRestore();
    }
  });

  it('무관한 회신 식별자만 있으면 짝지어진 요청 수를 0으로 관측한다', () => {
    const responsePath = join(tmp, 'unrelated-responses.jsonl');
    env[HARNESS_BOUNDARY_RESPONSES_ENV] = responsePath;
    writeFileSync(responsePath, `${JSON.stringify({ requestId: 'unrelated-request', wouldApprove: true, evidenceWhy: 'unrelated reason' })}\n`);
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      expect(harnessMainTreeReject(join(outside, 'unrelated-response.ts'), env, boundary)).toContain('격리 경계 밖');
      const records = log.mock.calls
        .filter(([category, event]) => category === 'harness.boundary' && event === 'response-mailbox-matches-observed')
        .map(([, , data]) => data as Record<string, unknown>);
      expect(records).toEqual([{ matchedRequestCount: 0, requestCount: 1 }]);
    } finally {
      log.mockRestore();
    }
  });

  it('회신 경로 환경 변수가 없으면 새 관측 없이 종전 거부를 유지한다', () => {
    const withoutMailbox = harnessEnv({ [HARNESS_BOUNDARY_ENV]: boundary });
    const target = join(outside, 'x.ts');
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      expect(harnessMainTreeReject(target, withoutMailbox, boundary)).toBe(`격리 경계 밖 쓰기 거부(하니스 격리·self-implement): ${target}. 격리 worktree(${boundary}) 내부 경로로 쓰라(정본 트리 오염 금지).`);
      expect(log.mock.calls.some(([category, event]) => category === 'harness.boundary' && event === 'response-mailbox-observed')).toBe(false);
      expect(existsSync(requestPath)).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it('commandAction은 문자열·배열을 동일하게 요약하고 git 읽기와 변경을 구별한다', () => {
    expect(commandAction('git status /private/repository')).toBe('git status');
    expect(commandAction(['git', 'status', '/private/repository'])).toBe('git status');
    expect(commandAction('git commit -m secret-message')).toBe('git commit');
    expect(commandAction(['git', 'commit', '-m', 'secret-message'])).toBe('git commit');
    expect(commandAction('MODE=secret-value bun hidden-argument')).toBe('MODE');
  });

  it('commandAction은 알려지지 않은 git 두 번째 토큰을 기록하지 않는다', () => {
    const secret = 'private-repository';
    expect(commandAction(`git ${secret} /private/repository`)).toBe('git unknown');
    expect(commandAction(['git', secret, '/private/repository'])).toBe('git unknown');
    expect(commandAction(`git ${secret} /private/repository`)).not.toContain(secret);
  });

  it('명령 거부 요청은 익명화된 command 관측만 남기고 git action·원문 인자·경로를 구분한다', () => {
    const statusCommand = 'git status /private/repository | unknown-command';
    const commitCommand = 'git commit -m secret-message | unknown-command';
    expect(harnessCommandWriteReject(statusCommand, boundary, 'test', env)).toContain('인식하지 못한 명령 unknown-command');
    expect(harnessCommandWriteReject(commitCommand, boundary, 'test', env)).toContain('인식하지 못한 명령 unknown-command');
    const [statusRequest, commitRequest] = readFileSync(requestPath, 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(statusRequest).toMatchObject({ commandFirstToken: 'git', commandAction: 'git status', commandChars: statusCommand.length, targetKnown: false, decidingToken: 'none', observedRawShellMetacharacters: '|' });
    expect(commitRequest).toMatchObject({ commandFirstToken: 'git', commandAction: 'git commit', commandChars: commitCommand.length, targetKnown: false, decidingToken: 'none', observedRawShellMetacharacters: '|' });
    expect(statusRequest.commandHash).toMatch(/^[a-f0-9]{16}$/);
    expect(commitRequest.commandHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify([statusRequest, commitRequest])).not.toContain('/private/repository');
    expect(JSON.stringify([statusRequest, commitRequest])).not.toContain('secret-message');
    expect(statusRequest).not.toHaveProperty('command');
    expect(commitRequest).not.toHaveProperty('command');
  });

  it('미지 파이프 조각의 이름·연산자·결정 순번만 우편함과 로그에 남긴다', () => {
    const command = 'bun test a.test.ts 2>&1 | $(echo sh)';
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('셸 합성 문법 토큰 $');
      const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
      const observed = log.mock.calls.find(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject')?.[2] as Record<string, unknown>;
      for (const record of [request, observed]) {
        expect(record).toMatchObject({ segmentHeads: ['bun', '$'], segmentOperators: ['|'], decidingSegmentIndex: 1, targetKnown: false });
        expect(JSON.stringify(record)).not.toContain('$(echo sh)');
        expect(JSON.stringify(record)).not.toContain('a.test.ts');
      }
      expect(harnessCommandWriteReject('bun test a.test.ts 2>&1 | tee /outside/log', boundary, 'test', env)).toContain('격리 경계 밖');
      const pathRequest = JSON.parse(readFileSync(requestPath, 'utf8').trim().split('\n').at(-1)!) as Record<string, unknown>;
      expect(pathRequest).not.toHaveProperty('segmentHeads');
      expect(pathRequest).not.toHaveProperty('segmentOperators');
    } finally {
      log.mockRestore();
    }
  });

  it('따옴표 밖 혼합 합성의 순서와 실제 거부 조각 순번을 남긴다', () => {
    const command = 'pwd; /usr/bin/bun test a.test.ts && rg "x|y" | unknown-command secret';
    expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('인식하지 못한 명령 unknown-command');
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request).toMatchObject({
      segmentHeads: ['pwd', 'bun', 'rg', 'unknown-command'],
      segmentOperators: [';', '&&', '|'],
      decidingSegmentIndex: 3,
    });
    expect(request).not.toHaveProperty('segmentsTruncated');
    expect(JSON.stringify(request)).not.toContain('secret');
  });

  it('스물다섯 조각 거부 관측은 앞 스무 머리만 남기고 생략을 표시한다', () => {
    const command = [...Array.from({ length: 24 }, () => 'pwd'), 'unknown-command'].join('; ');
    expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('인식하지 못한 명령 unknown-command');
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request.segmentHeads).toEqual(Array.from({ length: 20 }, () => 'pwd'));
    expect(request.segmentOperators).toEqual(Array.from({ length: 19 }, () => ';'));
    expect(request).toMatchObject({ segmentsTruncated: true, decidingSegmentIndex: 24 });
    expect(JSON.stringify(request)).not.toContain('unknown-command');
  });

  it('인용·이스케이프된 연산자는 분리하지 않고 환경 접두·경로는 명령 이름만 관측한다', () => {
    const command = 'MODE=secret /usr/bin/bun test "a|b" | /usr/bin/unknown-command secret\\;value || echo x';
    expect(harnessCommandWriteReject(command, boundary, 'test', env)).not.toBeNull();
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request).toMatchObject({ segmentHeads: ['bun', 'unknown-command', 'echo'], segmentOperators: ['|', '||'] });
    expect(JSON.stringify(request)).not.toContain('secret');
    expect(JSON.stringify(request)).not.toContain('/usr/bin');
  });

  it('파이프 거부는 원 명령 자리에서 관측한 글자를 mailbox·판정·진행 줄까지 전달하고 원문은 남기지 않는다', () => {
    const command = 'bun test src/harness/harness-write-boundary.test.ts | unknown-command';
    expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('인식하지 못한 명령 unknown-command');
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request.decidingToken).toBe('none');
    expect(request.observedRawShellMetacharacters).toBe('|');
    expect(request.observedRawShellMetacharacters).not.toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    expect(request).not.toHaveProperty('command');
    expect(JSON.stringify(request)).not.toContain(command);
    expect(JSON.stringify(request)).not.toContain('harness-write-boundary.test.ts');
    const parsed = parseBoundaryApprovalRequest(request);
    expect(parsed).toMatchObject({ commandFirstToken: 'bun', observedRawShellMetacharacters: '|' });
    expect(parsed).not.toHaveProperty('command');
    const verdict = decideBoundaryApproval(parsed!);
    expect(verdict).toMatchObject({
      requestKind: 'rejected',
      wouldApprove: false,
      evidenceWhy: 'target-unknown',
      observedRawShellMetacharacters: '|',
    });
    expect(JSON.stringify(verdict)).not.toContain(command);
    const progress = formatBoundaryProgressLine({ requestId: String(request.requestId), ...verdict });
    expect(progress).toBe(`[boundary] requestId=${request.requestId} reason=target-unknown parentWouldApprove=false approvalEnforced=false childRejection=preserved observedRawShellMetacharacters=| commandFirstToken=bun decidingToken=none commandAction=bun\n`);
    expect(progress).not.toContain('observedRawShellMetacharacters=unknown');
    expect(progress).not.toContain(command);
  });

  it('메타문자가 없는 거부는 빈 관측을 실어 unknown과 가르고 원문은 남기지 않는다', () => {
    const command = 'python3 secret-script.py';
    expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('인식하지 못한 명령 python3');
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request.decidingToken).toBe('none');
    expect(request.observedRawShellMetacharacters).toBe('');
    expect(request.observedRawShellMetacharacters).not.toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    expect(request).not.toHaveProperty('command');
    expect(JSON.stringify(request)).not.toContain('secret-script.py');
    const parsed = parseBoundaryApprovalRequest(request);
    expect(parsed?.observedRawShellMetacharacters).toBe('');
    expect(parsed).not.toHaveProperty('command');
    const verdict = decideBoundaryApproval(parsed!);
    expect(verdict.observedRawShellMetacharacters).toBe('');
    expect(verdict.observedRawShellMetacharacters).not.toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    const progress = formatBoundaryProgressLine({ requestId: String(request.requestId), ...verdict });
    expect(progress).toBe(`[boundary] requestId=${request.requestId} reason=command-token-not-allowlisted parentWouldApprove=false approvalEnforced=false childRejection=preserved observedRawShellMetacharacters= commandFirstToken=python3 decidingToken=none commandAction=python3\n`);
    expect(progress).not.toContain('observedRawShellMetacharacters=unknown');
    expect(progress).not.toContain('secret-script.py');
  });

  it('개행이 든 명령 거부는 관측 개행을 mailbox·판정까지 전달하고 진행 줄은 한 레코드다', () => {
    const command = 'bun test\nrg foo';
    expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('셸 합성 문법 토큰');
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request.observedRawShellMetacharacters).toBe('\n');
    expect(request.observedRawShellMetacharacters).not.toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    expect(request).not.toHaveProperty('command');
    expect(JSON.stringify(request)).not.toContain('rg foo');
    const parsed = parseBoundaryApprovalRequest(request);
    expect(parsed?.observedRawShellMetacharacters).toBe('\n');
    expect(parsed).not.toHaveProperty('command');
    const verdict = decideBoundaryApproval(parsed!);
    expect(verdict.observedRawShellMetacharacters).toBe('\n');
    expect(JSON.stringify(verdict)).not.toContain(command);
    const progress = formatBoundaryProgressLine({ requestId: String(request.requestId), ...verdict });
    expect(progress).toBe(`[boundary] requestId=${request.requestId} reason=target-unknown parentWouldApprove=false approvalEnforced=false childRejection=preserved observedRawShellMetacharacters=\\n commandFirstToken=bun decidingToken=\\n commandAction=bun\n`);
    expect(progress.match(/\n/g)).toHaveLength(1);
    expect(progress.split('\n')).toHaveLength(2);
    expect(progress.slice(0, -1).includes('\n')).toBe(false);
    expect(progress).toContain('observedRawShellMetacharacters=\\n');
    expect(progress).not.toContain('observedRawShellMetacharacters=unknown');
    expect(progress).not.toContain('rg foo');
  });

  it('거부 관측은 알려지지 않은 git action과 원문 인자·경로를 외부에 남기지 않는다', () => {
    const secret = 'private-repository';
    const command = `git ${secret} /private/repository | cat`;
    expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('인식하지 못한 git 하위 명령');
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request).toMatchObject({ commandFirstToken: 'git', commandAction: 'git unknown', commandChars: command.length, targetKnown: false });
    expect(JSON.stringify(request)).not.toContain(secret);
    expect(JSON.stringify(request)).not.toContain('/private/repository');
  });

  it('요청 파일 쓰기 실패도 거부 판정을 바꾸지 않는다', () => {
    const target = join(outside, 'x.ts');
    const expected = harnessMainTreeReject(target, harnessEnv({ [HARNESS_BOUNDARY_ENV]: boundary }), boundary);
    env[HARNESS_BOUNDARY_REQUESTS_ENV] = join(tmp, 'missing', 'requests.jsonl');
    expect(harnessMainTreeReject(target, env, boundary)).toBe(expected);
  });

  it('허용 명령 시작은 원문 없이 익명화해 commandAction을 append하며 env 부재와 쓰기 실패를 격리한다', () => {
    const command = 'bun test secret-argument';
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(true);
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request).toMatchObject({ requestType: 'command-start', commandFirstToken: 'bun', commandAction: 'bun', commandChars: command.length, via: 'bash' });
    expect(request.commandHash).toMatch(/^[a-f0-9]{16}$/);
    expect(Object.keys(request).filter((key) => key.startsWith('command'))).toEqual(['commandFirstToken', 'commandAction', 'commandChars', 'commandHash']);
    expect(request.observedRawShellMetacharacters).toBe('');
    expect(request.observedRawShellMetacharacters).not.toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    expect(JSON.stringify(request)).not.toContain(command);
    expect(JSON.stringify(request)).not.toContain('secret-argument');
    const parsed = parseBoundaryApprovalRequest(request);
    expect(parsed).toMatchObject({ commandAction: 'bun', observedRawShellMetacharacters: '' });
    // 명령 시작 «통지»는 거부가 아니다(#20270) — 전달 계약은 같은 레코드를 «거부»로 넣어 잰다.
    expect(decideBoundaryApproval(parsed!)).toMatchObject({ wouldApprove: false, evidenceWhy: 'not-a-rejection' });
    const verdict = decideBoundaryApproval({ ...parsed!, requestKind: 'rejected' });
    expect(verdict).toMatchObject({ commandAction: 'bun', observedRawShellMetacharacters: '' });
    expect(verdict.observedRawShellMetacharacters).not.toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    const progress = formatBoundaryProgressLine({ requestId: String(request.requestId), ...verdict });
    expect(progress).toBe(`[boundary] requestId=${request.requestId} reason=boundary-shell-syntax-with-bun parentWouldApprove=true approvalEnforced=false childRejection=would-have-been-approved observedRawShellMetacharacters= commandFirstToken=bun commandAction=bun\n`);
    expect(progress).not.toContain('observedRawShellMetacharacters=unknown');
    expect(progress).not.toContain(command);
    expect(progress).not.toContain('secret-argument');
    expect(notifyHarnessCommandStart(command, boundary, 'bash', harnessEnv({ [HARNESS_BOUNDARY_ENV]: boundary }))).toBe(false);
    env[HARNESS_BOUNDARY_REQUESTS_ENV] = join(tmp, 'missing', 'requests.jsonl');
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(false);
  });

  it('명령 시작은 git 읽기와 변경 action을 구분하면서 원문 피연산자와 경로를 남기지 않는다', () => {
    const commands = [
      { command: 'git log --oneline /private/repository', commandAction: 'git log' },
      { command: 'git reset --hard /private/repository', commandAction: 'git reset' },
    ] as const;
    for (const { command, commandAction } of commands) {
      expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(true);
      const request = JSON.parse(readFileSync(requestPath, 'utf8').trim().split('\n').at(-1)!) as Record<string, unknown>;
      expect(request).toMatchObject({ requestType: 'command-start', commandFirstToken: 'git', commandAction, commandChars: command.length, via: 'bash' });
      expect(request).not.toHaveProperty('command');
      expect(JSON.stringify(request)).not.toContain(command);
      expect(JSON.stringify(request)).not.toContain('/private/repository');
      const parsed = parseBoundaryApprovalRequest(request);
      expect(parsed).toMatchObject({ commandAction });
      const verdict = decideBoundaryApproval(parsed!);
      expect(verdict).toMatchObject({ commandAction, approve: false, shadowed: true });
    }
  });

  it('파이프가 든 명령 시작은 관측 글자와 commandAction을 요청·판정·진행 줄까지 전달하고 원문은 남기지 않는다', () => {
    const command = 'bun test src/harness/harness-write-boundary.test.ts | cat';
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(true);
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
    expect(request).toMatchObject({ requestType: 'command-start', commandFirstToken: 'bun', commandAction: 'bun', commandChars: command.length, via: 'bash' });
    expect(request.observedRawShellMetacharacters).toBe('|');
    expect(request.observedRawShellMetacharacters).not.toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    expect(request).not.toHaveProperty('command');
    expect(Object.keys(request).filter((key) => key.startsWith('command'))).toEqual(['commandFirstToken', 'commandAction', 'commandChars', 'commandHash']);
    expect(JSON.stringify(request)).not.toContain(command);
    expect(JSON.stringify(request)).not.toContain('harness-write-boundary.test.ts');
    const parsed = parseBoundaryApprovalRequest(request);
    expect(parsed).toMatchObject({ commandFirstToken: 'bun', commandAction: 'bun', observedRawShellMetacharacters: '|' });
    expect(parsed).not.toHaveProperty('command');
    expect(decideBoundaryApproval(parsed!)).toMatchObject({ wouldApprove: false, evidenceWhy: 'not-a-rejection' });
    const verdict = decideBoundaryApproval({ ...parsed!, requestKind: 'rejected' });
    expect(verdict).toMatchObject({
      wouldApprove: true,
      evidenceWhy: 'boundary-shell-syntax-with-bun',
      commandAction: 'bun',
      observedRawShellMetacharacters: '|',
    });
    expect(JSON.stringify(verdict)).not.toContain(command);
    const progress = formatBoundaryProgressLine({ requestId: String(request.requestId), ...verdict });
    expect(progress).toBe(`[boundary] requestId=${request.requestId} reason=boundary-shell-syntax-with-bun parentWouldApprove=true approvalEnforced=false childRejection=would-have-been-approved observedRawShellMetacharacters=| commandFirstToken=bun commandAction=bun\n`);
    expect(progress).not.toContain('unknown');
    expect(progress).not.toContain(command);
    expect(progress).not.toContain('harness-write-boundary.test.ts');
  });

  it('파이프와 앤드 체인 거부는 파서가 실제로 본 서로 다른 결정 토큰을 보존한다', () => {
    const commands = [
      ['bun test src/x.test.ts | $(echo sh)', '$'],
      ['bun test src/x.test.ts &&', '&'],
    ] as const;
    for (const [command, decidingToken] of commands) {
      expect(harnessCommandWriteReject(command, boundary, 'test', env)).toContain('셸 합성 문법 토큰');
      const request = JSON.parse(readFileSync(requestPath, 'utf8').trim().split('\n').at(-1)!) as Record<string, unknown>;
      expect(request).toMatchObject({ decidingToken, targetKnown: false });
      const verdict = decideBoundaryApproval(parseBoundaryApprovalRequest(request)!);
      expect(verdict).toMatchObject({ decidingToken });
      expect(verdict.observedRawShellMetacharacters).toContain(decidingToken);
    }
  });

  it('명령 시작은 계약값 200개 뒤에 멈추고 상한 도달 관측을 한 번만 남긴다', () => {
    const command = 'bun test cap-case';
    for (let index = 0; index < 200; index++) expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(true);
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(false);
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(false);
    const records = readFileSync(requestPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.filter((record) => record.requestType === 'command-start')).toHaveLength(200);
    expect(records.filter((record) => record.requestType === 'command-start-cap-reached')).toHaveLength(1);
  });

  it('상한 관측 append가 실패하면 다음 호출에서 성공할 때까지 재시도하고 성공 뒤 한 번만 남긴다', () => {
    const command = 'bun test cap-retry';
    for (let index = 0; index < 200; index++) expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(true);
    env[HARNESS_BOUNDARY_REQUESTS_ENV] = join(tmp, 'missing', 'requests.jsonl');
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(false);
    env[HARNESS_BOUNDARY_REQUESTS_ENV] = requestPath;
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(false);
    expect(notifyHarnessCommandStart(command, boundary, 'bash', env)).toBe(false);
    const records = readFileSync(requestPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.filter((record) => record.requestType === 'command-start')).toHaveLength(200);
    expect(records.filter((record) => record.requestType === 'command-start-cap-reached')).toHaveLength(1);
  });
});

// ── 자동추론 폴백: 실제 git worktree 로 마커 없이도 경계 확립 ──
describe('resolveHarnessBoundary × 실제 git worktree (자동추론 폴백)', () => {
  let tmp = ''; let mainRepo = ''; let wt = '';
  const git = (cwd: string, argv: string[]): void => { spawnSync('git', argv, { cwd, encoding: 'utf8' }); };
  beforeEach(() => {
    __resetSessionWorkingDir();
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-git-')));
    mainRepo = join(tmp, 'main'); mkdirSync(mainRepo);
    git(mainRepo, ['init', '-q']);
    git(mainRepo, ['config', 'user.email', 't@t']); git(mainRepo, ['config', 'user.name', 't']);
    git(mainRepo, ['commit', '-q', '--allow-empty', '-m', 'init']);
    wt = join(tmp, 'wt');
    git(mainRepo, ['worktree', 'add', '-q', wt, '-b', 'feat']);
  });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('마커 없음 + cwd=진짜 worktree = worktree 루트를 경계로 자동추론', () => {
    expect(resolveHarnessBoundary(harnessEnv(), wt)).toBe(wt);
  });

  it('마커 없음 + cwd=worktree 하위 디렉토리 = worktree 루트로 해석(findGitDir 상향)', () => {
    const sub = join(wt, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    expect(resolveHarnessBoundary(harnessEnv(), sub)).toBe(wt); // 하위 입력이어도 경계=worktree 루트
  });

  it('마커 없음 + cwd=정본 루트(worktree 아님) = null(정본 축복 안 함)', () => {
    expect(resolveHarnessBoundary(harnessEnv(), mainRepo)).toBeNull();
  });

  it('자동추론 경계로 정본 write 거부·worktree write 허용', () => {
    const env = harnessEnv(); // 마커 없음 → 자동추론
    expect(harnessMainTreeReject(join(mainRepo, 'src', 'x.ts'), env, wt)).toContain('격리 경계 밖');
    expect(harnessMainTreeReject(join(wt, 'src', 'x.ts'), env, wt)).toBeNull();
  });
});

// ── 통합: apply.ts 프로덕션 배선(process.chdir 로 실제 process.cwd 경로) ──
describe('applyEdit × 격리 경계 (프로덕션 통합)', () => {
  let tmp = ''; let mainRepo = ''; let wt = '';
  const git = (cwd: string, argv: string[]): void => { spawnSync('git', argv, { cwd, encoding: 'utf8' }); };
  beforeEach(() => {
    __resetSessionWorkingDir();
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-app-')));
    mainRepo = join(tmp, 'main'); mkdirSync(mainRepo);
    git(mainRepo, ['init', '-q']);
    git(mainRepo, ['config', 'user.email', 't@t']); git(mainRepo, ['config', 'user.name', 't']);
    git(mainRepo, ['commit', '-q', '--allow-empty', '-m', 'init']);
    wt = join(tmp, 'wt');
    git(mainRepo, ['worktree', 'add', '-q', wt, '-b', 'feat']);
  });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('심링크 경로 boundary 안 쓰기는 오판 거부 안 함(must-fix: boundary 양쪽 canonicalize)', async () => {
    // boundary 를 심링크 경로로 설정(정상 walker 경계). 그 안(canonical) 쓰기는 허용돼야 한다.
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-lnk-')));
    const link = join(tmp, 'blink');
    symlinkSync(real, link); // link → real
    try {
      __resetSessionWorkingDir();
      setSessionCwd(link, 'tool', { boundary: true }); // 경계=심링크 경로(비-canonical)
      // 경계 안(실경로) 파일 Edit → canon(target)=real/x.ts, canon(boundary)=real → 허용(오판 거부 없음).
      const inside = await applyEdit(
        { file_path: join(real, 'x.ts'), edits: [{ old_string: 'a', new_string: 'b' }] },
        new ReadFileStateStore(),
      );
      // boundary 게이트 통과 증명 = PolicyRejected 아님(이후 Read-invariant 로 NotReadFirst).
      expect(inside.ok).toBe(false);
      if (!inside.ok) expect(inside.code).toBe(EditErrorCode.NotReadFirst);
    } finally {
      rmSync(real, { recursive: true, force: true });
      __resetSessionWorkingDir();
    }
  });

  it('명시 마커 경로: process.cwd()=정본이어도 applyEdit 이 정본 write 를 PolicyRejected', async () => {
    const prevCwd = process.cwd();
    const prevSpace = process.env[HARNESS_SPACE_ENV];
    const prevBoundary = process.env[HARNESS_BOUNDARY_ENV];
    try {
      // ★ 리뷰 must-fix 재현 — 자식이 (이상하게) 정본 트리에서 부팅. 그래도 명시 마커=worktree 라 정본 거부.
      process.chdir(mainRepo);
      process.env[HARNESS_SPACE_ENV] = 'self-implement';
      process.env[HARNESS_BOUNDARY_ENV] = wt; // 스포너가 심은 진짜 격리 worktree
      __resetSessionWorkingDir();
      initSessionWorkingDir(process.cwd()); // = mainRepo, boundary off → apply.ts (c) 경로

      const rejected = await applyEdit(
        { file_path: join(mainRepo, 'src', 'x.ts'), edits: [{ old_string: 'a', new_string: 'b' }] },
        new ReadFileStateStore(),
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.code).toBe(EditErrorCode.PolicyRejected);
      // ★ 부작용 부재(리뷰 should-fix) — 거부 코드만이 아니라 실제 정본 파일이 **생성 안 됐음**을 검증.
      expect(existsSync(join(mainRepo, 'src', 'x.ts'))).toBe(false);

      // 대조 — 경계(worktree) 내부는 게이트 통과(이후 Read-invariant 로 막힘=NotReadFirst = 통과 증명).
      const passed = await applyEdit(
        { file_path: join(wt, 'src', 'y.ts'), edits: [{ old_string: 'a', new_string: 'b' }] },
        new ReadFileStateStore(),
      );
      expect(passed.ok).toBe(false);
      if (!passed.ok) expect(passed.code).toBe(EditErrorCode.NotReadFirst);
    } finally {
      process.chdir(prevCwd);
      if (prevSpace === undefined) delete process.env[HARNESS_SPACE_ENV]; else process.env[HARNESS_SPACE_ENV] = prevSpace;
      if (prevBoundary === undefined) delete process.env[HARNESS_BOUNDARY_ENV]; else process.env[HARNESS_BOUNDARY_ENV] = prevBoundary;
      __resetSessionWorkingDir();
    }
  });
});

// ── must-fix(리뷰 4R): 실제 스포너(headless-monad-driver)가 만든 env 가 SPACE+BOUNDARY 를 함께 싣는지 ──
//   수동 주입이 아닌 runHeadlessGoalLoopPty 의 실 env 구성으로 검증(space 없이 부팅=무보호 배선갭 차단).
describe('runHeadlessGoalLoopPty env 구성 (스포너 배선)', () => {
  it('자식 mailbox의 완결 줄을 부모 관측에 원문 그대로 한 번만 남긴다', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-watch-')));
    const observed: Array<{ data: Record<string, unknown>; compact?: { stringMax?: number } }> = [];
    const progress: string[] = [];
    const request = JSON.stringify({ requestId: 'req-surface', boundary: tmp, cwd: `${tmp}/src`, targetKnown: false, commandFirstToken: 'bun' });
    let mailbox = '';
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    let closeCalls = 0;
    watcher.close = () => { closeCalls += 1; };
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>, opts?: { compact?: { stringMax?: number } }) => {
      if (category === 'harness.boundary' && event === 'request-received' && data) observed.push({ data, compact: opts?.compact });
    }) as never);
    const fakeSpawn = ((o: { env: Record<string, string> }) => {
      mailbox = o.env[HARNESS_BOUNDARY_REQUESTS_ENV]!;
      writeFileSync(mailbox, `${request}\n`);
      return {
        id: 'pty-test-watch', write: () => {}, renderScreen: async () => 'GOAL-COMPLETE',
        renderScreenPng: async () => null, snapshot: () => 'GOAL-COMPLETE\n', drainDelta: () => '',
        isAlive: () => false, exitCode: 0, kill: () => {},
      };
    }) as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['spawn'];
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/x', cwd: tmp, featurePrompt: 'p', maxWaitSec: 1, pollMs: 1,
        spawn: fakeSpawn, ptyAvailable: () => true, onSurfaceProgress: (line) => progress.push(line),
        boundaryRequestsWatchOptions: { watchDirectory: (() => watcher) as unknown as typeof import('node:fs').watch },
      });
      expect(observed).toHaveLength(1);
      expect(closeCalls).toBe(1);
      expect(observed[0]?.data.request).toBe(request);
      expect(observed[0]?.compact?.stringMax).toBe(1024);
      expect(progress).toContain('[boundary] requestId=req-surface reason=target-unknown parentWouldApprove=false approvalEnforced=false childRejection=preserved observedRawShellMetacharacters=unknown\n');
      expect(progress.join('')).not.toContain('commandFirstToken');
      expect(progress.join('')).not.toContain(request);
    } finally {
      log.mockRestore();
      if (mailbox) rmSync(mailbox, { force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('경계 진행 줄은 악성 식별자와 사유의 CR/LF 및 ANSI 제어문자를 제거하고 판정을 구분한다', () => {
    const requestId = 'req\r\n\x1b[31mred\x1b[0m\x1b]8;;https://example.test\x07link\x1b]8;;\x07';
    const evidenceWhy = 'reason\r\n\x1b[2Jclear\x1b[0m\x1b]0;title\x07';
    const progress = formatBoundaryProgressLine({ requestId, evidenceWhy, wouldApprove: true, approve: false });

    expect(progress).toBe('[boundary] requestId=req  redlink reason=reason  clear parentWouldApprove=true approvalEnforced=false childRejection=would-have-been-approved observedRawShellMetacharacters=unknown\n');
    expect(progress.match(/\n/g)).toHaveLength(1);
    expect(progress).not.toContain('\r');
    expect(progress).not.toContain('\x1b');
    expect(progress).not.toContain('https://example.test');
    expect(progress).toContain('parentWouldApprove=true approvalEnforced=false childRejection=would-have-been-approved');
  });

  it('개입 감독 진행 줄은 action 부재와 wait을 구분하고 사유를 한 줄로 무해화한다', () => {
    const progress = formatSupervisionProgressLine({
      action: 'input',
      reason: 'send\r\n\x1b[2Jcontext',
    });

    expect(progress).toBe('[supervision] action=input reason=send  context\n');
    expect(formatSupervisionProgressLine({ action: undefined, reason: undefined })).toBe('[supervision] action=none reason=none\n');
    expect(progress.match(/\n/g)).toHaveLength(1);
    expect(progress).not.toContain('\r');
    expect(progress).not.toContain('\x1b');
  });

  it('frame-stall 진행 줄은 런타임 미관측 sentinel과 0 rung을 구분하고 한 줄로 무해화한다', () => {
    const progress = formatFrameStallProgressLine({ previousRung: -1, currentRung: 0 });

    expect(progress).toBe('[frame-stall] previousRung=unknown currentRung=0\n');
    expect(progress.match(/\n/g)).toHaveLength(1);
    expect(progress).not.toContain('\r');
    expect(progress).not.toContain('\x1b');
  });

  it('약 800자 경계 요청을 compact 뒤에도 원문 그대로 적재한다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-watch-compact-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const request = 'x'.repeat(800);
    const records: Array<Record<string, unknown>> = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    writeFileSync(mailbox, `${request}\n`);
    const off = debug.registerSink({
      name: 'harness-boundary-request-compact-test-capture',
      emit: (rec) => {
        if (rec.category === 'harness.boundary' && rec.event === 'request-received') {
          records.push(rec.data as Record<string, unknown>);
        }
      },
    });
    const wasEnabled = debug.enabled;
    debug.enable();
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: (() => watcher) as unknown as typeof import('node:fs').watch,
      });
      expect(records).toHaveLength(1);
      expect(records[0]?.request).toBe(request);
      expect(String(records[0]?.request)).toHaveLength(800);
      expect(String(records[0]?.request)).not.toContain('«+');
      stop();
    } finally {
      off();
      if (!wasEnabled) debug.disable();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⛔⭐⭐⭐ M5 배선 회귀 — 「테스트가 코드를 무는가」가 아니라 «그 값이 실제 판정 레코드에 실리는가».
  //   무인 리뷰 should-fix: 순수 함수만 물면 배선 한 줄을 지워도 통과한다.
  it('run-supervision.verdict 가 경계 관문을 같은 줄에 싣고 호출자 콜백도 보존한다', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-m5-')));
    const verdicts: Array<Record<string, unknown>> = [];
    const callerSaw: string[] = [];
    let mailbox = '';
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'self-implement' && event === 'run-supervision.verdict' && data) verdicts.push(data);
    }) as never);
    const fakeSpawn = ((o: { env: Record<string, string> }) => {
      mailbox = o.env[HARNESS_BOUNDARY_REQUESTS_ENV]!;
      writeFileSync(mailbox, `${JSON.stringify({ requestId: 'req-m5', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      return {
        id: 'pty-test-m5', write: () => {}, renderScreen: async () => 'working…',
        renderScreenPng: async () => null, snapshot: () => 'working…\n', drainDelta: () => '',
        isAlive: () => true, exitCode: null, kill: () => {},
      };
    }) as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['spawn'];
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/x', cwd: tmp, featurePrompt: 'p', maxWaitSec: 2, pollMs: 1,
        spawn: fakeSpawn, ptyAvailable: () => true,
        brain: { decide: () => ({ action: 'wait' as const, reason: 'stub' }) } as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['brain'],
        boundaryRequestsWatchOptions: {
          watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => { watcher.on('change', listener); return watcher; }) as unknown as typeof import('node:fs').watch,
          onVerdict: (v) => { callerSaw.push(v.requestId); },
        },
      });
      // ⭐ 감시가 요청을 읽은 «뒤»에 난 판정 레코드가 그 값을 싣는다.
      const withBoundary = verdicts.filter((v) => (v.boundaryRequests as number) > 0);
      expect(withBoundary.length).toBeGreaterThan(0);
      expect(withBoundary[0]).toMatchObject({
        boundaryRequests: 1,
        boundaryWouldApprove: true,
        boundaryEvidenceWhy: 'boundary-shell-syntax-with-bun',
        boundaryRequestId: 'req-m5',
      });
      // ⛔ 호출자가 준 콜백을 «밀어내지 않는다».
      expect(callerSaw).toEqual(['req-m5']);
      // ⚠️ 이 테스트는 «요청이 있는» 갈래만 덮는다 — 감시가 기동 즉시 드레인하므로
      //   여기서는 count 0 레코드가 «안 난다». 0 갈래는 바로 아래 테스트가 «따로» 문다.
      //   (무인 리뷰가 짚은 대로, 한 테스트에서 `if (before)` 로 두면 그 계약이 영영 안 밟힌다.)
    } finally {
      log.mockRestore();
      if (mailbox) rmSync(mailbox, { force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('wait 아닌 감독 판정만 기존 부모 진행 콜백으로 한 줄 전달한다', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-supervision-progress-')));
    const progress: string[] = [];
    let decisions = 0;
    const fakeSpawn = (() => ({
      id: 'pty-supervision-progress', write: () => {}, renderScreen: async () => 'working…',
      renderScreenPng: async () => null, snapshot: () => 'working…\n', drainDelta: () => '',
      isAlive: () => true, exitCode: null, kill: () => {}, canWrite: () => true,
    })) as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['spawn'];
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/x', cwd: tmp, featurePrompt: 'p', maxWaitSec: 1, pollMs: 1,
        spawn: fakeSpawn, ptyAvailable: () => true, onSurfaceProgress: (line) => progress.push(line),
        brain: {
          decide: () => decisions++ === 0
            ? ({ action: 'input' as const, text: 'resume\r\n\x1b[2Jwork' })
            : ({ action: 'wait' as const, reason: 'quiet' }),
        } as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['brain'],
      });
      expect(progress.filter((line) => line.startsWith('[supervision]'))).toEqual([
        '[supervision] action=input reason=resume  work delivery=not-delivered deliveryReason=next-round-callback-unwired\n',
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⛔⭐ 0 갈래 — 요청이 «하나도 없을 때». 부재와 0 을 가르는 계약이 여기서 밟힌다.
  it('경계 요청이 없으면 판정 레코드가 수만 0 으로 남기고 판정 세 칸을 안 싣는다', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-m5-zero-')));
    const verdicts: Array<Record<string, unknown>> = [];
    let mailbox = '';
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'self-implement' && event === 'run-supervision.verdict' && data) verdicts.push(data);
    }) as never);
    const fakeSpawn = ((o: { env: Record<string, string> }) => {
      mailbox = o.env[HARNESS_BOUNDARY_REQUESTS_ENV]!;
      writeFileSync(mailbox, '');   // ⭐ 우편함은 «있고» 비어 있다
      return {
        id: 'pty-test-m5-zero', write: () => {}, renderScreen: async () => 'working…',
        renderScreenPng: async () => null, snapshot: () => 'working…\n', drainDelta: () => '',
        isAlive: () => true, exitCode: null, kill: () => {},
      };
    }) as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['spawn'];
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/x', cwd: tmp, featurePrompt: 'p', maxWaitSec: 2, pollMs: 1,
        spawn: fakeSpawn, ptyAvailable: () => true,
        brain: { decide: () => ({ action: 'wait' as const, reason: 'stub' }) } as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['brain'],
        boundaryRequestsWatchOptions: {
          watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => { watcher.on('change', listener); return watcher; }) as unknown as typeof import('node:fs').watch,
        },
      });
      expect(verdicts.length).toBeGreaterThan(0);
      for (const v of verdicts) {
        expect(v.boundaryRequests).toBe(0);
        expect('boundaryWouldApprove' in v).toBe(false);
        expect('boundaryEvidenceWhy' in v).toBe(false);
        expect('boundaryRequestId' in v).toBe(false);
      }
    } finally {
      log.mockRestore();
      if (mailbox) rmSync(mailbox, { force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('회신 우편함에 판정 한 건마다 JSON 한 줄을 append하고 기존 그림자 관측을 보존한다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-approval-response-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const response = join(tmp, 'responses.jsonl');
    const events: string[] = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const previousResponsePath = process.env[HARNESS_BOUNDARY_RESPONSES_ENV];
    process.env[HARNESS_BOUNDARY_RESPONSES_ENV] = response;
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category === 'harness.boundary') events.push(event);
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
      });
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-2', boundary: '/repo/worktree', cwd: '/elsewhere', targetKnown: false, commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      const responses = readFileSync(response, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
      expect(responses).toEqual([
        { requestId: 'req-1', requestKind: 'rejected', wouldApprove: true, evidenceWhy: 'boundary-shell-syntax-with-bun' },
        { requestId: 'req-2', requestKind: 'rejected', wouldApprove: false, evidenceWhy: 'outside-boundary' },
      ]);
      expect(events).toEqual(['request-received', 'approval-shadow', 'request-received', 'approval-shadow']);
      stop();
    } finally {
      log.mockRestore();
      if (previousResponsePath === undefined) delete process.env[HARNESS_BOUNDARY_RESPONSES_ENV];
      else process.env[HARNESS_BOUNDARY_RESPONSES_ENV] = previousResponsePath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('회신 우편함이 없으면 만들거나 쓰지 않고 그림자 관측은 유지한다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-approval-no-response-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const response = join(tmp, 'responses.jsonl');
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    const previousResponsePath = process.env[HARNESS_BOUNDARY_RESPONSES_ENV];
    const events: string[] = [];
    watcher.close = () => {};
    delete process.env[HARNESS_BOUNDARY_RESPONSES_ENV];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category === 'harness.boundary') events.push(event);
    }) as never);
    try {
      expect(process.env[HARNESS_BOUNDARY_RESPONSES_ENV]).toBeUndefined();
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
      });
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(existsSync(response)).toBe(false);
      expect(events).toEqual(['request-received', 'approval-shadow']);
      stop();
    } finally {
      log.mockRestore();
      if (previousResponsePath === undefined) delete process.env[HARNESS_BOUNDARY_RESPONSES_ENV];
      else process.env[HARNESS_BOUNDARY_RESPONSES_ENV] = previousResponsePath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('회신 우편함 쓰기가 실패해도 다음 경계 판정을 처리한다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-approval-response-fail-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const events: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category === 'harness.boundary') events.push(event);
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        responsePath: join(tmp, 'responses.jsonl'),
        appendResponse: () => { throw new Error('response mailbox unavailable'); },
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
      });
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-2', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(events).toEqual([
        'request-received', 'approval-shadow', 'request-watch-fail',
        'request-received', 'approval-shadow', 'request-watch-fail',
      ]);
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('완결 요청 줄의 승인 판정을 그림자로 기록하고 요청을 변경하지 않는다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-approval-shadow-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'harness.boundary' && data) events.push({ event, data });
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
      });
      const request = { requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' };
      appendFileSync(mailbox, `${JSON.stringify(request)}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(events).toEqual([
        { event: 'request-received', data: { ptyId: 'p', runId: 'r', summary: { parse: 'ok', requestKind: 'rejected', requestId: 'req-1', commandFirstToken: 'bun' }, request: JSON.stringify(request) } },
        { event: 'approval-shadow', data: {
          ptyId: 'p', runId: 'r', requestId: 'req-1', requestKind: 'rejected', approve: false, why: 'boundary-shell-syntax-with-bun',
          shadowed: true, wouldApprove: true, evidenceWhy: 'boundary-shell-syntax-with-bun', commandFirstToken: 'bun',
          observedRawShellMetacharacters: 'unknown',
        } },
      ]);
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⭐⭐ M5 — 경계 판정을 «런 슈퍼바이저 레코드»로 올리는 통로.
  //   종전엔 이 판정이 자기 로그에만 남아 `run-supervision.verdict` 한 줄에서 «안 보였다».
  //   ⛔ 로그를 대체하지 않는다 — 로그와 콜백이 «둘 다» 난다.
  it('승인 판정을 onVerdict 로도 올린다 (로그는 그대로 남는다)', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-onverdict-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const events: string[] = [];
    const seen: Array<{ requestId: string; requestKind: string; wouldApprove: boolean; approve: boolean; evidenceWhy: string; observedRawShellMetacharacters: string }> = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category === 'harness.boundary') events.push(event);
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
        onVerdict: (verdict) => { seen.push(verdict); },
      });
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun', observedRawShellMetacharacters: '|' })}\n`);
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-2', boundary: '/repo/worktree', cwd: '/elsewhere', targetKnown: false, commandFirstToken: 'bun', observedRawShellMetacharacters: '' })}\n`);
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-3', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(seen).toEqual([
        { requestId: 'req-1', requestKind: 'rejected', wouldApprove: true, approve: false, evidenceWhy: 'boundary-shell-syntax-with-bun', observedRawShellMetacharacters: '|' },
        { requestId: 'req-2', requestKind: 'rejected', wouldApprove: false, approve: false, evidenceWhy: 'outside-boundary', observedRawShellMetacharacters: '' },
        { requestId: 'req-3', requestKind: 'rejected', wouldApprove: true, approve: false, evidenceWhy: 'boundary-shell-syntax-with-bun', observedRawShellMetacharacters: 'unknown' },
      ]);
      // ⛔ 콜백이 로그를 «대체»하지 않는다.
      expect(events).toEqual(['request-received', 'approval-shadow', 'request-received', 'approval-shadow', 'request-received', 'approval-shadow']);
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('mailbox에 주입된 원 명령·개행 관측은 파서가 버리고 verdict·진행 줄에 원문을 남기지 않는다', () => {
    const rawCommand = "bun test -- 'src/harness/harness-write-boundary.test.ts' 'src/self-implement/auto-intervene.test.ts'";
    const newlineInjection = 'secret-path\ninjected-progress-line';
    const parsedRaw = parseBoundaryApprovalRequest({
      requestId: 'req-inject',
      boundary: '/repo/worktree',
      cwd: '/repo/worktree/src',
      targetKnown: false,
      commandFirstToken: 'bun',
      observedRawShellMetacharacters: rawCommand,
    });
    expect(parsedRaw).not.toHaveProperty('observedRawShellMetacharacters');
    const verdict = decideBoundaryApproval(parsedRaw!);
    expect(verdict.observedRawShellMetacharacters).toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    expect(JSON.stringify(verdict)).not.toContain(rawCommand);
    expect(JSON.stringify(verdict)).not.toContain('harness-write-boundary.test.ts');
    const progress = formatBoundaryProgressLine({ requestId: 'req-inject', ...verdict });
    expect(progress).toBe('[boundary] requestId=req-inject reason=target-unknown parentWouldApprove=false approvalEnforced=false childRejection=preserved observedRawShellMetacharacters=unknown commandFirstToken=bun\n');
    expect(progress).not.toContain(rawCommand);
    expect(progress.split('\n')).toHaveLength(2);

    const parsedNewline = parseBoundaryApprovalRequest({
      requestId: 'req-nl',
      boundary: '/repo/worktree',
      cwd: '/repo/worktree/src',
      targetKnown: false,
      commandFirstToken: 'bun',
      observedRawShellMetacharacters: newlineInjection,
    });
    expect(parsedNewline).not.toHaveProperty('observedRawShellMetacharacters');
    const newlineVerdict = decideBoundaryApproval(parsedNewline!);
    expect(newlineVerdict.observedRawShellMetacharacters).toBe(UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS);
    expect(JSON.stringify(newlineVerdict)).not.toContain('secret-path');
    expect(JSON.stringify(newlineVerdict)).not.toContain('injected-progress-line');
    const newlineProgress = formatBoundaryProgressLine({ requestId: 'req-nl', ...newlineVerdict });
    expect(newlineProgress).not.toContain('secret-path');
    expect(newlineProgress).not.toContain('injected-progress-line');
    expect(newlineProgress.split('\n')).toHaveLength(2);
  });

  it('mailbox의 개행 단독 관측은 판정에 남고 진행 줄은 한 레코드로 인코딩한다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-nl-only-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const seen: Array<{ requestId: string; requestKind: string; wouldApprove: boolean; approve: boolean; evidenceWhy: string; observedRawShellMetacharacters: string }> = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
        onVerdict: (verdict) => { seen.push(verdict); },
      });
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-nl-only', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun', observedRawShellMetacharacters: '\n' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(seen).toEqual([
        { requestId: 'req-nl-only', requestKind: 'rejected', wouldApprove: true, approve: false, evidenceWhy: 'boundary-shell-syntax-with-bun', observedRawShellMetacharacters: '\n' },
      ]);
      const progress = formatBoundaryProgressLine(seen[0]!);
      expect(progress).toBe('[boundary] requestId=req-nl-only reason=boundary-shell-syntax-with-bun parentWouldApprove=true approvalEnforced=false childRejection=would-have-been-approved observedRawShellMetacharacters=\\n\n');
      expect(progress.match(/\n/g)).toHaveLength(1);
      expect(progress.split('\n')).toHaveLength(2);
      expect(progress.slice(0, -1).includes('\n')).toBe(false);
      expect(progress).toContain('observedRawShellMetacharacters=\\n');
      expect(progress).not.toContain('observedRawShellMetacharacters=unknown');
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('onVerdict 가 던져도 감시는 죽지 않고 fail-soft 로 남긴다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-onverdict-throw-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const events: string[] = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category === 'harness.boundary') events.push(event);
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
        onVerdict: () => { throw new Error('consumer exploded'); },
      });
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(events).toEqual(['request-received', 'approval-shadow', 'request-watch-fail']);
      // ⛔⭐ 「죽지 않는다」는 «다음 요청이 처리되는가»로만 증명된다(무인 리뷰 should-fix).
      //   요청 하나로 끝내면 그저 「그 한 줄에서 안 터졌다」까지다.
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-2', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(events).toEqual([
        'request-received', 'approval-shadow', 'request-watch-fail',
        'request-received', 'approval-shadow', 'request-watch-fail',
      ]);
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('approval-shadow 관측 실패를 unparsed로 오기록하지 않고 fail-soft로 남긴다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-approval-log-failure-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const events: string[] = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category !== 'harness.boundary') return;
      events.push(event);
      if (event === 'approval-shadow') throw new Error('shadow log unavailable');
    }) as never);
    try {
      // ⭐⭐ 1R must-fix 가 고친 «독립성»을 여기서 잠근다 — 로그가 던져도 onVerdict 는 «불려야» 한다.
      //   그 전엔 판정·로그·콜백이 한 try 라, 로그가 던지면 콜백이 영영 안 불리고
      //   슈퍼바이저 집계(boundaryRequests)가 «조용히» 빠졌다.
      const seenDespiteLogFailure: string[] = [];
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
        onVerdict: (verdict) => { seenDespiteLogFailure.push(verdict.requestId); },
      });
      appendFileSync(mailbox, `${JSON.stringify({ requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src', targetKnown: true, target: '/repo/worktree/src/a.ts', commandFirstToken: 'bun' })}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(events).toEqual(['request-received', 'approval-shadow', 'request-watch-fail']);
      expect(events).not.toContain('approval-shadow-unparsed');
      expect(seenDespiteLogFailure).toEqual(['req-1']);
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('onCommandStart 가 던져도 감시는 죽지 않고 request-watch-fail로 남긴다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-oncommandstart-throw-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const events: string[] = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string) => {
      if (category === 'harness.boundary') events.push(event);
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
        onCommandStart: () => { throw new Error('command-start consumer exploded'); },
      });
      const commandStart = { requestType: 'command-start', commandFirstToken: 'bun' };
      appendFileSync(mailbox, `${JSON.stringify(commandStart)}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(events).toEqual(['request-received', 'request-watch-fail', 'approval-shadow-unparsed']);
      expect(events).not.toContain('approval-shadow');
      appendFileSync(mailbox, `${JSON.stringify(commandStart)}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(events).toEqual([
        'request-received', 'request-watch-fail', 'approval-shadow-unparsed',
        'request-received', 'request-watch-fail', 'approval-shadow-unparsed',
      ]);
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('각 mailbox requestType을 response JSON과 onVerdict에 같은 closed requestKind로 전달한다', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-request-kind-propagation-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const response = join(tmp, 'responses.jsonl');
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const verdicts: Array<{ requestId: string; requestKind: string }> = [];
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        responsePath: response,
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
        onVerdict: (verdict) => { verdicts.push({ requestId: verdict.requestId, requestKind: verdict.requestKind }); },
      });
      const requestKinds = ['rejected', 'command-start', 'command-start-cap-reached'] as const;
      for (const [index, requestKind] of requestKinds.entries()) {
        const request = {
          requestId: `req-kind-${index}`,
          boundary: '/repo/worktree',
          cwd: '/repo/worktree',
          targetKnown: true,
          target: '/repo/worktree/src/a.ts',
          commandFirstToken: 'bun',
          ...(requestKind === 'rejected' ? {} : { requestType: requestKind }),
        };
        appendFileSync(mailbox, `${JSON.stringify(request)}\n`);
      }
      watcher.emit('change', 'requests.jsonl');
      const responses = readFileSync(response, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { requestId: string; requestKind: string });
      // 명령 시작 통지는 거부가 아니다(#20270) — 허락 후보는 «거부» 줄에만 붙는다.
      expect(responses).toEqual(requestKinds.map((requestKind, index) => ({
        requestId: `req-kind-${index}`,
        requestKind,
        wouldApprove: requestKind === 'rejected',
        evidenceWhy: requestKind === 'rejected' ? 'boundary-shell-syntax-with-bun' : 'not-a-rejection',
      })));
      expect(verdicts).toEqual(requestKinds.map((requestKind, index) => ({ requestId: `req-kind-${index}`, requestKind })));
      stop();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('문법 또는 스키마가 잘못된 완결 요청 줄은 그림자 판정 없이 모두 unparsed로 관측한다', () => {
    const invalidLines = [
      '{not-json}',
      'null',
      '[]',
      '"request"',
      JSON.stringify({ requestId: 'req-1', boundary: '/repo/worktree', cwd: '/repo/worktree/src' }),
    ];
    for (const line of invalidLines) {
      const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-approval-unparsed-')));
      const mailbox = join(tmp, 'requests.jsonl');
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const watcher = new EventEmitter() as EventEmitter & { close: () => void };
      watcher.close = () => {};
      const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
        if (category === 'harness.boundary' && data) events.push({ event, data });
      }) as never);
      try {
        const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
          watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
            watcher.on('change', listener);
            return watcher;
          }) as unknown as typeof import('node:fs').watch,
        });
        appendFileSync(mailbox, `${line}\n`);
        watcher.emit('change', 'requests.jsonl');
        expect(events.map(({ event }) => event)).toEqual(['request-received', 'approval-shadow-unparsed']);
        expect(events[1]?.data).toMatchObject({ ptyId: 'p', runId: 'r', request: line });
        expect(events.map(({ event }) => event)).not.toContain('request-watch-fail');
        stop();
      } finally {
        log.mockRestore();
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  });

  it('강제 short read에도 UTF-8 원문과 완결 줄을 한 번만 보존한다', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-watch-short-read-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const observed: Array<Record<string, unknown>> = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const line = '{"request":"한글 short read"}';
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'harness.boundary' && event === 'request-received' && data) observed.push(data);
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        pollMs: 1000,
        watchDirectory: ((_dir: string, listener: (...args: unknown[]) => void) => {
          watcher.on('change', listener);
          return watcher;
        }) as unknown as typeof import('node:fs').watch,
        read: ((fd, buffer, offset, length, position) => readSync(fd, buffer, offset, Math.min(length, 1), position)) as typeof readSync,
      });
      appendFileSync(mailbox, `${line}\n`);
      watcher.emit('change', 'requests.jsonl');
      expect(observed.map(({ request }) => request)).toEqual([line]);
      stop();
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('감시 오류 뒤에도 poll backstop이 UTF-8 문자 중간에서 나뉜 완결 줄을 한 번만 원문 그대로 기록하고 cleanup한다', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-watch-edge-')));
    const mailbox = join(tmp, 'requests.jsonl');
    const observed: Array<Record<string, unknown>> = [];
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    let closed = false;
    watcher.close = () => { closed = true; };
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'harness.boundary' && event === 'request-received' && data) observed.push(data);
    }) as never);
    try {
      const stop = watchHarnessBoundaryRequests(mailbox, { ptyId: 'p', runId: 'r' }, {
        pollMs: 5,
        watchDirectory: (() => watcher) as unknown as typeof import('node:fs').watch,
      });
      watcher.emit('error', new Error('watch unavailable'));
      const line = '{"request":"한글"}';
      const bytes = Buffer.from(`${line}\n`, 'utf8');
      const splitAt = bytes.indexOf(Buffer.from('한', 'utf8')) + 1;
      expect(splitAt).toBeGreaterThan(0);
      appendFileSync(mailbox, bytes.subarray(0, splitAt));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(observed).toHaveLength(0);
      appendFileSync(mailbox, bytes.subarray(splitAt));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(observed.map(({ request }) => request)).toEqual([line]);
      expect(closed).toBe(true);
      stop();
      expect(closed).toBe(true);
    } finally {
      log.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('spawn env 에 MONAD_HARNESS_SPACE 와 MONAD_HARNESS_BOUNDARY(=cwd) 를 함께 싣는다', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-spawn-')));
    let captured: Record<string, string> = {};
    const fakeSpawn = ((o: { env: Record<string, string> }) => {
      captured = o.env;
      return {
        id: 'pty-test-1',
        write: () => {},
        renderScreen: async () => 'GOAL-COMPLETE',
        renderScreenPng: async () => null,
        snapshot: () => 'GOAL-COMPLETE\n',
        drainDelta: () => '',
        isAlive: () => false, // 즉시 종료 → 폴 루프 1회로 반환
        exitCode: 0,
        kill: () => {},
      };
    }) as unknown as Parameters<typeof runHeadlessGoalLoopPty>[0]['spawn'];
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/x', cwd: tmp, featurePrompt: 'p', maxWaitSec: 1, pollMs: 1,
        spawn: fakeSpawn, ptyAvailable: () => true,
      });
      expect(captured[HARNESS_BOUNDARY_ENV]).toBe(tmp); // boundary = worktree(cwd)
      expect(captured[HARNESS_SPACE_ENV]).toBeTruthy(); // space 자기인지 마커도 함께(synthesize)
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});

// ── should-fix(리뷰 5R): 정책이 3개 harness kind 전부에 동일·안전하게 적용됨을 명시 검증 ──
describe('전 harness kind 커버리지 (self-implement·dev-harness·solve-mission)', () => {
  let tmp = ''; let wt = ''; let outside = '';
  beforeEach(() => {
    __resetSessionWorkingDir();
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-kind-')));
    wt = join(tmp, 'wt'); outside = join(tmp, 'outside');
    mkdirSync(wt); mkdirSync(outside);
  });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  for (const kind of ['self-implement', 'dev-harness', 'solve-mission']) {
    it(`${kind}: 명시 마커 경계 안 허용·밖(정본/외부) 거부 (동일 계약)`, () => {
      const env = { [HARNESS_SPACE_ENV]: kind, [HARNESS_SPACE_ID_ENV]: 'id', [HARNESS_BOUNDARY_ENV]: wt };
      expect(activateHarnessWriteBoundary(env, wt)).toBe(wt);
      __resetSessionWorkingDir(); // (c) 경로도 확인(boundary off)
      expect(harnessMainTreeReject(join(wt, 'x.ts'), env, wt)).toBeNull();       // 경계 안 = 허용
      expect(harnessMainTreeReject(join(outside, 'x.ts'), env, wt)).toContain('격리 경계 밖'); // 밖 = 거부
    });
  }

  it('비-하니스(운영/일반)는 kind 무관 전면 무회귀', () => {
    expect(activateHarnessWriteBoundary({}, wt)).toBeNull();
    expect(harnessMainTreeReject(join(outside, 'x.ts'), {}, wt)).toBeNull();
  });
});

describe('harnessBoundaryEnv (마커 절대경로 계약)', () => {
  it('상대경로도 resolve() 로 절대경로 정규화(fail-open 방지)', () => {
    const env = harnessBoundaryEnv('some/rel/path');
    expect(env[HARNESS_BOUNDARY_ENV]).toBe(resolve('some/rel/path'));
    expect(env[HARNESS_BOUNDARY_ENV]?.startsWith('/')).toBe(true);
  });
  it('빈 값 = 마커 미포함', () => {
    expect(harnessBoundaryEnv('')).toEqual({});
  });
});

describe('canonicalizeForBoundary', () => {
  it('존재-조상 realpath + 미존재 접미 유지', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-canon-')));
    try {
      const p = join(tmp, 'a', 'b', 'new.ts'); // a/b/new.ts 미존재
      expect(canonicalizeForBoundary(p)).toBe(p); // tmp 는 canonical → 그대로
      const link = join(tmp, 'lnk');
      symlinkSync(tmp, link);
      expect(canonicalizeForBoundary(join(link, 'x.ts'))).toBe(join(tmp, 'x.ts')); // 심링크 펼침
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('shell write boundary — FD redirects, pipes and cd', () => {
  let boundary = '';
  let outside = '';
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    boundary = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-shell-')));
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-shell-out-')));
    mkdirSync(join(boundary, 'sub'));
    env = harnessEnv({ [HARNESS_BOUNDARY_ENV]: boundary });
  });
  afterEach(() => {
    rmSync(boundary, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const reject = (command: string) => harnessCommandWriteReject(command, boundary, 'test', env);

  it('five read-only forms pass the real boundary entrypoint', () => {
    for (const command of [
      'rg foo src | head -5', 'bun test a.test.ts 2>&1',
      'bun test a.test.ts 2>&1 | tail -20', 'cd sub && rg x',
      'git log --oneline | wc -l',
    ]) expect(reject(command)).toBeNull();
  });

  it('semicolon-separated reads and trailing empty fragments pass the real boundary entrypoint', () => {
    for (const command of [
      'pwd; git status', 'git log -1; git diff --stat',
      'cat a.txt; wc -l a.txt;',
      'pwd;; git status;', 'echo "a;b"; git status',
      "echo 'a;b'; git status", 'pwd; rg x | wc -l',
    ]) expect(reject(command)).toBeNull();
  });

  it('cd in a semicolon list is fail-closed — a failed cd does not stop the next fragment', () => {
    expect(existsSync(join(boundary, 'sub'))).toBe(true);
    for (const command of [
      'cd sub; rg x',
      'rm -rf sub; cd sub; cd ..; git commit',
      'cd missing; cd ..; git commit',
      'cd missing && cd sub; cd ..; git commit',
      'false && cd sub; cd ..; git commit',
      'cd sub && cd ..; git commit',
    ]) {
      const verdict = inspectHarnessCommandWriteTargets(command, boundary);
      expect(verdict).toMatchObject({ known: false, reasonKind: 'shell-syntax', decidingToken: ';' });
      expect(reject(command)).not.toBeNull();
    }
    expect(reject('pwd; git status')).toBeNull();
    expect(reject('cat a.txt; wc -l a.txt;')).toBeNull();
  });

  it('a long semicolon chain of cd is judged at once without branching cwd states', () => {
    const command = Array.from({ length: 40 }, (_, i) => `cd d${i}`).join('; ');
    const t0 = performance.now();
    expect(inspectHarnessCommandWriteTargets(command, boundary)).toMatchObject({ known: false, decidingToken: ';' });
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('semicolon chains preserve targets and the unknown fragment decision', () => {
    expect(inspectHarnessCommandWriteTargets('echo x > output; git commit', boundary)).toEqual({
      targets: [join(boundary, 'output'), boundary], known: true,
    });
    const unknown = inspectHarnessCommandWriteTargets('pwd; rg x; $(echo sh)', boundary);
    expect(unknown).toMatchObject({ known: false, reasonKind: 'shell-syntax', decidingToken: '$' });
    expect(unknown).toEqual(inspectHarnessCommandWriteTargets('$(echo sh)', boundary));
  });

  it('semicolon chains reject outside writes and do not parse shell compound statements', () => {
    for (const command of [
      `pwd; touch ${join(outside, 'x')}`,
      'for f in a; do rm $f; done', 'rg x; $(echo sh)',
      `cd ${outside}; touch z`, `cd ${outside}; git commit`,
      `cd ${outside}; echo x > z`,
      'while true; do pwd; done', 'if true; then pwd; fi', 'case x in a) pwd;; esac',
      'pwd; for f in a; do pwd; done',
      'pwd; rg x &', 'pwd; rg `pwd`', 'pwd; (rg x)',
    ]) expect(reject(command)).not.toBeNull();
    expect(reject(`cd ${outside}; git commit`)).toContain('셸 합성 문법 토큰 ;');
    expect(reject(`cd ${outside}; echo x > z`)).toContain('셸 합성 문법 토큰 ;');
  });

  it('FD duplication and discard are not file writes, but remaining redirects still are', () => {
    for (const suffix of ['2>&1', '1>&2', '>&2', '2>/dev/null', '>/dev/null', '&>/dev/null']) {
      expect(reject(`rg foo ${suffix}`)).toBeNull();
    }
    expect(reject(`echo x 2>&1 > ${join(outside, 'y')}`)).toContain('격리 경계 밖');
    expect(reject(`echo x 2>&1 > ${join(boundary, 'y')}`)).toBeNull();
    expect(reject(`echo '2>&1' > ${join(outside, 'quoted')}`)).toContain('격리 경계 밖');
    expect(reject(`echo x 2>&1 | tee ${join(outside, 'piped')}`)).toContain('격리 경계 밖');
    expect(reject('rg x 2>&1; touch /outside/y')).not.toBeNull();
    expect(reject('rg foo >/dev/null')).toBeNull();
    expect(reject('rg foo 2>/dev/null')).toBeNull();
    expect(reject('rg foo &>/dev/null')).toBeNull();
    expect(reject('rg foo 2>&1|tail -20')).toBeNull();
    expect(reject('rg foo 2>&1&&wc -l')).toBeNull();
    expect(reject(`rg foo 2>&1|tee ${join(outside, 'pipe-no-space')}`)).toContain('격리 경계 밖');
  });

  it('pipe targets are combined and an unknown fragment retains its deciding token', () => {
    const dest = join(outside, 'x');
    expect(inspectHarnessCommandWriteTargets(`rg foo | tee ${dest}`, boundary)).toEqual({ targets: [dest], known: true });
    expect(reject(`rg foo | tee ${dest}`)).toContain('격리 경계 밖');
    expect(reject('cat a | sh')).not.toBeNull();
    expect(reject(`cd ${outside} && touch z`)).not.toBeNull();
    const unknown = inspectHarnessCommandWriteTargets('rg x | $(echo sh)', boundary);
    expect(unknown).toMatchObject({ known: false, reasonKind: 'shell-syntax', decidingToken: '$' });
    expect(reject('rg x | $(echo sh)')).not.toBeNull();
  });

  it('cd changes the cwd of later && fragments including relative paths, but not stand-alone writes', () => {
    expect(inspectHarnessCommandWriteTargets('cd sub && touch x', boundary)).toMatchObject({ known: false, reasonKind: 'unknown-command' });
    expect(inspectHarnessCommandWriteTargets('cd sub && git -C . commit', boundary)).toEqual({ targets: [join(boundary, 'sub')], known: true });
    expect(inspectHarnessCommandWriteTargets('cd sub && echo x > output', boundary)).toEqual({ targets: [join(boundary, 'sub', 'output')], known: true });
    expect(reject('cd sub && git -C . commit')).toBeNull();
    expect(reject(`cd ${outside} && git commit`)).toContain('격리 경계 밖');
    expect(reject(`cd ${outside} 2>&1 && git commit`)).toContain('격리 경계 밖');
    expect(reject('cd sub 2>&1 && git commit')).toBeNull();
    expect(reject(`cd sub && git -C . commit | tee ${join(outside, 'log')}`)).toContain('격리 경계 밖');
    expect(reject('cd sub')).toBeNull();
    expect(reject('cd sub; rg x')).not.toBeNull();
    expect(reject('cd')).toBeNull();
    expect(reject('cd - && git commit')).not.toBeNull();
    expect(reject('cd ../* && git commit')).not.toBeNull();
    expect(reject('cd sub && cd .. && git commit')).toBeNull();
    expect(reject('cd $(pwd) && rg x')).not.toBeNull();
  });

  it('unsupported shell forms stay fail-closed and quoted pipes are literals', () => {
    expect(reject('echo "a|b"')).toBeNull();
    expect(reject("echo 'a|b'")).toBeNull();
    expect(reject('rg x|wc -l')).toBeNull();
    expect(reject('rg x | wc -l | head')).toBeNull();
    for (const command of ['rg x || head', 'rg x |', 'rg x &', 'rg $(pwd)', 'rg `pwd`', 'rg <(pwd)', 'rg >(pwd)']) {
      expect(reject(command)).not.toBeNull();
    }
  });
});

describe('inspectHarnessCommandWriteTargets — unquoted && chain', () => {
  const cwd = '/repo/worktree';

  it('알려진 명령 둘을 && 로 이으면 대상이 두 조각의 합이다', () => {
    const left = inspectHarnessCommandWriteTargets('bun test src/a.test.ts', cwd);
    const right = inspectHarnessCommandWriteTargets('bun test src/b.test.ts', cwd);
    const chained = inspectHarnessCommandWriteTargets('bun test src/a.test.ts && bun test src/b.test.ts', cwd);
    expect(left.known).toBe(true);
    expect(right.known).toBe(true);
    expect(chained.known).toBe(true);
    if (!left.known || !right.known || !chained.known) return;
    expect(chained.targets).toEqual([...left.targets, ...right.targets]);
  });

  it('조각 하나가 모르는 명령이면 전체가 거부된다', () => {
    const chained = inspectHarnessCommandWriteTargets(
      'bun test src/a.test.ts && MODE=test bun test src/a.test.ts',
      cwd,
    );
    expect(chained.known).toBe(false);
  });

  it('인용 안의 && 는 갈라지지 않고 거부된다', () => {
    const quoted = inspectHarnessCommandWriteTargets('echo "a && b"', cwd);
    expect(quoted.known).toBe(false);
    if (quoted.known) return;
    expect(quoted.reasonKind).toBe('shell-syntax');
  });

  it("작은따옴표 안의 && 를 가진 알려진 명령은 갈라지지 않고 shell-syntax 로 거부된다", () => {
    const quoted = inspectHarnessCommandWriteTargets("bun test 'src/a&&b.test.ts'", cwd);
    expect(quoted.known).toBe(false);
    if (quoted.known) return;
    expect(quoted.reasonKind).toBe('shell-syntax');
  });

  it("작은따옴표 인수에 && 가 없으면 인용 없는 판정과 같다", () => {
    const quoted = inspectHarnessCommandWriteTargets("bun test 'src/ordinary.test.ts'", cwd);
    const unquoted = inspectHarnessCommandWriteTargets('bun test src/ordinary.test.ts', cwd);
    expect(quoted).toEqual(unquoted);
    expect(quoted.known).toBe(true);
  });

  it('&& 가 없는 명령의 판정은 착지 전과 같다', () => {
    const command = 'bun test src/harness/harness-write-boundary.test.ts';
    const fromString = inspectHarnessCommandWriteTargets(command, cwd);
    const fromArgv = inspectHarnessCommandWriteTargets(
      ['bun', 'test', 'src/harness/harness-write-boundary.test.ts'],
      cwd,
    );
    expect(fromString).toEqual(fromArgv);
    expect(fromString.known).toBe(true);
  });
});

describe('inspectHarnessCommandWriteTargets — quoted shell literals and inline runtime code', () => {
  const cwd = '/repo/worktree';

  it('큰따옴표 안의 괄호·세로막대·쌍반점은 리터럴 읽기 명령을 거부하지 않는다', () => {
    for (const command of ['echo "a(b)"', 'echo "a|b"', 'echo "a;b"']) {
      const parsed = inspectHarnessCommandWriteTargets(command, cwd);
      expect(parsed).toEqual({ targets: [], known: true });
    }
  });

  it('큰따옴표 안의 실제 확장과 인용 밖 합성 문법은 계속 shell-syntax 로 거부한다', () => {
    for (const command of ['echo "$HOME"', 'echo `id`', 'echo $(id)']) {
      const parsed = inspectHarnessCommandWriteTargets(command, cwd);
      expect(parsed.known).toBe(false);
      if (!parsed.known) expect(parsed.reasonKind).toBe('shell-syntax');
    }
  });

  it("작은따옴표 안의 괄호는 기존처럼 리터럴 읽기 명령을 통과시킨다", () => {
    expect(inspectHarnessCommandWriteTargets("echo 'a(b)'", cwd)).toEqual({ targets: [], known: true });
  });

  it('node 인라인 코드는 셸 문법보다 먼저 인라인 코드 사유로 거부한다', () => {
    const parsed = inspectHarnessCommandWriteTargets('node -e "for(const x of [1]) {}"', cwd);
    expect(parsed.known).toBe(false);
    if (parsed.known) return;
    expect(parsed.reason).toBe('런타임 해석기의 인라인 코드');
    expect(parsed.reason).not.toContain('셸 합성 문법 토큰');
  });
});

describe('harnessCommandWriteReject × 런타임 인터프리터 (자식이 자기 검증을 할 수 있나)', () => {
  // ⛔ 2026-08-02 실측 — `bun`·`node` 가 미결정으로 떨어져 자식이 `bun test`·`self typecheck` 를
  //    하나도 못 돌렸고 세 런이 연속 abandoned 됐다. 자식 진술: *"격리 셸의 쓰기-대상 판정이
  //    모든 Bash 호출을 실행 전 차단하고 있어"*. 판정 축은 `-c` 없는 셸과 같다(cwd).
  let boundary = '';
  let outside = '';
  let env: NodeJS.ProcessEnv = {};
  beforeEach(() => {
    boundary = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-runtime-')));
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'hwb-outside-')));
    env = {
      [HARNESS_SPACE_ENV]: 'self-build',
      [HARNESS_SPACE_ID_ENV]: 'probe',
      [HARNESS_BOUNDARY_ENV]: boundary,
    };
  });
  afterEach(() => {
    for (const d of [boundary, outside]) if (d) rmSync(d, { recursive: true, force: true });
  });
  const reject = (cmd: string | readonly string[], cwd?: string) =>
    harnessCommandWriteReject(cmd, cwd ?? boundary, 'test', env);

  it('경계 안에서 도는 검증 명령은 통과한다', () => {
    for (const cmd of [
      'bun test src/harness/harness-write-boundary.test.ts',
      'bun bin/monad.mjs self typecheck',
      'bun run test:deterministic',
      'bun test',
      'bun test --coverage',
      'node --version',
      'node -v',
      'bun --version',
      'node script.js',
    ]) {
      expect(reject(cmd)).toBeNull();
    }
  });

  // ⭐ 버전 예외는 **단독일 때만** 이다 — 뒤에 뭐가 붙으면 일반 규칙으로 돌아간다.
  it('버전 플래그 예외는 단독 인자일 때만 적용된다', () => {
    expect(reject(['node', '-v', '-e', 'x'])).not.toBeNull();
    expect(reject(['node', '--version', '--import', 'data:text/javascript,0'])).not.toBeNull();
  });

  it('경계 밖 cwd 에서 도는 인터프리터는 거부된다 (검증 명령 전종)', () => {
    for (const cmd of [
      'bun test x.test.ts',
      'bun bin/monad.mjs self typecheck',
      'bun run test:deterministic',
      'node script.js',
      'node --version',
    ]) {
      expect(reject(cmd, outside)).not.toBeNull();
    }
  });

  it('리다이렉트로 경계 밖에 쓰려 하면 거부된다', () => {
    expect(reject(`bun test > ${join(outside, 'EVIL')}`)).not.toBeNull();
  });

  // ⛔⭐⭐ **2026-08-07 · 대표 「금지는 길을 같이 준다」** — 문면이 넓어졌다. 이 검사들은 종전에
  //   «옛 문구를 문자 그대로» 단언했는데, 원칙은 *"토큰을 말한다 ⊕ 실행 가능한 형태를 준다"* 이지
  //   그 문장이 아니다. ⇒ **원칙을 물고, 새로 준 능력(허용 목록을 «이름으로»)을 같이 문다.**
  //   📏 근거: 이 거부가 7일 창에 1,818건인데 *"허용된 명령 하나만"* 이라 해 놓고 그 목록이
  //     자식에게 «보이지 않았다»(목록은 이 소스 안에만 있었다).
  it('검증 안내는 자식 작업 트리의 monad 엔트리 존재에만 의존하고 거부·경계·보편 예시는 보존한다', () => {
    const command = 'bun test src/harness/harness-write-boundary.test.ts & bun run check';
    const withoutEntrypoint = reject(command);
    expect(withoutEntrypoint).toContain('셸 합성 문법 토큰 &');
    expect(withoutEntrypoint).toContain(`격리 worktree(${boundary}) 내부다.`);
    expect(withoutEntrypoint).toContain('bun test <파일> · bun run <스크립트>');
    expect(withoutEntrypoint).not.toContain('bun bin/monad.mjs self typecheck');

    mkdirSync(join(boundary, 'bin'));
    writeFileSync(join(boundary, 'bin', 'monad.mjs'), '');
    const withEntrypoint = reject(command);
    expect(withEntrypoint).toContain('셸 합성 문법 토큰 &');
    expect(withEntrypoint).toContain(`격리 worktree(${boundary}) 내부다.`);
    expect(withEntrypoint).toContain('bun test <파일> · bun run <스크립트> · bun bin/monad.mjs self typecheck');
  });

  it('엔트리 확인 파일시스템 오류도 거부·보편 예시를 유지하고 monad 예시는 생략한다', () => {
    const exists = spyOn(fs, 'existsSync').mockImplementation(() => { throw new Error('entry check unavailable'); });
    try {
      const rejection = reject('bun test src/harness/harness-write-boundary.test.ts & bun run check');
      expect(rejection).toContain('셸 합성 문법 토큰 &');
      expect(rejection).toContain(`격리 worktree(${boundary}) 내부다.`);
      expect(rejection).toContain('bun test <파일> · bun run <스크립트>');
      expect(rejection).not.toContain('bun bin/monad.mjs self typecheck');
    } finally {
      exists.mockRestore();
    }
  });

  it('합성 문법과 인식하지 못한 첫 명령은 토큰 ⊕ 실행 가능한 형태 ⊕ «허용 목록»을 함께 안내한다', () => {
    const compound = reject('cd nested & bun test src/harness/harness-write-boundary.test.ts');
    const cdGuidance = '작업 디렉터리가 이미 격리 경계이므로 `cd <경로> &&` 앞머리를 빼고 그 뒤의 명령 하나만 그대로 실행하라.';
    expect(compound).toContain(`셸 합성 문법 토큰 &. ${cdGuidance}`); // cd 안내가 shell-syntax 안내의 맨 앞
    expect(compound).toContain('한 번에 한 명령');            // 합성이면 «쪼개는 법»
    expect(compound).toContain('A && B');                     // 고쳐 쓰는 예를 실제로 보인다
    expect(compound).toContain('허용된 읽기 명령 예:');        // ⭐ 목록을 «이름으로»
    expect(compound).toContain('bun test');                   // 검증 경로를 이름으로

    const nonCdCompound = reject('bun test src/harness/harness-write-boundary.test.ts || bun run check');
    expect(nonCdCompound).not.toContain(cdGuidance);
    expect(nonCdCompound).toContain('한 번에 한 명령');
    expect(nonCdCompound).toContain('A && B');
    expect(nonCdCompound).toContain('허용된 읽기 명령 예:');
    expect(nonCdCompound).toContain('bun test');

    const unknown = reject('MODE=test bun test src/harness/harness-write-boundary.test.ts');
    expect(unknown).toContain('인식하지 못한 명령 MODE=test');
    expect(unknown).toContain('허용된 명령 하나만 그대로 실행하라');
    expect(unknown).toContain('허용된 읽기 명령 예:');
    expect(unknown).toContain('git 조회 하위 명령도 허용:');   // ⭐ 미지 명령이면 git 갈래도 보인다
  });

  it('배열형 미인식 명령도 첫 토큰 ⊕ 형태 ⊕ 허용 목록을 함께 안내한다', () => {
    const unknown = reject(['MODE=test', 'bun', 'test', 'src/harness/harness-write-boundary.test.ts']);
    expect(unknown).toContain('인식하지 못한 명령 MODE=test');
    expect(unknown).toContain('허용된 명령 하나만 그대로 실행하라');
    expect(unknown).toContain('허용된 읽기 명령 예:');
  });

  // ⛔⭐⭐ 배열 «원소 하나»에 셸 한 줄이 통째로 들어오는 경우 — `via: 'pty-start'` 가 그 모양이다.
  //   📏 2026-08-07 라이브 실측(2층 자식 우편함): commandFirstToken 에 "git status | head -5" 전체가 실렸다.
  //   ⇒ 이름이 「첫 토큰」인데 값이 «명령 전체»였고, 그 값을 허용 목록과 대조하는 판정에서 거짓 음성이 난다.
  it('배열 원소 하나에 셸 한 줄이 들어와도 첫 토큰만 남긴다 (pty-start 모양)', () => {
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      reject(['git status | head -5']);
      const record = log.mock.calls.find(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject')?.[2] as Record<string, unknown>;
      expect(record.commandFirstToken).toBe('git');
      // 길이는 «명령 전체» 기준 그대로다 — 토큰만 좁힌다.
      expect(record.commandChars).toBe('git status | head -5'.length);
      // `git status`만 coarse action으로 보이며, 파이프와 뒤 인자는 여전히 남지 않는다.
      const commandTelemetry = Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith('command')));
      expect(commandTelemetry.commandAction).toBe('git status');
      for (const arg of ['|', 'head', '-5']) {
        expect(JSON.stringify(commandTelemetry)).not.toContain(arg);
      }
    } finally {
      log.mockRestore();
    }
  });

  // ⚠️ 대조군은 «실제로 거부되는» 명령이어야 한다 — `git status --porcelain` 은 허용된 조회라
  //   거부 자체가 안 나서 기록이 없다(초판이 그것으로 실패했다). 라이브에서 실제로 막힌 `bunx` 를 쓴다.
  it('진짜 토큰 배열은 종전과 동일하다 (회귀 0)', () => {
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      reject(['bunx', 'some-package']);
      const record = log.mock.calls.find(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject')?.[2] as Record<string, unknown>;
      expect(record.commandFirstToken).toBe('bunx');
    } finally {
      log.mockRestore();
    }
  });

  it('미결정 명령 관측은 기존 사유·거부문을 보존하고 토큰·길이·짧은 해시만 추가하며 인자를 남기지 않는다', () => {
    const cases: Array<[string | readonly string[], string, number, string]> = [
      ['MODE=secret-value bun hidden-argument', 'MODE', 'MODE=secret-value bun hidden-argument'.length, '인식하지 못한 명령 MODE=secret-value'],
      [['MODE=secret-value', 'bun', 'hidden-argument'], 'MODE', 'MODE=secret-value\0bun\0hidden-argument'.length, '인식하지 못한 명령 MODE=secret-value'],
    ];
    for (const [command, firstToken, chars, detail] of cases) {
      const log = spyOn(debug, 'log').mockImplementation(() => {});
      try {
        const parsed = inspectHarnessCommandWriteTargets(command, boundary);
        expect(parsed.known).toBe(false);
        if (parsed.known) throw new Error('test command must remain indeterminate');
        const expected = formatUnknownCommandWriteReject(boundary, parsed);
        const rejection = reject(command);
        const record = log.mock.calls.find(([category, event]) => category === 'harness.boundary' && event === 'main-tree-reject')?.[2] as Record<string, unknown>;
        expect(rejection).toBe(expected);
        expect(record).toMatchObject({ detail, commandFirstToken: firstToken, commandChars: chars });
        expect(record.commandHash).toMatch(/^[a-f0-9]{16}$/);
        const commandTelemetry = Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith('command')));
        expect(JSON.stringify(commandTelemetry)).not.toContain('secret-value');
        expect(JSON.stringify(commandTelemetry)).not.toContain('hidden-argument');
        expect(Object.keys(commandTelemetry)).toEqual(['commandFirstToken', 'commandAction', 'commandChars', 'commandHash']);
        expect(record.observedRawShellMetacharacters).toBe('');
        expect(record).not.toHaveProperty('command');
        expect(commandTelemetry.commandAction).toBe('MODE');
      } finally {
        log.mockRestore();
      }
    }
  });

  it('관측 실패도 기존 미결정 거부문을 바꾸지 않는다', () => {
    const command = 'MODE=secret-value bun hidden-argument';
    const expected = reject(command);
    const log = spyOn(debug, 'log').mockImplementation(() => { throw new Error('log unavailable'); });
    try {
      expect(reject(command)).toBe(expected);
    } finally {
      log.mockRestore();
    }
  });

  // ⭐ 이 검사의 계약은 ***형태를 «reasonKind» 가 정한다(표시 문구가 아니라)*** 이다 — 그대로 유지한다.
  //   ⚠️ 다만 두 종류가 이제 «서로 다른 길»을 준다(합성은 쪼개는 법 · 미지 명령은 허용 목록) ⇒ 각각 문다.
  it('형태 처방은 실제 분류의 닫힌 사유 종류를 따르고 표시 문구 접두사와 무관하다', () => {
    const cases: Array<[string, 'shell-syntax' | 'unknown-command', string]> = [
      ['cd nested || bun test src/harness/harness-write-boundary.test.ts', 'shell-syntax', '한 번에 한 명령'],
      ['MODE=test bun test src/harness/harness-write-boundary.test.ts', 'unknown-command', '허용된 명령 하나만 그대로 실행하라'],
    ];
    for (const [command, reasonKind, form] of cases) {
      const classified = inspectHarnessCommandWriteTargets(command, boundary);
      expect(classified.known).toBeFalse();
      if (classified.known) continue;
      expect(classified.reasonKind).toBe(reasonKind);
      const rejection = formatUnknownCommandWriteReject(boundary, {
        ...classified,
        reason: '표시용 문구를 전혀 다른 낱말로 바꾼 사유',
      });
      expect(rejection).toContain('표시용 문구를 전혀 다른 낱말로 바꾼 사유');
      expect(rejection).toContain(form);                    // ⭐ 종류가 형태를 정한다
      expect(rejection).toContain('허용된 읽기 명령 예:');   // 두 종류 다 «길»은 준다
    }
  });

  it('런타임 첫 플래그는 토큰을 말하지만 기존 fail-closed 처방을 유지한다', () => {
    const runtimeFlag = reject(['node', '--eval', 'process.exit(0)']);
    expect(runtimeFlag).toContain('런타임 해석기의 첫 인자 --eval');
    expect(runtimeFlag).toContain(`격리 worktree(${boundary}) 내부의 판정 가능한 경로만 쓰라.`);
  });

  it('인라인 코드 거부는 «파일로 써서 bun 으로 실행»하는 길을 주고, 그 길은 실제로 판정을 통과한다', () => {
    const inline = reject('bun -e "console.log(1)"');
    expect(inline).toContain('런타임 해석기의 인라인 코드');
    expect(inline).toContain('.monad-test/scratch/<이름>.ts');
    expect(inline).toContain('bun <그 파일>');
    // 안내한 길이 정말 열려 있는지 — 같은 판정기로 누른다.
    const followed = inspectHarnessCommandWriteTargets(`bun ${join(boundary, '.monad-test', 'scratch', 'probe.ts')}`, boundary);
    expect(followed.known).toBe(true);
  });

  it('합성 거부 안내는 읽기 파이프가 허용된다고 말하고 막힌 조각의 종류를 댄다', () => {
    const compound = reject('rg x | $(echo sh)');
    expect(compound).toContain('읽기 명령끼리의 `A | B`');
    expect(compound).not.toContain('`A | B` → `A` 만 실행');
  });

  it('미결정 모든 분기는 원인 토큰을 보존해 fail-closed 거부한다', () => {
    const cases: Array<[string | readonly string[], string]> = [
      [['git', 'unrecognised-subcommand'], '인식하지 못한 git 하위 명령 unrecognised-subcommand'],
      [['env'], '명령 접두 실행기 env 뒤에 실행할 명령 토큰이 없음'],
      [['diff', '--output'], '출력 경로 플래그의 경로 인자가 없음 (diff)'],
      [['find', '.', '-exec', 'echo', '{}'], 'find 실행 옵션 -exec'],
      ['dd if=input', 'dd 출력 토큰 of=가 없음'],
      ['sed -i', 'sed -i 파일 토큰이 없음'],
      ['tee --', 'tee 출력 파일 토큰이 없음'],
    ];
    for (const [command, reason] of cases) {
      expect(reject(command)).toContain(reason);
    }
  });

  it('알려진 외부 출력은 미결정 사유보다 먼저 기존 경로 거부를 낸다', () => {
    const pathReject = reject(['find', '.', '-fprint', join(outside, 'EVIL'), '-exec', 'echo', '{}']);
    expect(pathReject).toContain('격리 경계 밖');
    expect(pathReject).not.toContain('find 실행 옵션 -exec');
  });

  it('단순 리다이렉션은 미결정 명령부여도 외부 대상을 보존해 경로 우선으로 거부한다', () => {
    // 2026-08-05 09:0x KST 저작자가 harnessCommandWriteReject 표본 일곱을 직접 측정한 조건을 보존한다.
    for (const command of [
      `cd nested && bun test > ${join(outside, 'EVIL')}`,
      `MODE=test bun test > ${join(outside, 'mode-output')}`,
      `dd if=input > ${join(outside, 'dd-output')}`,
      `sed -i > ${join(outside, 'sed-output')}`,
      `tee -- > ${join(outside, 'tee-output')}`,
    ]) {
      const pathReject = reject(command);
      expect(pathReject).toContain('격리 경계 밖');
      expect(pathReject).not.toContain('쓰기 판정 거부');
    }
  });

  it('cd 사슬의 리다이렉션은 내부면 허용하고 외부면 경로로 거부한다', () => {
    expect(reject(`cd nested && bun test > ${join(boundary, 'output')}`)).toBeNull();
    expect(reject(`cd nested && bun test > ${join(outside, 'output')}`)).toContain('격리 경계 밖');
  });

  it('dd·sed·tee의 외부 출력 대상은 기존처럼 경로 우선으로 거부된다', () => {
    for (const command of [
      ['dd', 'if=input', `of=${join(outside, 'dd-output')}`],
      ['sed', '-i', 's/x/y/', join(outside, 'sed-output')],
      ['tee', join(outside, 'tee-output')],
    ]) {
      expect(reject(command)).toContain('격리 경계 밖');
    }
  });

  it('셸 인터프리터 우회는 여전히 거부된다 (READ_ONLY 로 넣지 않았다는 증거)', () => {
    expect(reject(`sh -c 'touch ${join(outside, 'EVIL')}'`)).not.toBeNull();
  });

  // ⛔⭐⭐⭐ 무인 리뷰 1R~7R 이 같은 자리를 여섯 번 뚫었다. 하나의 규칙으로 전부 닫는다:
  //    런타임 자신의 플래그 구간은 통째로 미결정이다(`--version` 단독만 예외).
  it('런타임 플래그 구간은 통째로 거부된다 — eval·모듈지정자·cwd 변경·미상 전부', () => {
    const evil = join(outside, 'EVIL');
    for (const argv of [
      ['node', '-e', `require('fs').writeFileSync('${evil}','x')`],           // 1R
      ['node', '--eval', `require('fs').writeFileSync('${evil}','x')`],
      ['node', `--eval=require('fs').writeFileSync('${evil}','x')`],           // 2R (= 형)
      ['node', `-erequire('fs').writeFileSync('${evil}','x')`],                // 2R (결합형)
      ['node', `-prequire('fs').writeFileSync('${evil}','x')`],
      ['bun', `--eval=require('fs').writeFileSync('${evil}','x')`],
      ['node', '-r', 'fs', '-e', `require('fs').writeFileSync('${evil}','x')`], // 4R (값 소비)
      ['node', '-c', '-e', `require('fs').writeFileSync('${evil}','x')`],       // 5R (런타임별 뜻)
      ['node', '--import', `data:text/javascript,0`],                           // 6R (값이 코드)
      ['node', `--import=data:text/javascript,0`],                              // 7R (= 형)
      ['bun', `--cwd=${outside}`, 'run', 'x'],                                  // 7R (cwd 변경)
      ['node', '--totally-unknown-flag', 'x.js'],                               // 미상
      ['node', '--', '-efoo'],                                                  // 첫 토큰이 플래그
    ]) {
      expect(reject(argv)).not.toBeNull();
    }
  });

  // ⭐ 스크립트/서브커맨드 뒤의 인자는 런타임 플래그가 아니다 — 오탐하지 않는다.
  it('서브커맨드·스크립트 뒤의 플래그 모양 인자는 오탐하지 않는다', () => {
    expect(reject(['node', 'script.js', '-efoo'])).toBeNull();
    expect(reject(['bun', 'test', '--', '-e'])).toBeNull();
    expect(reject(['bun', 'test', 'eval'])).toBeNull();
    expect(reject(['node', 'eval.js'])).toBeNull();
  });

  // ⛔⭐⭐ 2R·6R must-fix — cwd 는 경계 안인데 **인자가 밖을 가리키는** 형태.
  it('피연산자가 경계 밖이면 절대·상대 모두 거부된다', () => {
    expect(reject(['bun', 'test', join(outside, 'x.test.ts')])).not.toBeNull();
    expect(reject(['node', join(outside, 'script.js')])).not.toBeNull();
    expect(reject(['node', relative(boundary, join(outside, 'evil.js'))])).not.toBeNull();
    expect(reject(['bun', 'test', relative(boundary, join(outside, 'x.test.ts'))])).not.toBeNull();
  });

  it('피연산자가 경계 안이면 통과한다', () => {
    expect(reject(['bun', 'test', join(boundary, 'x.test.ts')])).toBeNull();
  });
});

// ⭐ 2026-09-02 · 🅣 136차 — 거부 문면이 «안 보이는 토큰»을 이름으로 내야 한다.
//   🩸 계기: 자식이 개행이 든 `python3 -c` 를 쳤고, 문면이 「토큰 ⏎」이 되어 화면에서 줄이 갈렸다.
//     자식은 무엇이 막혔는지 못 보고 ***같은 형태로 4번 다시 쳤다***.
//   ⛔ 이 시험이 못 보는 것: 「그 토큰을 «막는 판정»이 옳은가」는 안 잰다 — 「무엇이 막혔는지 «말하는가»」만 잰다.
describe('renderShellSyntaxToken — 「막는다」와 「무엇이 막혔는지 말한다」는 다른 값', () => {
  it('★ 양성 — 안 보이는 토큰은 «이름»으로 낸다(문면에 날 제어문자를 안 남긴다)', () => {
    const rendered = renderShellSyntaxToken('\n');
    expect(rendered).toContain('개행');
    expect(rendered).not.toContain('\n');
    expect(renderShellSyntaxToken('\t')).toContain('탭');
  });

  it('★ 음성 — 보이는 토큰은 «그대로» 낸다(소음을 더하지 않는다)', () => {
    for (const token of ['|', ';', '&', '(', ')', '$', '`', '~', '<', '>']) {
      expect(renderShellSyntaxToken(token)).toBe(token);
    }
  });
});
