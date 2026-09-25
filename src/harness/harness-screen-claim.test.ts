// B3 — 화면 «소유» 클레임 계약.
//
// 🚨 무엇을 막는가: 공간 id 하나 = 파일 하나. 두 자가 같은 키로 쓰면 프레임이 «섞이고»
//   그 결과는 ***「틀린 화면을 «자신 있게» 보여 주는」*** 형태다 — 가장 나쁜 부류다.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimHarnessScreen, releaseHarnessScreen, readHarnessScreenClaim, harnessScreenPath,
} from './harness-screen.js';

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'screen-claim-'));
  env = { ...process.env, MONAD_STATE_DIR: dir };
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

const claimPath = (id: string) => harnessScreenPath(id, env).replace(/\.screen$/, '.claim');

describe('claimHarnessScreen — 소유를 «값»으로', () => {
  test('빈 화면은 그냥 쥔다', () => {
    expect(claimHarnessScreen('sp', { env, pid: 1111, owner: 'run-a' })).toEqual({ kind: 'claimed' });
    expect(existsSync(claimPath('sp'))).toBe(true);
    expect(readHarnessScreenClaim('sp', env)).toMatchObject({ pid: 1111, owner: 'run-a' });
  });

  test('⚠️ 자기 자신이 다시 쥐는 것은 «충돌이 아니다» — 재진입·재시도에서 정상이다', () => {
    claimHarnessScreen('sp', { env, pid: 2222 });
    expect(claimHarnessScreen('sp', { env, pid: 2222 })).toEqual({ kind: 'claimed' });
  });

  test('⭐⭐ 살아 있는 «남»이 쥐고 있으면 충돌을 «낸다» — 그리고 누가 쥐었는지 말한다', () => {
    claimHarnessScreen('sp', { env, pid: process.pid, owner: 'run-first' });
    const r = claimHarnessScreen('sp', { env, pid: process.pid + 1, owner: 'run-second' });
    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') {
      expect(r.heldBy.pid).toBe(process.pid);
      expect(r.heldBy.owner).toBe('run-first');
    }
  });

  test('⭐ 죽은 프로세스의 클레임은 «넘겨받는다» — 정당한 재개를 막지 않는다', () => {
    // 존재할 수 없는 큰 pid 로 클레임을 심는다.
    claimHarnessScreen('sp', { env, pid: 4194303, owner: 'ghost' });
    const r = claimHarnessScreen('sp', { env, pid: process.pid, owner: 'run-new' });
    expect(r.kind).toBe('took-over-stale');
    if (r.kind === 'took-over-stale') expect(r.previous.owner).toBe('ghost');
  });

  test('⛔ 충돌이어도 «막지 않는다» — 클레임 파일은 갱신되고 실행은 계속된다', () => {
    claimHarnessScreen('sp', { env, pid: process.pid, owner: 'first' });
    claimHarnessScreen('sp', { env, pid: process.pid + 1, owner: 'second' });
    expect(readHarnessScreenClaim('sp', env)?.owner).toBe('second');
  });
});

describe('releaseHarnessScreen — 내 것만 놓는다', () => {
  test('내 클레임은 놓인다', () => {
    claimHarnessScreen('sp', { env, pid: 3333 });
    expect(releaseHarnessScreen('sp', { env, pid: 3333 })).toBe(true);
    expect(existsSync(claimPath('sp'))).toBe(false);
  });

  test('⛔⭐ «남의 것»은 안 지운다 — 지우면 그 자가 조용히 충돌 상태가 된다', () => {
    claimHarnessScreen('sp', { env, pid: 3333, owner: 'other' });
    expect(releaseHarnessScreen('sp', { env, pid: 4444 })).toBe(false);
    expect(readHarnessScreenClaim('sp', env)?.owner).toBe('other');
  });

  test('없는 클레임을 놓는 것은 false — 실패가 아니라 «없음»이다', () => {
    expect(releaseHarnessScreen('sp', { env, pid: 5555 })).toBe(false);
  });
});

describe('readHarnessScreenClaim — 못 읽으면 null', () => {
  test('파일이 없으면 null', () => expect(readHarnessScreenClaim('nope', env)).toBeNull());
});
