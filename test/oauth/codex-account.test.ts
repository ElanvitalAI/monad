// ⛔⭐⭐⭐ 이 파일의 «첫 계약»은 **기본 계정이 종전과 동일하다**는 것이다.
//   계정 개념을 넣으면서 기본 경로가 한 칸이라도 달라지면 «운영 인증»이 깨진다.

import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CODEX_ACCOUNT, accountNameFromStoreKey, codexAccountAuthPath, codexStoreKey,
  isCodexStoreKey, isValidAccountName, resolveCodexAccount,
} from '../../src/oauth/codex-account';

describe('codex 계정 해석', () => {
  test('⛔ 기본 계정은 «종전과 동일» — 스토어 키도 홈도 안 바뀐다', () => {
    const bare = resolveCodexAccount({});
    expect(bare.name).toBe(DEFAULT_CODEX_ACCOUNT);
    expect(bare.storeKey).toBe('openai-codex');                       // ⛔ 접미 없음(하위호환)
    expect(bare.home).toBe(join(homedir(), '.codex'));
    expect(codexAccountAuthPath(bare)).toBe(join(homedir(), '.codex', 'auth.json'));

    // CODEX_HOME 존중도 그대로
    const withHome = resolveCodexAccount({ CODEX_HOME: '/tmp/h' });
    expect(withHome.storeKey).toBe('openai-codex');
    expect(withHome.home).toBe('/tmp/h');
  });

  test('이름 계정은 «스코프된 키»와 «자기 홈»을 쓴다', () => {
    const r = resolveCodexAccount({ ELANOUS_CODEX_ACCOUNT: 'team', ELANOUS_CODEX_ACCOUNT_HOME: '/tmp/team' });
    expect(r).toEqual({ name: 'team', storeKey: 'openai-codex:team', home: '/tmp/team', source: 'env' });
    // ⭐ 미러가 «그 계정의 홈»으로 간다 — 이것이 A 가 B 를 덮던 사고의 수리다
    expect(codexAccountAuthPath(r)).toBe('/tmp/team/auth.json');
  });

  test('⛔ 홈을 모르거나 이름이 이상하면 «기본으로 떨어진다» — 조용히 다른 계정을 쓰지 않는다', () => {
    // 이름은 골랐는데 config 에 홈이 없다
    expect(resolveCodexAccount({ ELANOUS_CODEX_ACCOUNT: 'ghost' }).storeKey).toBe('openai-codex');
    expect(resolveCodexAccount({ ELANOUS_CODEX_ACCOUNT: 'ghost' }).source).toBe('default');
    // 이름 자체가 부적격(구분자·공백)
    expect(resolveCodexAccount({ ELANOUS_CODEX_ACCOUNT: 'a b', ELANOUS_CODEX_ACCOUNT_HOME: '/x' }).storeKey).toBe('openai-codex');
    expect(resolveCodexAccount({ ELANOUS_CODEX_ACCOUNT: 'a:b', ELANOUS_CODEX_ACCOUNT_HOME: '/x' }).storeKey).toBe('openai-codex');
  });

  test('per-run env 쌍이 이름 계정을 세운다 (⛔ 지속 설정은 이 판의 스코프가 아니다)', () => {
    const r = resolveCodexAccount({ ELANOUS_CODEX_ACCOUNT: 'team', ELANOUS_CODEX_ACCOUNT_HOME: '/tmp/t2' });
    expect(r).toEqual({ name: 'team', storeKey: 'openai-codex:team', home: '/tmp/t2', source: 'env' });
    // ⛔ 이름만 있고 홈이 없으면 기본으로 떨어진다
    expect(resolveCodexAccount({ ELANOUS_CODEX_ACCOUNT: 'team' }).storeKey).toBe('openai-codex');
  });

  test('미러 판정은 기본·이름 «둘 다» 문다 (⛔ 하나만 물면 그 계정 CLI 가 조용히 낡는다)', () => {
    expect(isCodexStoreKey('openai-codex')).toBe(true);
    expect(isCodexStoreKey('openai-codex:team')).toBe(true);
    expect(isCodexStoreKey('anthropic')).toBe(false);
    expect(accountNameFromStoreKey('openai-codex')).toBe(DEFAULT_CODEX_ACCOUNT);
    expect(accountNameFromStoreKey('openai-codex:team')).toBe('team');
    expect(codexStoreKey(DEFAULT_CODEX_ACCOUNT)).toBe('openai-codex');
  });

  test('이름 규칙 — 구분자·공백 금지', () => {
    expect(isValidAccountName('team')).toBe(true);
    expect(isValidAccountName('team-2.a_b')).toBe(true);
    expect(isValidAccountName('a b')).toBe(false);
    expect(isValidAccountName('a:b')).toBe(false);
    expect(isValidAccountName('')).toBe(false);
  });
});
