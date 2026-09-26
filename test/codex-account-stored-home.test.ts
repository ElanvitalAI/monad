// ⭐ 72차 인시던트 ⑷: `ELANOUS_CODEX_ACCOUNT=team` 만 주면 홈을 몰라 ***조용히 default 로 떨어지는데***
//   그 상태로 `explicit` 판정이 서서 ***관측이 「사람이 명시했다」고 말했다*** — 계정은 default 인데.
//   ⇒ 정본 기록이 그 홈을 «알고 있었는데» 실행 경로가 안 읽었다(오늘의 `F12` 형태).
// ⛔ 스토어를 codex-account.ts 가 직접 읽으면 순환이라, 읽을 수 있는 쪽이 «심»으로 넣어 준다.
import { describe, expect, test } from 'bun:test';
import { resolveCodexAccount, DEFAULT_CODEX_ACCOUNT } from '../src/oauth/codex-account.js';

const env = (extra: Record<string, string>) => ({ ...extra } as NodeJS.ProcessEnv);

describe('resolveCodexAccount — 정본 기록이 아는 홈', () => {
  test('이름만 주고 홈을 안 줘도 «정본 기록»의 홈으로 그 계정이 선다', () => {
    const resolved = resolveCodexAccount(
      env({ ELANOUS_CODEX_ACCOUNT: 'team' }),
      { storedHome: (key) => (key === 'openai-codex:team' ? '/homes/team' : undefined) },
    );
    expect(resolved).toMatchObject({ name: 'team', storeKey: 'openai-codex:team', home: '/homes/team', source: 'env' });
  });

  // ⛔ env 가 «그 자리에서» 준 것이 먼저다(사람이 방금 말한 것).
  test('env 홈이 있으면 그것이 정본보다 먼저다', () => {
    const resolved = resolveCodexAccount(
      env({ ELANOUS_CODEX_ACCOUNT: 'team', ELANOUS_CODEX_ACCOUNT_HOME: '/homes/from-env' }),
      { storedHome: () => '/homes/from-store' },
    );
    expect(resolved.home).toBe('/homes/from-env');
  });

  // ⛔ 「모르는 계정으로 쓰는 것」보다 default 가 안전하다 — 그 규칙은 «그대로»다.
  test('정본도 모르면 종전대로 default 로 떨어진다', () => {
    const resolved = resolveCodexAccount(env({ ELANOUS_CODEX_ACCOUNT: 'team' }), { storedHome: () => undefined });
    expect(resolved.name).toBe(DEFAULT_CODEX_ACCOUNT);
    expect(resolved.storeKey).toBe('openai-codex');
  });

  test('심을 «안 주면» 종전 동작 그대로(하위호환)', () => {
    expect(resolveCodexAccount(env({ ELANOUS_CODEX_ACCOUNT: 'team' })).name).toBe(DEFAULT_CODEX_ACCOUNT);
  });

  // ⛔ 빈 문자열·공백은 「모른다」다 — 그것을 홈으로 쓰면 «없는 곳»을 가리킨다.
  test.each([[''], ['   ']])('정본이 빈 값(%p)을 주면 홈을 «모르는 것»으로 본다', (stored) => {
    expect(resolveCodexAccount(env({ ELANOUS_CODEX_ACCOUNT: 'team' }), { storedHome: () => stored }).name)
      .toBe(DEFAULT_CODEX_ACCOUNT);
  });

  test('기본 계정은 «한 바이트도» 안 바뀐다', () => {
    const resolved = resolveCodexAccount(env({ CODEX_HOME: '/homes/default-env' }), { storedHome: () => '/homes/should-not-win' });
    expect(resolved).toMatchObject({ name: DEFAULT_CODEX_ACCOUNT, storeKey: 'openai-codex', home: '/homes/default-env' });
  });
});
