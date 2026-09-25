// 자격 거부 판정 — 「프로바이더 오류」에서 «자격 문제»를 갈라낸다.
//
// ⛔ 왜 이 파일이 있나(2026-08-14 · `[T]` 83차 실측):
//   grok 구독 토큰이 만료된 채 하니스 자식 «둘»이 돌았고, 요청이 전부 401 로 거부됐다.
//   그런데 부모가 남긴 것은 「보고 결손」(자식이 일을 안 했다)뿐이었고 전사도 0건이었다.
//   ⇒ 사람이 그것을 보고 ***「이 두뇌가 구현을 못 하나」를 진지하게 의심하고 런을 하나 더 날렸다.***
//     하니스 «밖»에서 같은 두뇌에 한 줄을 물어 보고서야 자격 거부가 드러났다.
//   📌 「자식이 일을 안 했다」와 「자식이 못 들어갔다」는 ***사람이 할 다음 행동이 완전히 다르다.***
//
// ⭐ 판정 규칙은 xAI grok-build 의 `is_auth_rejection_message` 설계를 따랐다
//   (`crates/codegen/xai-grok-mcp/src/servers.rs`).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isAuthRejectionError } from '../src/llm.js';

describe('isAuthRejectionError — status 를 «먼저» 본다', () => {
  test('401 status 를 문다', () => {
    expect(isAuthRejectionError({ status: 401, message: '' })).toBe(true);
  });

  // ⛔ 403 은 «일부러» 안 문다 — 레퍼런스 주석:
  //   "Excludes 403/forbidden — a non-auth policy denial here, not a credential problem."
  //   403 에 「재인증하세요」는 «틀린 처방»이다.
  test('403 은 안 문다 — 정책 거부는 자격 문제가 아니다', () => {
    expect(isAuthRejectionError({ status: 403, message: 'forbidden' })).toBe(false);
  });

  test('다른 상태코드는 안 문다', () => {
    expect(isAuthRejectionError({ status: 500, message: 'internal' })).toBe(false);
    expect(isAuthRejectionError({ status: 429, message: 'rate limited' })).toBe(false);
  });

  // ⭐ status 가 «있으면» 그것이 이긴다 — 본문에 자격 낱말이 있어도.
  test('status 가 있으면 문면보다 그것을 쓴다', () => {
    expect(isAuthRejectionError({ status: 500, message: 'unauthorized' })).toBe(false);
  });
});

describe('isAuthRejectionError — status 가 «없을» 때만 문면으로 내려간다', () => {
  // 📏 오늘 실제로 받은 원문.
  const REAL = 'LLM API 401: {"error":"Invalid or expired credentials (auth_kind=bearer, '
    + 'x_xai_token_auth=xai-grok-cli, upstream=PermissionDenied, reason=no auth context)"}';

  test('실물 401 문면을 문다', () => {
    expect(isAuthRejectionError({ message: REAL })).toBe(true);
  });

  test('자격 낱말은 상태코드 없이도 문다', () => {
    expect(isAuthRejectionError({ message: 'unauthorized' })).toBe(true);
    expect(isAuthRejectionError({ message: 'authentication failed' })).toBe(true);
  });

  test('맥락 접두가 붙은 401 을 문다', () => {
    expect(isAuthRejectionError({ message: 'http 401' })).toBe(true);
    expect(isAuthRejectionError({ message: 'status: 401' })).toBe(true);
  });

  // ⛔ 숫자만 보면 «다른 것»이 물린다 — 레퍼런스가 경계 검사로 막는 그 자리.
  test('401 처럼 «보이는» 숫자는 안 문다', () => {
    expect(isAuthRejectionError({ message: 'http 4012: other status' })).toBe(false);
    expect(isAuthRejectionError({ message: 'request took 401ms' })).toBe(false);
  });

  test('자격과 무관한 오류는 안 문다', () => {
    expect(isAuthRejectionError({ message: 'LLM API 500: internal error' })).toBe(false);
  });

  // 🚨 무인 리뷰 must-fix ① — 초판이 «여기서» 틀렸다.
  //   낱말 분기를 403 검사보다 «앞»에 뒀더니 자격 낱말이 섞인 403 이 통과했다.
  //   ⇒ 403 은 자격 낱말이 같이 있어도 「재인증」이 답이 아니다.
  test('자격 낱말이 섞여도 403 이면 안 문다', () => {
    expect(isAuthRejectionError({ message: 'authentication failed: HTTP 403' })).toBe(false);
    expect(isAuthRejectionError({ message: 'unauthorized — status: 403' })).toBe(false);
    expect(isAuthRejectionError({ message: 'forbidden by policy' })).toBe(false);
  });

  test('오류가 아니거나 비면 안 문다', () => {
    expect(isAuthRejectionError(undefined)).toBe(false);
    expect(isAuthRejectionError({})).toBe(false);
    expect(isAuthRejectionError({ message: '' })).toBe(false);
  });
});

// ⛔ 배선 핀 (무인 리뷰 should-fix ①) — 판정 함수만 물면 «배선을 지워도» 통과한다.
//   그런데 그 배선(streamLLM 의 catch · self-implement 의 싱크)은 «데몬 런타임»이라
//   이 저장소의 bun test 로는 돌릴 수 없다(jsdom 이 없는 PWA 축과 같은 형태).
//   ⇒ 저장소가 «이미 쓰는» 대체 증명(소스 핀)으로 「배선이 있다」를 못 박는다.
//   ⛔ 이 핀은 「행동이 옳다」를 증명하지 않는다. 「그 자리에 배선이 있다」만 증명한다.
describe('배선 핀 — 지우면 실패한다', () => {
  const LLM_SRC = readFileSync(new URL('../src/llm.ts', import.meta.url), 'utf8');
  const ORCH_SRC = readFileSync(new URL('../src/self-implement/orchestrator.ts', import.meta.url), 'utf8');

  test('라우터 catch 가 authRejected 를 실어 보낸다', () => {
    expect(LLM_SRC).toMatch(/isAuthRejectionError\(err\) \? \{ authRejected: true \}/);
  });

  test('self-implement 는 «판정하지 않고» 그 신호를 읽는다', () => {
    expect(ORCH_SRC).toContain("authRejected === true");
    // ⭐ 소비자가 «다시 재면» 같은 오류에 다른 답이 난다 — 그것을 막는 핀이다.
    expect(ORCH_SRC).not.toContain('isAuthRejectionError');
  });
});
