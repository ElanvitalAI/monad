// turn 조립기 통일 Phase 4b(PR1) — 파일 경로 보안 정책 단일 출처 검증.
//
// 대표 결정: 보안 path-policy 만 통합 + telegram/discord=strict. 이 테스트는 (1) resolvePathWithPolicy
// 3정책의 정확한 경계, (2) resolveSafe/anchoredResolve behavior 보존(deny-list 로직 무변경), (3) native
// Read/Edit/Write 가 pathPolicy 를 실제로 이행(strict 시 credential deny-list·cwd-탈출 차단, permissive
// 기본=현행 무변경)을 못박는다. PR1 은 메커니즘만 — 서피스(telegram/discord) 배선은 PR2.

import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { resolvePathWithPolicy } from './path-policy.js';
import { resolveSafe, anchoredResolve } from '../boot/daemon-tools/path-guard.js';
import { setSessionCwd, getSessionCwd } from '../session/working-dir.js';
import { dispatchRead } from '../skills/tools/read.js';
import { dispatchWrite } from '../skills/tools/write.js';
import { dispatchEdit } from '../skills/tools/edit.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'path-policy-'))); // macOS /var→/private/var 정규화
writeFileSync(join(root, 'ok.txt'), 'hello\nworld\n');
writeFileSync(join(root, '.env'), 'SECRET=xyz\n'); // deny-list 대상
mkdirSync(join(root, 'sub'), { recursive: true });
writeFileSync(join(root, 'sub', 'nested.txt'), 'deep\n');

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolvePathWithPolicy — 3정책 경계', () => {
  test('permissive: cwd-탈출 허용(제한 없음)', () => {
    // '../x' 는 cwd 밖으로 나가지만 permissive 는 해석만·throw 없음.
    expect(() => resolvePathWithPolicy('../x', root, 'permissive')).not.toThrow();
  });
  test('permissive: ~ 확장', () => {
    expect(resolvePathWithPolicy('~/foo', root, 'permissive')).toBe(join(homedir(), 'foo'));
  });
  test('anchored: cwd-탈출 차단, cwd 내 .env 는 허용(deny-list 없음)', () => {
    expect(() => resolvePathWithPolicy('../escape', root, 'anchored')).toThrow(/escapes cwd/);
    expect(() => resolvePathWithPolicy('.env', root, 'anchored')).not.toThrow();
  });
  test('strict: cwd-탈출 + credential deny-list 둘 다 차단', () => {
    expect(() => resolvePathWithPolicy('../escape', root, 'strict')).toThrow(/escapes cwd/);
    expect(() => resolvePathWithPolicy('.env', root, 'strict')).toThrow(/deny-list/);
    // cwd 내 일반 파일은 strict 도 허용.
    expect(() => resolvePathWithPolicy('ok.txt', root, 'strict')).not.toThrow();
  });
});

describe('path-guard — resolveSafe/anchoredResolve behavior 보존(Phase 4b 리팩터)', () => {
  test('resolveSafe = anchored + deny-list (종전과 동일): .env·탈출 차단', () => {
    expect(() => resolveSafe('.env', root)).toThrow(/deny-list/);
    expect(() => resolveSafe('../escape', root)).toThrow(/escapes cwd/);
    expect(resolveSafe('ok.txt', root)).toBe(join(root, 'ok.txt'));
  });
  test('anchoredResolve = cwd-앵커만: 탈출 차단·.env 는 통과(deny-list 없음)', () => {
    expect(() => anchoredResolve('../escape', root)).toThrow(/escapes cwd/);
    expect(anchoredResolve('.env', root)).toBe(join(root, '.env'));
  });
});

describe('native Read/Edit/Write — pathPolicy 이행(strict=차단·permissive 기본=현행)', () => {
  const prev = getSessionCwd();
  setSessionCwd(root, 'tool');
  afterAll(() => { try { setSessionCwd(prev, 'tool'); } catch { /* noop */ } });

  test('Read permissive(기본): .env 도 읽힘(현행 무변경)', async () => {
    const r = await dispatchRead({ file_path: join(root, '.env') });
    expect(r.output).toContain('SECRET');
  });
  test('Read strict: .env credential 차단(deny-list)', async () => {
    await expect(dispatchRead({ file_path: '.env' }, { pathPolicy: 'strict' })).rejects.toThrow(/deny-list/);
  });
  test('Read strict: cwd-탈출 차단', async () => {
    await expect(dispatchRead({ file_path: '../../etc/hosts' }, { pathPolicy: 'strict' })).rejects.toThrow(/escapes cwd/);
  });
  test('Read strict: cwd 내 일반 파일은 정상', async () => {
    const r = await dispatchRead({ file_path: 'ok.txt' }, { pathPolicy: 'strict' });
    expect(r.output).toContain('hello');
  });
  test('Write strict: .env 쓰기 차단', async () => {
    await expect(dispatchWrite({ file_path: '.env', content: 'x' }, { pathPolicy: 'strict' })).rejects.toThrow(/deny-list/);
  });
  test('Edit strict: cwd-탈출 차단', async () => {
    await expect(
      dispatchEdit({ file_path: '../escape.txt', old_string: 'a', new_string: 'b' }, { pathPolicy: 'strict' }),
    ).rejects.toThrow(/escapes cwd/);
  });
  test('Write permissive(기본): cwd 내 신규 파일 정상', async () => {
    const r = await dispatchWrite({ file_path: 'new.txt', content: 'data' });
    expect(r).toBeTruthy();
  });
});
