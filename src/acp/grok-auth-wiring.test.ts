// ⛔ 배선 테스트 — 「감지 함수가 무는가」가 아니라 「그 함수가 실행 경로에 «있는가»」.
//
// 이 파일이 있는 이유: `spawnCodexLogin` 이 만들어지고도 소비처 0건이었다
// (RESEARCH-grok-oauth-subscription-delegation-2026-08-13 §3a · F38 「심은 뚫려
// 있고 꽂는 사람이 없다」). grok 쪽이 같은 자리를 밟지 않게 «배선»을 문다.
//
// ⚠️ 한계 — AcpAgent.prompt() 전체를 띄우려면 실 백엔드 spawn 이 필요하다.
// 여기서는 client.ts 가 «무엇을 하는지»를 소스 계약으로 고정하고(⑴), 힌트
// 합성 로직 자체를 동치 재현으로 검증한다(⑵). 실물 왕복은 라이브 검증 몫이다.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { grokAuthHint, isGrokAuthError } from './grok-auth.js';

const CLIENT_SRC = readFileSync(join(import.meta.dir, 'client.ts'), 'utf-8');

describe('⑴ client.ts 가 grok 인증 실패를 «실행 경로에서» 문다', () => {
  it('grok-auth 를 import 한다', () => {
    expect(CLIENT_SRC).toContain("from './grok-auth.js'");
    expect(CLIENT_SRC).toContain('isGrokAuthError');
    expect(CLIENT_SRC).toContain('grokAuthHint');
  });

  it('백엔드가 grok 일 때만 분기한다 (다른 백엔드 오염 금지)', () => {
    expect(CLIENT_SRC).toContain("this.spec.id === 'grok' && isGrokAuthError(error)");
  });

  it('prompt 실패 «catch» 안에 있다 — 죽은 코드가 아니다', () => {
    const catchIdx = CLIENT_SRC.indexOf("debug.log('acp.client', 'prompt-failed'");
    const branchIdx = CLIENT_SRC.indexOf('grokAuthFailure');
    expect(catchIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeGreaterThan(-1);
    // 분기가 prompt-failed 로그 «근처»(같은 catch 블록)에 있어야 한다.
    expect(Math.abs(branchIdx - catchIdx)).toBeLessThan(900);
  });

  it('관측을 남긴다 — authFailure 태그(계측 누락 방지)', () => {
    expect(CLIENT_SRC).toContain("authFailure: 'grok-oauth'");
  });

  it('원 에러를 «버리지 않는다» — cause 로 보존', () => {
    expect(CLIENT_SRC).toContain('{ cause: error }');
  });

  it('⛔ 턴 도중 자동 로그인을 «안» 띄운다 (침습 금지)', () => {
    expect(CLIENT_SRC).not.toContain('spawnGrokLogin');
  });
});

describe('⑵ 힌트 합성 — 원문을 보존하고 실행 가능한 한 줄을 «잇는다»', () => {
  // client.ts 의 합성과 동치: `${original} · ${grokAuthHint()}`
  function compose(original: string, deviceAuth: boolean): string {
    return `${original} · ${grokAuthHint({ deviceAuth })}`;
  }

  it('원 문면이 살아 있고 명령이 이름으로 붙는다', () => {
    const original = 'Authentication required. Run `grok login` to re-authenticate.';
    expect(isGrokAuthError(original)).toBe(true);
    const msg = compose(original, false);
    expect(msg).toContain(original);
    expect(msg).toContain('grok login --oauth');
  });

  it('헤드리스면 device-auth 를 가리킨다', () => {
    expect(compose('Not logged in. Run `grok login`.', true)).toContain('grok login --device-auth');
  });

  it('인증과 무관한 실패에는 힌트가 안 붙는다 (감지가 앞단 게이트)', () => {
    expect(isGrokAuthError('ECONNREFUSED 127.0.0.1:1234')).toBe(false);
  });
});

describe('⑶ `elanous acp login` 이 실제로 등록돼 있다 — spawn 함수의 «소비처»', () => {
  const INDEX_SRC = readFileSync(join(import.meta.dir, '..', 'index.ts'), 'utf-8');

  it('acp login 서브커맨드가 있다', () => {
    expect(INDEX_SRC).toContain(".command('login')");
  });

  it('grok 과 codex 둘 다 소비한다 — codex 의 미배선(F38)도 같이 닫는다', () => {
    expect(INDEX_SRC).toContain('spawnGrokLogin');
    expect(INDEX_SRC).toContain('spawnCodexLogin');
  });

  it('종료 코드만 믿지 않고 크레덴셜 착지를 같이 본다', () => {
    expect(INDEX_SRC).toContain('readGrokTokenFreshness');
    expect(INDEX_SRC).toContain('credential=');
  });
});
