// ⛔⭐⭐⭐ 1R must-fix — 종전 테스트는 `isCodexStoreKey()` «판정»만 봤고 실제 `saveTokens` 의
//   «미러 경로·내용»은 하나도 안 물었다(Goodhart). 여기서 그 실물을 잠근다.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveTokens } from '../../src/oauth/store';
import { importCodexAccountFromHome } from '../../src/oauth/codex-account-store';

let root: string;
let priorHome: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-mirror-'));
  priorHome = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;   // ⛔ 주변 env 가 결과를 바꾸면 이 테스트가 무의미해진다
});
afterEach(() => {
  if (priorHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = priorHome;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const tokens = (a: string) => ({ accessToken: a, refreshToken: `${a}-r`, expiresAt: null });
const store = () => join(root, 'monad-auth.json');
const homeOf = (n: string) => join(root, n);
const authOf = (n: string) => join(homeOf(n), 'auth.json');

describe('codex 미러는 «저장하는 기록»이 정한 홈으로만 간다', () => {
  test('⛔ 이름 계정을 저장해도 «기본 홈»을 오염시키지 않는다 (1R must-fix 회귀)', () => {
    mkdirSync(homeOf('teamhome'), { recursive: true });
    mkdirSync(homeOf('defaulthome'), { recursive: true });
    writeFileSync(authOf('teamhome'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'team-id', account_id: 'team-account', access_token: 'old', refresh_token: 'old-r' } }));
    writeFileSync(authOf('defaulthome'), JSON.stringify({ tokens: { access_token: 'A', refresh_token: 'A-r' } }));

    process.env.CODEX_HOME = homeOf('defaulthome');   // 주변 env 는 «기본 홈»을 가리킨다
    saveTokens('openai-codex:team', tokens('B'), { codexHome: homeOf('teamhome') }, store());

    // ✅ team 의 홈에 갔다
    expect(JSON.parse(readFileSync(authOf('teamhome'), 'utf8')).tokens.access_token).toBe('B');
    // ⛔ 기본 홈은 «안 건드려졌다» — 종전 코드는 여기를 B 로 덮었다
    expect(JSON.parse(readFileSync(authOf('defaulthome'), 'utf8')).tokens.access_token).toBe('A');
  });

  test('기본 계정은 종전대로 CODEX_HOME 으로 미러한다', () => {
    mkdirSync(homeOf('defaulthome'), { recursive: true });
    writeFileSync(authOf('defaulthome'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'default-id', account_id: 'default-account', access_token: 'old', refresh_token: 'old-r' } }));
    process.env.CODEX_HOME = homeOf('defaulthome');
    saveTokens('openai-codex', tokens('A2'), {}, store());
    expect(JSON.parse(readFileSync(authOf('defaulthome'), 'utf8')).tokens.access_token).toBe('A2');
  });

  test('⛔ 이름 계정인데 홈을 모르면 «아무 데도 안 쓴다» — 모르는 곳에 토큰을 쓰지 않는다', () => {
    mkdirSync(homeOf('defaulthome'), { recursive: true });
    process.env.CODEX_HOME = homeOf('defaulthome');
    saveTokens('openai-codex:ghost', tokens('G'), {}, store());
    expect(existsSync(authOf('defaulthome'))).toBe(false);   // 기본 홈에도 안 썼다
  });
});

// ⭐ 미러는 «JWT exp 가 더 신선할 때만» 이긴다(store.ts 계약) — 그래서 진짜 형태를 만든다.
const jwt = (expMs: number, tag: string): string => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(expMs / 1000), tag })}.sig`;
};

describe('reconcile(읽기) 방향도 «그 계정의 홈»만 본다 (2R must-fix)', () => {
  test('⛔ 같은 상태라도 «어느 홈을 보느냐»에 따라 다른 계정 토큰이 들어온다 — 그래서 경로를 계정별로 골라야 한다', async () => {
    mkdirSync(homeOf('teamhome'), { recursive: true });
    mkdirSync(homeOf('defaulthome'), { recursive: true });
    const soon = Date.now() + 60 * 60 * 1000;
    writeFileSync(authOf('defaulthome'), JSON.stringify({ tokens: { access_token: jwt(soon, 'DEFAULT'), refresh_token: 'd-r' } }));
    writeFileSync(authOf('teamhome'), JSON.stringify({ tokens: { access_token: jwt(soon, 'TEAM'), refresh_token: 't-r' } }));

    const { reconcileCodexTokensFromMirror } = await import('../../src/oauth/store');
    const stale = { tokens: { accessToken: jwt(Date.now() - 1000, 'OLD'), refreshToken: 'o-r', expiresAt: null }, lastRefresh: new Date(0).toISOString(), codexHome: homeOf('teamhome') };

    const viaTeam = reconcileCodexTokensFromMirror(stale as never, store(), authOf('teamhome'));
    expect(viaTeam?.tokens.refreshToken).toBe('t-r');          // ✅ team 것을 읽었다

    const viaDefault = reconcileCodexTokensFromMirror(stale as never, store(), authOf('defaulthome'));
    expect(viaDefault?.tokens.refreshToken).toBe('d-r');        // ⛔ 기본 홈을 보면 «다른 계정»이 들어온다
    // ⇒ 그러므로 이름 계정의 reconcile 은 «그 계정의 홈»으로만 가야 한다(loadFreshCodexAuthState 의 수리)
  });

  // ⛔⭐⭐⭐ 3R must-fix — 위 테스트는 «반환된 토큰»만 봤고 «정본 파일의 어느 키가 바뀌었나»를
  //   한 번도 안 물었다(Goodhart). 종전 코드는 어느 계정을 읽든 `openai-codex` 에 적었다.
  //   ⇒ team 의 미러가 신선하면 «기본 계정의 정본»이 team 토큰으로 덮였다 — 이 PR 이 닫으려던
  //     사고의 «셋째 방향»이다. 여기서 그 방향을 실물 파일로 잠근다.
  test('⛔ 채택 결과는 «읽은 그 계정»에만 적힌다 — 기본 계정 정본은 안 건드려진다', async () => {
    mkdirSync(homeOf('teamhome'), { recursive: true });
    const fresh = Date.now() + 60 * 60 * 1000;
    writeFileSync(authOf('teamhome'), JSON.stringify({ tokens: { access_token: jwt(fresh, 'TEAM'), refresh_token: 't-r' } }));

    // 정본에 두 계정을 심는다(미러는 끈다 — 이 단계가 홈을 건드리면 안 된다)
    saveTokens('openai-codex', { accessToken: jwt(fresh, 'A'), refreshToken: 'a-r', expiresAt: null }, { mirrorCodex: false }, store());
    saveTokens('openai-codex:team', { accessToken: jwt(Date.now() - 1000, 'OLD'), refreshToken: 'o-r', expiresAt: null },
      { mirrorCodex: false, codexHome: homeOf('teamhome') }, store());

    const { reconcileCodexTokensFromMirror, loadTokens } = await import('../../src/oauth/store');
    const out = reconcileCodexTokensFromMirror(loadTokens('openai-codex:team', store()), store(), authOf('teamhome'), 'openai-codex:team');
    expect(out?.tokens.refreshToken).toBe('t-r');   // 채택은 됐다

    const providers = JSON.parse(readFileSync(store(), 'utf8')).providers;
    // ✅ team 의 정본이 갱신됐다
    expect(providers['openai-codex:team'].tokens.refreshToken).toBe('t-r');
    expect(providers['openai-codex:team'].codexHome).toBe(homeOf('teamhome'));   // 홈을 잃지 않았다
    // ⛔ 기본 계정 정본은 «한 바이트도» 안 바뀌었다 — 종전 코드는 여기를 't-r' 로 덮었다
    expect(providers['openai-codex'].tokens.refreshToken).toBe('a-r');
  });

  test('기본 계정의 reconcile 은 종전대로 `openai-codex` 에 적는다 (하위호환)', async () => {
    mkdirSync(homeOf('defaulthome'), { recursive: true });
    // ⛔⭐⭐⭐ 2026-08-05 인시던트 — 여기가 «터진 자리»다.
    //   reconcile → saveTokens 는 «미러도» 쓴다(시그니처가 그 부수효과를 말하지 않는다).
    //   그런데 이 파일의 beforeEach 는 CODEX_HOME 을 «지운다» ⇒ 미러 기본값이 사람의 실제
    //   ~/.codex 가 되어, 아래 픽스처('d-r')가 실물 로그인을 덮었다.
    //   🩹 그러므로 여기서 «세운다» — 지운 상태로 두지 않는다. (가드 2층이 이것을 강제한다)
    process.env.CODEX_HOME = homeOf('defaulthome');
    const fresh = Date.now() + 60 * 60 * 1000;
    writeFileSync(authOf('defaulthome'), JSON.stringify({ tokens: { access_token: jwt(fresh, 'D'), refresh_token: 'd-r' } }));
    saveTokens('openai-codex', { accessToken: jwt(Date.now() - 1000, 'OLD'), refreshToken: 'o-r', expiresAt: null }, { mirrorCodex: false }, store());

    const { reconcileCodexTokensFromMirror, loadTokens } = await import('../../src/oauth/store');
    reconcileCodexTokensFromMirror(loadTokens('openai-codex', store()), store(), authOf('defaulthome'));
    expect(JSON.parse(readFileSync(store(), 'utf8')).providers['openai-codex'].tokens.refreshToken).toBe('d-r');
  });

  test('⛔ 홈을 모르는 이름 계정은 «어느 미러도» 안 읽는다', async () => {
    const { resolveCodexAccount } = await import('../../src/oauth/codex-account');
    // 홈 없이 이름만 주면 기본으로 떨어진다 ⇒ 이름 계정으로 «미러를 고를 일 자체가» 안 생긴다
    expect(resolveCodexAccount({ MONAD_CODEX_ACCOUNT: 'ghost' }).storeKey).toBe('openai-codex');
  });
});

// ⛔⭐⭐ 3R must-fix — 종전 목록은 `['openai-codex']` 하나만 훑었다. 스토어에 `openai-codex:team`
//   이 있는데도 CLI 는 «없다»고 말했다(실측 2026-08-05 18:0x). 그 문면을 여기서 잠근다.
describe('정본 스토어가 아는 계정 — 이름 계정을 «전부» 말한다', () => {
  test('기본 ⊕ 이름 여럿이 다 나오고, 비-codex 와 토큰 값은 «안» 나온다', async () => {
    const { listCodexAccountsInStore } = await import('../../src/oauth/codex-account-store');
    const t = { refreshToken: 'r', expiresAt: null };
    saveTokens('openai-codex', { accessToken: 'A', ...t }, { mirrorCodex: false, authMode: 'chatgpt' }, store());
    saveTokens('openai-codex:team', { accessToken: 'B', ...t }, { mirrorCodex: false, authMode: 'chatgpt' }, store());
    saveTokens('openai-codex:alt', { accessToken: 'C', ...t }, { mirrorCodex: false, authMode: 'apikey' }, store());
    saveTokens('anthropic', { accessToken: 'Z', ...t }, { mirrorCodex: false }, store());

    const rows = listCodexAccountsInStore(store());
    expect(rows.map((r) => r.name).sort()).toEqual(['alt', 'default', 'team']);
    expect(rows.find((r) => r.name === 'team')?.storeKey).toBe('openai-codex:team');
    expect(rows.find((r) => r.name === 'alt')?.authMode).toBe('apikey');
    // ⛔ 비-codex provider 가 안 섞였다
    expect(rows.some((r) => r.storeKey === 'anthropic')).toBe(false);
    // ⛔ 토큰 «값»은 어떤 필드로도 안 새어 나간다
    expect(JSON.stringify(rows)).not.toContain('B');
  });
});

// ⛔⭐⭐⭐ 4R must-fix — 표면(`account list` 의 「홈」)이 «env 해석»을 찍는데 실제 미러·영속은
//   «정본 기록»이 이겼다. 둘이 갈리면 CLI 가 거짓 상태를 보고한다.
//   ⇒ 판정층이 피판정층과 «다른 자»를 쓰면 안 된다. 여기서 「한 자」를 잠근다.
describe('실효 홈은 «한 자»가 낸다 — 표면과 런타임이 같은 값을 본다', () => {
  test('⛔ env 가 다른 홈을 말해도 «정본 기록»이 이기고, 표면은 그 불일치를 «값으로» 말한다', async () => {
    const { effectiveCodexHome, resolveCodexAccount } = await import('../../src/oauth/codex-account');
    const account = resolveCodexAccount({ MONAD_CODEX_ACCOUNT: 'team', MONAD_CODEX_ACCOUNT_HOME: homeOf('declared') });
    expect(account.home).toBe(homeOf('declared'));    // 선언은 env 것

    const eff = effectiveCodexHome(account, { codexHome: homeOf('teamhome') });
    expect(eff.home).toBe(homeOf('teamhome'));        // ⭐ 실효는 «기록» 것 — 런타임이 쓰는 값
    expect(eff.source).toBe('store');
    expect(eff.declaredHome).toBe(homeOf('declared')); // ⛔ 불일치를 감추지 않는다
  });

  test('둘이 같으면 «불일치 표기»가 없다 — 없는 경고를 만들지 않는다', async () => {
    const { effectiveCodexHome, resolveCodexAccount } = await import('../../src/oauth/codex-account');
    const account = resolveCodexAccount({ MONAD_CODEX_ACCOUNT: 'team', MONAD_CODEX_ACCOUNT_HOME: homeOf('teamhome') });
    const eff = effectiveCodexHome(account, { codexHome: homeOf('teamhome') });
    expect(eff.declaredHome).toBeUndefined();
  });

  test('⛔ 정본이 이름 계정의 홈을 모르면 실효 홈은 «없다» — 어디에도 안 쓴다', async () => {
    const { effectiveCodexHome, resolveCodexAccount } = await import('../../src/oauth/codex-account');
    // 이름만 주고 홈을 안 주면 resolve 가 기본으로 떨어뜨린다 ⇒ 이름 계정 해석을 직접 만든다
    const named = { ...resolveCodexAccount({ MONAD_CODEX_ACCOUNT: 'team', MONAD_CODEX_ACCOUNT_HOME: homeOf('x') }), storeKey: 'openai-codex:team' };
    const eff = effectiveCodexHome(named, null);
    expect(eff.home).toBeUndefined();
    expect(eff.source).toBe('none');
  });

  // ⛔⭐⭐⭐ 위 셋은 «자 자체»를 물 뿐, 「표면이 그 자를 쓰는가」는 안 문다 —
  //   그것이 3R 에 지적받은 Goodhart 의 형태다. 여기서 «표면»을 직접 문다.
  test('⛔ 표면(`account list` 가 쓰는 뷰)이 env 가 아니라 «실효» 홈을 말한다 — 종전 표면은 여기서 거짓을 말했다', async () => {
    const { activeCodexAccountView } = await import('../../src/oauth/codex-account-store');
    // 정본에 team 을 심는다 — 그 기록의 홈은 teamhome
    saveTokens('openai-codex:team', tokens('T'), { mirrorCodex: false, codexHome: homeOf('teamhome') }, store());

    // 그런데 env 는 «다른» 홈을 선언한다
    const view = activeCodexAccountView(
      { MONAD_CODEX_ACCOUNT: 'team', MONAD_CODEX_ACCOUNT_HOME: homeOf('declared') },
      store(),
    );
    expect(view.name).toBe('team');
    expect(view.home).toBe(homeOf('teamhome'));       // ⭐ 실제로 쓰이는 홈 (종전 표면은 declared 를 찍었다)
    expect(view.homeSource).toBe('store');
    expect(view.declaredHome).toBe(homeOf('declared')); // ⛔ 불일치를 «값으로» 말한다
  });

  test('기본 계정은 종전대로 CODEX_HOME || ~/.codex 이고 출처를 말한다', async () => {
    const { effectiveCodexHome, resolveCodexAccount } = await import('../../src/oauth/codex-account');
    process.env.CODEX_HOME = homeOf('defaulthome');
    const eff = effectiveCodexHome(resolveCodexAccount(), null);
    expect(eff.home).toBe(homeOf('defaulthome'));
    expect(eff.source).toBe('env');
  });
});

describe('경로·출처·목록의 가장자리 (5R)', () => {
  test('⛔ 상대 경로로 들여와도 «절대 경로»로 저장된다 — 나중에 다른 cwd 에서 갱신해도 같은 곳을 가리킨다', async () => {
    mkdirSync(homeOf('relsrc'), { recursive: true });
    writeFileSync(authOf('relsrc'), JSON.stringify({ tokens: { access_token: 'R', refresh_token: 'R-r' } }));

    // root 를 기준으로 «상대 경로»를 만든다
    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      const r = await importCodexAccountFromHome('rel', 'relsrc', store());
      expect(r.ok).toBe(true);
    } finally { process.chdir(prevCwd); }

    const saved = JSON.parse(readFileSync(store(), 'utf8')).providers['openai-codex:rel'];
    expect(saved.codexHome.startsWith('/')).toBe(true);        // ⛔ 상대 경로가 그대로 남지 않았다
    expect(saved.codexHome).toBe(realpathSync(homeOf('relsrc')));
  });

  test('⛔ 출처 판정이 «전달받은 env»를 쓴다 — 전역 process.env 를 몰래 읽지 않는다', async () => {
    const { effectiveCodexHome, resolveCodexAccount } = await import('../../src/oauth/codex-account');
    process.env.CODEX_HOME = homeOf('globalhome');   // 전역은 «있다»
    const env = {} as NodeJS.ProcessEnv;             // 그런데 전달받은 env 에는 «없다»
    const eff = effectiveCodexHome(resolveCodexAccount(env), null, env);
    expect(eff.source).toBe('default');              // ⇒ 'env' 라고 하면 거짓 출처다
  });

  test('⛔ 접미가 부적격인 키는 계정으로 «안» 센다', async () => {
    const { listCodexAccountsInStore } = await import('../../src/oauth/codex-account-store');
    saveTokens('openai-codex', tokens('A'), { mirrorCodex: false }, store());
    saveTokens('openai-codex:', tokens('X'), { mirrorCodex: false }, store());        // 빈 이름
    saveTokens('openai-codex:a b', tokens('Y'), { mirrorCodex: false }, store());     // 공백
    expect(listCodexAccountsInStore(store()).map((r) => r.name)).toEqual(['default']);
  });
});

describe('import — 원본을 안 건드리고 모르는 것을 안 지어낸다', () => {
  test('원본 auth.json 이 «그대로»이고, expiresAt 은 null 이며, default 이름은 거부된다', async () => {
    mkdirSync(homeOf('src'), { recursive: true });
    const original = JSON.stringify({ tokens: { access_token: 'X', refresh_token: 'X-r', account_id: 'abcdef0123' }, auth_mode: 'chatgpt' });
    writeFileSync(authOf('src'), original);

    const r = await importCodexAccountFromHome('team', homeOf('src'), store());
    expect(r.ok).toBe(true);
    // ⛔ 원본이 «한 바이트도» 안 바뀌었다(mirrorCodex:false 의 실물 검증)
    expect(readFileSync(authOf('src'), 'utf8')).toBe(original);
    if (r.ok) expect(r.accountIdPrefix).toBe('abcdef01');
    // ⭐ 정본 파일에 «무엇이» 저장됐나 — 제목이 말하는 것을 실제로 확인한다(2R must-fix)
    const saved = JSON.parse(readFileSync(store(), 'utf8')).providers['openai-codex:team'];
    expect(saved.tokens.accessToken).toBe('X');
    expect(saved.tokens.refreshToken).toBe('X-r');
    expect(saved.tokens.expiresAt).toBeNull();          // ⛔ 모르는 만료를 지어내지 않는다
    expect(saved.codexHome).toBe(homeOf('src'));        // ⭐ 홈이 «토큰과 함께» 저장된다

    // ⛔ 예약 이름 거부
    const bad = await importCodexAccountFromHome('default', homeOf('src'), store());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.kind).toBe('bad-name');
  });

  test('토큰이 없으면 «지어내지 않고» 그 사실을 값으로 돌려준다', async () => {
    mkdirSync(homeOf('empty'), { recursive: true });
    writeFileSync(authOf('empty'), JSON.stringify({ tokens: {} }));
    const r = await importCodexAccountFromHome('team', homeOf('empty'), store());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('no-tokens');
  });
});
