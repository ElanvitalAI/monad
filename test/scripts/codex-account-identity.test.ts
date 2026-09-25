// ⛔⭐⭐ 이 판정은 «사람이 그대로 치는» 절차의 일부다(MANUAL-llm-provider-operations §3a).
//   인라인 스니펫으로 두었을 때 «두 번» 틀렸으므로(못 읽음을 「다르다」로 · null 에서 traceback)
//   코드로 옮기고 여기서 잠근다.

import { describe, expect, test } from 'bun:test';
import { compareIdentities, defaultHome, describe as describeRead, readAccountIdentity } from '../../scripts/codex-account-identity';

const reader = (contents: Record<string, string>) => (p: string) => {
  if (!(p in contents)) { const e = new Error('ENOENT') as NodeJS.ErrnoException; e.code = 'ENOENT'; throw e; }
  return contents[p]!;
};

describe('codex 계정 신원 판정', () => {
  test('정상 · 파일 없음 · account_id 없음 · 깨진 JSON 을 «서로 다른 값»으로 답한다', () => {
    const read = reader({
      '/ok': JSON.stringify({ tokens: { account_id: 'abcdef0123456789' } }),
      '/null': JSON.stringify({ tokens: { account_id: null } }),
      '/empty': JSON.stringify({ tokens: {} }),
      '/broken': '{ not json',
    });
    expect(readAccountIdentity('/ok', read)).toEqual({ ok: true, accountId: 'abcdef0123456789' });
    expect(readAccountIdentity('/missing', read)).toEqual({ ok: false, reason: 'missing' });
    expect(readAccountIdentity('/null', read)).toEqual({ ok: false, reason: 'no-account-id' });
    expect(readAccountIdentity('/empty', read)).toEqual({ ok: false, reason: 'no-account-id' });
    expect(readAccountIdentity('/broken', read)).toEqual({ ok: false, reason: 'unreadable' });
  });

  test('⛔ 「모른다」를 「다르다」로 뭉개지 않는다 — 셋을 갈라 답한다', () => {
    const ok = (id: string) => ({ ok: true as const, accountId: id });
    const missing = { ok: false as const, reason: 'missing' as const };
    expect(compareIdentities(ok('A'), ok('B'))).toBe('different-accounts');
    expect(compareIdentities(ok('A'), ok('A'))).toBe('same-account');
    // ⛔ 이 셋이 초판의 버그였다 — 전부 "다르다" 로 답했다
    expect(compareIdentities(ok('A'), missing)).toBe('undecidable');
    expect(compareIdentities(missing, ok('B'))).toBe('undecidable');
    expect(compareIdentities(missing, missing)).toBe('undecidable');
  });

  test('사람이 읽는 문면이 값을 «흘리지 않는다» — 앞 8자만', () => {
    expect(describeRead({ ok: true, accountId: 'abcdef0123456789' })).toBe('abcdef01');
    expect(describeRead({ ok: false, reason: 'missing' })).toBe('(파일 없음)');
    expect(describeRead({ ok: false, reason: 'no-account-id' })).toBe('(account_id 없음)');
  });

  test('⛔ 주변 CODEX_HOME 이 있으면 「기본 홈」이 ~/.codex 가 «아니다»', () => {
    expect(defaultHome({ CODEX_HOME: '/tmp/other' })).toEqual({ path: '/tmp/other', fromEnv: true });
    expect(defaultHome({ CODEX_HOME: '   ' }).fromEnv).toBe(false);
    expect(defaultHome({}).fromEnv).toBe(false);
  });
});
