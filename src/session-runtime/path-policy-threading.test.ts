// turn 조립기 통일 Phase 4b(PR2) — 경로 보안 정책 스레딩 end-to-end 검증.
//
// 대표 결정: telegram/discord=strict. 이 테스트는 dispatchSessionRuntimeTool(deps.pathPolicy)이 native
// Read/Write dispatch 까지 정책을 실제로 스레딩하는지 확인 — strict 면 credential deny-list·cwd-탈출
// 차단, 미지정(permissive)이면 현행대로 통과. + makeMonadAgentRunTurn(telegram/discord)이 strict 를
// 주입하는 배선 가드.

import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchSessionRuntimeTool, type SessionRuntimeDispatchDeps } from './index.js';
import { setSessionCwd, getSessionCwd } from '../session/working-dir.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pp-thread-')));
writeFileSync(join(root, 'ok.txt'), 'visible\n');
writeFileSync(join(root, '.env'), 'SECRET=1\n');

const baseDeps: SessionRuntimeDispatchDeps = {
  getToolRuntime: () => undefined,
  dispatchToolRuntime: async () => ({ error: 'n/a' }),
  dispatchPluginTool: async () => ({ ok: false as const, error: 'n/a' }),
};

const prev = getSessionCwd();
setSessionCwd(root, 'tool');
afterAll(() => { try { setSessionCwd(prev, 'tool'); } catch { /* noop */ } rmSync(root, { recursive: true, force: true }); });

/** dispatchSessionRuntimeTool 은 에러를 throw 하거나 {error} 로 감쌀 수 있어 문자열로 정규화. */
async function runRead(file: string, pathPolicy?: 'strict' | 'permissive'): Promise<string> {
  try {
    const r = await dispatchSessionRuntimeTool('Read', { file_path: file }, { ...baseDeps, ...(pathPolicy ? { pathPolicy } : {}) });
    return typeof r === 'string' ? r : JSON.stringify(r);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe('Phase 4b PR2 — session-runtime 정책 스레딩', () => {
  test('strict: cwd 내 .env 는 credential deny-list 로 차단', async () => {
    const out = await runRead('.env', 'strict');
    expect(out).toMatch(/deny-list/);
  });
  test('strict: cwd-탈출 경로 차단', async () => {
    const out = await runRead('../../etc/hosts', 'strict');
    expect(out).toMatch(/escapes cwd/);
  });
  test('strict: cwd 내 일반 파일은 정상 열람', async () => {
    const out = await runRead('ok.txt', 'strict');
    expect(out).toContain('visible');
  });
  test('미지정(permissive·기본): .env 도 열람됨(현행 무변경)', async () => {
    const out = await runRead('.env');
    expect(out).toContain('SECRET');
  });
});

describe('Phase 4b PR2 — 배선 가드', () => {
  test('makeMonadAgentRunTurn(telegram/discord)이 strict 정책 주입', () => {
    const src = readFileSync(join(import.meta.dir, '../agent/monad-agent-turn.ts'), 'utf-8');
    expect(src).toContain("buildContinuationAgentTools({ pathPolicy: 'strict' })");
  });
  test('continuation 자율 스케줄러는 정책 미주입(permissive 유지)', () => {
    const src = readFileSync(join(import.meta.dir, '../dispatch/continuation-turn-runner.ts'), 'utf-8');
    // makeContinuationRunTurn 은 인자 없이 호출.
    expect(src).toContain('buildContinuationAgentTools();');
  });
});
