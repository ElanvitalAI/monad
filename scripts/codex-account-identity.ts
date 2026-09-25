#!/usr/bin/env bun
// Codex 계정 «신원»을 두 홈에서 읽어 비교한다.
//
// ⛔⭐⭐ 왜 스크립트인가: 이 판정을 매뉴얼에 «인라인 스니펫»으로 두었더니 «두 번» 틀렸다
//   (① 못 읽었는데 「다르다」로 답함 ② account_id 가 null 이면 traceback).
//   ***사람이 그대로 칠 명령이 틀리면, 그 사람이 틀린 답을 믿고 다음 단계로 간다.***
//   ⇒ 그래서 코드로 옮기고 테스트로 잠근다.
//
// ⛔ 값(토큰)은 «절대» 출력하지 않는다 — account_id 앞 8자만(R-LLM2).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type IdentityRead =
  | { ok: true; accountId: string }
  | { ok: false; reason: 'missing' | 'unreadable' | 'no-account-id' };

export function readAccountIdentity(authPath: string, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): IdentityRead {
  let raw: string;
  try {
    raw = read(authPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return { ok: false, reason: code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  try {
    const id = (JSON.parse(raw) as { tokens?: { account_id?: unknown } })?.tokens?.account_id;
    if (typeof id !== 'string' || id.length === 0) return { ok: false, reason: 'no-account-id' };
    return { ok: true, accountId: id };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export type ComparisonVerdict = 'same-account' | 'different-accounts' | 'undecidable';

/** ⛔ 「모른다」를 「다르다」로 뭉개지 않는다 — 셋을 «갈라» 답한다. */
export function compareIdentities(a: IdentityRead, b: IdentityRead): ComparisonVerdict {
  if (!a.ok || !b.ok) return 'undecidable';
  return a.accountId === b.accountId ? 'same-account' : 'different-accounts';
}

export function describe(read: IdentityRead): string {
  if (read.ok) return read.accountId.slice(0, 8);
  return read.reason === 'missing' ? '(파일 없음)' : read.reason === 'no-account-id' ? '(account_id 없음)' : '(못 읽음)';
}

/** ⛔⭐⭐ 주변 `CODEX_HOME` 을 «본다» — 설정돼 있으면 「기본 홈」이 `~/.codex` 가 «아니다». */
export function defaultHome(env: NodeJS.ProcessEnv = process.env): { path: string; fromEnv: boolean } {
  const fromEnv = env.CODEX_HOME?.trim();
  return fromEnv ? { path: fromEnv, fromEnv: true } : { path: join(homedir(), '.codex'), fromEnv: false };
}

if (import.meta.main) {
  const [aArg, bArg] = process.argv.slice(2);
  const home = defaultHome();
  const aPath = aArg ?? join(home.path, 'auth.json');
  const bPath = bArg ?? join(homedir(), '.codex-team', 'auth.json');
  if (home.fromEnv && !aArg) {
    console.log(`⚠️ 주변 CODEX_HOME 이 설정돼 있다 → 기본 홈이 «${home.path}» 다(⛔ ~/.codex 가 아니다)`);
    console.log('   그 상태로 셋업하면 ⓪·④ 가 «엉뚱한 홈»을 본다. 새 셸에서 `unset CODEX_HOME` 후 다시 하라.');
  }
  const a = readAccountIdentity(aPath);
  const b = readAccountIdentity(bPath);
  console.log(`A(${aPath}): ${describe(a)}`);
  console.log(`B(${bPath}): ${describe(b)}`);
  const verdict = compareIdentities(a, b);
  console.log(verdict === 'undecidable'
    ? '→ ⚠️ 판정 불가 — 한쪽을 못 읽었다(아직 셋업 전이거나 경로가 다르다)'
    : verdict === 'same-account'
      ? '→ ⛔ «같은 계정»이다 — B 홈을 지우고 ①부터 다시(A 는 무사하다)'
      : '→ ✅ 서로 «다른» 계정');
  process.exitCode = verdict === 'different-accounts' ? 0 : verdict === 'same-account' ? 1 : 2;
}
