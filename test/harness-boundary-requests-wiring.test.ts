import { describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { runHeadlessGoalLoopPty } from '../src/self-implement/headless-elanous-driver.js';
import { defaultSeams } from '../src/self-implement/seams.js';
import {
  HARNESS_BOUNDARY_REQUESTS_ENV,
  harnessBoundaryRequestsEnv,
} from '../src/harness/harness-space.js';

function fakePtySpawn(captured: { env?: NodeJS.ProcessEnv }) {
  const handle = {
    id: 'self_test', cmd: 'bun', workdir: '/tmp', startedAt: 0, lastActivityAt: 0, detach: false,
    exitCode: null as number | null,
    isAlive: () => handle.exitCode === null,
    appendOutput() {},
    drainDelta() { handle.exitCode = 0; return ''; },
    snapshot: () => '',
    write() {}, kill() {}, resize() {},
    renderScreen: async () => '', renderScreenPng: async () => null,
  };
  return ((options: { env?: NodeJS.ProcessEnv }) => {
    captured.env = options.env;
    return handle;
  }) as never;
}

function expectMailboxRecordsRequest(env: NodeJS.ProcessEnv | undefined): void {
  const path = env?.[HARNESS_BOUNDARY_REQUESTS_ENV];
  expect(path).toBeString();
  expect(existsSync(join(path!, '..'))).toBe(true);
  appendFileSync(path!, '{"request":"boundary"}\n', 'utf8');
  expect(readFileSync(path!, 'utf8')).toBe('{"request":"boundary"}\n');
  rmSync(path!, { force: true });
}

describe('harness boundary request mailbox wiring', () => {
  test('execution id별 부모 소유 임시 mailbox 디렉터리와 자식 env 경로를 만든다', () => {
    const executionId = `self_abc123_${Date.now()}`;
    const parent = resolve(tmpdir(), 'elanous-harness-boundary-requests');
    const env = harnessBoundaryRequestsEnv(executionId);
    const path = env[HARNESS_BOUNDARY_REQUESTS_ENV]!;
    expect(path).toBe(resolve(parent, `${createHash('sha256').update(executionId).digest('hex')}.jsonl`));
    expect(existsSync(dirname(path))).toBe(true);
    appendFileSync(path, '{"request":"boundary"}\n', 'utf8');
    expect(readFileSync(path, 'utf8')).toBe('{"request":"boundary"}\n');
    rmSync(path, { force: true });
  });

  test('서로 다른 실행 mailbox 파일을 개별 정리해도 다른 실행 파일은 보존한다', () => {
    const first = harnessBoundaryRequestsEnv(`first_${Date.now()}`)[HARNESS_BOUNDARY_REQUESTS_ENV]!;
    const second = harnessBoundaryRequestsEnv(`second_${Date.now()}`)[HARNESS_BOUNDARY_REQUESTS_ENV]!;
    appendFileSync(first, 'first\n', 'utf8');
    appendFileSync(second, 'second\n', 'utf8');
    rmSync(first, { force: true });
    expect(existsSync(second)).toBe(true);
    expect(readFileSync(second, 'utf8')).toBe('second\n');
    rmSync(second, { force: true });
  });

  test('경로 구분자와 traversal이 든 execution id도 mailbox 루트 내부의 안전한 파일명이 된다', () => {
    const parent = resolve(tmpdir(), 'elanous-harness-boundary-requests');
    for (const executionId of ['../outside', '/absolute/path', '\\windows\\path', 'nested/../id']) {
      const path = harnessBoundaryRequestsEnv(executionId)[HARNESS_BOUNDARY_REQUESTS_ENV]!;
      expect(path).toBe(resolve(parent, `${createHash('sha256').update(executionId).digest('hex')}.jsonl`));
      const pathFromParent = relative(parent, path);
      expect(pathFromParent).not.toStartWith('..');
      appendFileSync(path, 'safe\n', 'utf8');
      expect(readFileSync(path, 'utf8')).toBe('safe\n');
      rmSync(path, { force: true });
    }
  });

  test('execution id가 없으면 fail-open으로 mailbox env를 싣지 않는다', () => {
    expect(harnessBoundaryRequestsEnv('')).toEqual({});
    expect(harnessBoundaryRequestsEnv('   ')).toEqual({});
  });

  test('PTY 자식 spawn 최종 env가 쓰기 가능한 mailbox 경로를 전달한다', async () => {
    const captured: { env?: NodeJS.ProcessEnv } = {};
    await runHeadlessGoalLoopPty({
      binRoot: '/tmp', cwd: process.cwd(), featurePrompt: 'x', pollMs: 1, maxWaitSec: 1,
      spawn: fakePtySpawn(captured), ptyAvailable: () => true,
    });
    expectMailboxRecordsRequest(captured.env);
  });

  test('spawnSync fallback 자식 spawn 최종 env가 쓰기 가능한 mailbox 경로를 전달한다', async () => {
    let captured: NodeJS.ProcessEnv | undefined;
    const seams = defaultSeams({
      ptyAvailable: () => false,
      spawnSync: ((_cmd: string, _args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
        captured = options?.env;
        return { status: 0, stdout: 'GOAL-COMPLETE\n', stderr: '', signal: null };
      }) as never,
    });
    await seams.implement!({ cwd: process.cwd(), feature: 'x', runId: 'run-boundary-mailbox' });
    expectMailboxRecordsRequest(captured);
  });
});
