// turn 조립기 통일 Phase 4b PR3 — Grep 서피스 트러스트 정책(strict) 검증.
//
// Read/Edit/Write 를 strict 로 막아도 Grep(content mode)이 자격증명 파일 내용을 덤프하면 deny-list
// 우회가 된다. 이 테스트는 strict Grep 이 (1) 비-hidden 자격증명 파일(*.pem 등)을 rg exclude glob 으로
// 결과에서 배제하고 (2) cwd-탈출 검색 루트를 차단하며 (3) permissive(기본)는 현행대로 검색함을 확인.
// (참고: rg 기본은 hidden dotfile[.env/.ssh]을 애초에 미검색 → 실제 우회 벡터는 비-hidden 키/인증서.)

import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchGrep } from './grep.js';
import { setSessionCwd, getSessionCwd } from '../../session/working-dir.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'grep-pol-')));
writeFileSync(join(root, 'ok.txt'), 'FINDME here\n');
writeFileSync(join(root, 'secret.pem'), 'FINDME private key\n'); // 비-hidden 자격증명(rg 기본 검색 대상)

const prev = getSessionCwd();
setSessionCwd(root, 'tool');
afterAll(() => { try { setSessionCwd(prev, 'tool'); } catch { /* noop */ } rmSync(root, { recursive: true, force: true }); });

const rg = (() => { try { return spawnSync('rg', ['--version']).status === 0; } catch { return false; } })();
const maybe = rg ? test : test.skip;

describe('Phase 4b PR3 — Grep strict 정책', () => {
  maybe('permissive(기본): *.pem 도 매칭됨(현행 무변경)', async () => {
    const r = await dispatchGrep({ pattern: 'FINDME', output_mode: 'content' });
    expect(r.output).toContain('ok.txt');
    expect(r.output).toContain('secret.pem');
  });

  maybe('strict: *.pem(자격증명) 은 결과에서 배제, 일반 파일만', async () => {
    const r = await dispatchGrep({ pattern: 'FINDME', output_mode: 'content' }, { pathPolicy: 'strict' });
    expect(r.output).toContain('ok.txt');
    expect(r.output).not.toContain('secret.pem');
  });

  test('strict: cwd-탈출 검색 루트 차단', async () => {
    await expect(
      dispatchGrep({ pattern: 'x', path: '../../etc' }, { pathPolicy: 'strict' }),
    ).rejects.toThrow(/escapes cwd/);
  });

  test('strict: 자격증명 파일을 검색 루트로 직접 지정 시 차단(deny-list)', async () => {
    await expect(
      dispatchGrep({ pattern: 'x', path: 'secret.pem' }, { pathPolicy: 'strict' }),
    ).rejects.toThrow(/deny-list/);
  });
});
