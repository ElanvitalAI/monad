// ⛔⭐⭐⭐ 쿼터 신호는 «어느 홈을 잰 것인가»를 들고 있어야 한다.
//
// 왜: 계정을 이름으로 가른 뒤(#7135)에도 신호 파일은 «하나»였다.
//   ⇒ A 를 재고 쓴 「찼다」를 B 의 것으로 읽는다. 그 위에 회전(S4)을 얹으면
//     「A 가 찼으니 B 로 간다 → B 도 찼다고 나온다 → 되돌아간다」가 된다.
//   ⭐ 키는 «monad 의 계정 이름»이 아니라 «실제로 잰 홈»이다 — 측정하는 것은
//     `codex app-server` 이고 그것이 읽는 것은 CODEX_HOME 이기 때문이다.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  quotaSignalDir, readQuotaSignal as readQuotaSignalFromStorage,
  readQuotaSignalUsedPercent as readQuotaSignalUsedPercentFromStorage,
  writeQuotaSignal as writeQuotaSignalToStorage,
} from '../../src/budget/codex-reset-credit-state';

let root: string;
const storage = (): { root: string } => ({ root });
const writeQuotaSignal = (rateLimitReached: string | undefined, usedPercentOrHome?: number | string, homePath?: string) =>
  writeQuotaSignalToStorage(rateLimitReached, usedPercentOrHome, homePath, storage());
const readQuotaSignal = (nowMs: number, homePath?: string) => readQuotaSignalFromStorage(nowMs, homePath, storage());
const readQuotaSignalUsedPercent = (nowMs: number, homePath?: string) =>
  readQuotaSignalUsedPercentFromStorage(nowMs, homePath, storage());
let priorState: string | undefined;
let priorCodexHome: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'quota-signal-'));
  priorState = process.env.MONAD_STATE_DIR;
  priorCodexHome = process.env.CODEX_HOME;
  process.env.MONAD_STATE_DIR = join(root, 'unrelated-instance-state');
  process.env.CODEX_HOME = join(root, 'home-A');   // 「지금 환경의 홈」 = A
});
afterEach(() => {
  if (priorState === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = priorState;
  if (priorCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = priorCodexHome;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

/** 이 환경에서 심볼릭 링크를 만들 수 있나 — 못 만들면 그 축은 «건너뛴 것으로 표시»된다. */
const CAN_SYMLINK = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'symlink-probe-'));
  try { symlinkSync(probe, join(probe, 'l')); return true; } catch { return false; }
  finally { try { rmSync(probe, { recursive: true, force: true }); } catch { /* best-effort */ } }
})();

describe('쿼터 신호는 계정(홈)별로 갈린다', () => {
  test('MONAD_STATE_DIR을 따르되 명시 저장소가 우선한다', () => {
    expect(quotaSignalDir()).toBe(join(process.env.MONAD_STATE_DIR!, 'budget'));
    expect(quotaSignalDir(root)).toBe(join(root, 'budget'));
  });

  test('⛔ A 가 「찼다」여도 B 를 물으면 «모른다» — A 의 신호를 B 로 읽지 않는다', () => {
    writeQuotaSignal('rate_limit_reached');                       // A(지금 환경의 홈)
    expect(readQuotaSignal(Date.now())).toBe(true);               // A 는 찼다
    // ⛔ 종전엔 파일이 하나여서 여기서도 true 가 나왔다 — 그것이 회전을 무한 왕복시킨다
    expect(readQuotaSignal(Date.now(), join(root, 'home-B'))).toBeUndefined();
  });

  test('✅ B 를 재서 쓰면 B 로만 읽히고, A 는 그대로다', () => {
    writeQuotaSignal(undefined);                                   // A — 안 찼다
    writeQuotaSignal('rate_limit_reached', join(root, 'home-B'));  // B — 찼다
    expect(readQuotaSignal(Date.now())).toBeUndefined();           // A 는 「찼다」가 아니다
    expect(readQuotaSignal(Date.now(), join(root, 'home-B'))).toBe(true);
  });

  test('⭐ 최근 신호의 브랜드 총량 사용률을 같은 홈에서 읽는다', () => {
    const homeB = join(root, 'home-B');
    writeQuotaSignal(undefined, 96, homeB);
    expect(readQuotaSignalUsedPercent(Date.now(), homeB)).toBe(96);
    expect(readQuotaSignalUsedPercent(Date.now())).toBeUndefined();
  });

  test('⛔ usedPercent 가 없는 옛 신호는 사용률을 모른다로 읽는다', () => {
    const homeB = join(root, 'home-B');
    writeQuotaSignal(undefined, homeB);
    expect(readQuotaSignalUsedPercent(Date.now(), homeB)).toBeUndefined();
  });

  // ⛔⭐⭐⭐ 리뷰 must-fix — 「기본 계정은 종전 파일 이름」 특례는 «기본»을 지금의 CODEX_HOME 으로
  //   판정할 수밖에 없고, 그 값이 A→B 로 바뀌면 A 가 쓴 파일을 B 의 신호로 읽는다.
  test('⛔ CODEX_HOME 이 A→B 로 바뀌어도 A 의 신호가 B 의 것으로 «안» 읽힌다', () => {
    writeQuotaSignal('rate_limit_reached');            // A 를 재서 썼다(지금 환경 = home-A)
    process.env.CODEX_HOME = join(root, 'home-B');     // 이제 환경이 B 를 가리킨다
    expect(readQuotaSignal(Date.now())).toBeUndefined();  // ⛔ B 로는 「모른다」여야 한다
    // 그리고 A 를 명시하면 여전히 A 의 것이 나온다
    expect(readQuotaSignal(Date.now(), join(root, 'home-A'))).toBe(true);
  });

  test('⛔ 같은 홈의 «다른 표기»는 같은 신호다 — 끝 슬래시 · `..` · 상대 경로', () => {
    const homeB = join(root, 'home-B');
    mkdirSync(homeB, { recursive: true });
    writeQuotaSignal('rate_limit_reached', homeB);
    expect(readQuotaSignal(Date.now(), `${homeB}/`)).toBe(true);                    // 끝 슬래시
    expect(readQuotaSignal(Date.now(), join(root, 'x', '..', 'home-B'))).toBe(true); // `..`
    // 한 계정이 «두 신호»를 갖지 않는다 — 파일이 하나뿐이다
    expect(readdirSync(join(root, 'budget')).length).toBe(1);
  });

  // ⛔ 링크를 못 만드는 환경에서 «조용히 통과»하면 이 축이 안 돌았는데 초록으로 보인다 ⇒ skipIf 로 표시.
  test.skipIf(!CAN_SYMLINK)('⛔ 심볼릭 링크로 같은 홈을 가리켜도 같은 신호다', () => {
    const homeB = join(root, 'home-B');
    mkdirSync(homeB, { recursive: true });
    const link = join(root, 'link-to-B');
    symlinkSync(homeB, link);
    writeQuotaSignal('rate_limit_reached', homeB);
    expect(readQuotaSignal(Date.now(), link)).toBe(true);
  });

  test('⛔ 신원이 «없는» 파일(옛 형식)은 아무 계정의 것으로도 안 읽힌다', () => {
    const homeB = join(root, 'home-B');
    writeQuotaSignal('rate_limit_reached', homeB);
    const f = join(root, 'budget', readdirSync(join(root, 'budget'))[0]);
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    delete parsed.measuredHome;                        // 옛 형식으로 되돌린다
    writeFileSync(f, JSON.stringify(parsed));
    expect(readQuotaSignal(Date.now(), homeB)).toBeUndefined();
  });

  test('⭐ 파일이 «무엇을 잰 것인지»를 사람이 읽을 수 있다 — 이름은 해시다', () => {
    const homeB = join(root, 'home-B');
    writeQuotaSignal('rate_limit_reached', homeB);
    const files = readdirSync(join(root, 'budget'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^codex-quota-signal-[0-9a-f]{12}\.json$/);   // 이름은 해시다
    const parsed = JSON.parse(readFileSync(join(root, 'budget', files[0]), 'utf8'));
    expect(parsed.measuredHome).toBe(homeB);                               // 사람이 읽을 수 있다
  });

  test('⛔ 낡은 신호는 계정별로도 «모른다»로 접힌다 — 나이 상한은 그대로다', () => {
    const homeB = join(root, 'home-B');
    writeQuotaSignal('rate_limit_reached', homeB);
    const twoHoursLater = Date.now() + 2 * 60 * 60 * 1000;
    expect(readQuotaSignal(twoHoursLater, homeB)).toBeUndefined();
  });
});

// ⛔⭐⭐ 계정별 측정은 «자식 env»로만 가야 한다. 부모 `process.env` 를 바꾸면 같은 프로세스의
//   «미러 쓰기»가 함께 끌려간다 — 오늘 사람의 codex 로그인이 깨진 것이 정확히 그 계급이다.
describe('계정별 측정은 부모 env 를 오염시키지 않는다', () => {
  test('⛔ codexHome 을 줘도 process.env.CODEX_HOME 이 «안 바뀐다» ⊕ 신호는 그 홈으로 간다', async () => {
    const { createCodexFetcher } = await import('../../src/budget/fetchers/codex');
    const homeB = join(root, 'home-B');
    mkdirSync(homeB, { recursive: true });
    const before = process.env.CODEX_HOME;

    // ⚠️ fetchImpl 로 스폰을 건너뛴다 — 여기서 무는 것은 «env 처리»와 «신호 키»다.
    //   실제 스폰 경로는 env 를 spawnOpts «인자»로 넘기므로 구조적으로 부모를 못 바꾼다.
    await createCodexFetcher({
      codexHome: homeB,
      quotaSignalStorage: storage(),
      fetchImpl: async () => ({ rateLimits: { rateLimitReachedType: 'rate_limit_reached' } } as never),
    }).fetch();

    expect(process.env.CODEX_HOME).toBe(before);                  // ⛔ 부모 무접촉
    expect(readQuotaSignal(Date.now(), homeB)).toBe(true);        // ✅ 신호는 B 로 갔다
    expect(readQuotaSignal(Date.now())).toBeUndefined();          // ⛔ A(지금 환경)의 것으로 안 갔다
  });

  // ⛔⭐ 위 테스트는 `fetchImpl` 로 스폰을 «건너뛴다» — 그러므로 「codexHome 이 자식 env 에
  //   실리는가」는 안 물었다(리뷰 should-fix). 진입점 전체는 in-process 로 못 무는 대신,
  //   그 사이의 «계약»(env 병합)은 여기서 고정할 수 있다.
  test('⛔ 스폰 env 계약 — 넘긴 값이 이기고 «나머지 부모 env 는 보존»된다', async () => {
    const { spawnCodexAppServer } = await import('../../src/acp/codex-app-server-client');
    const seen: Array<Record<string, string | undefined>> = [];
    const home = join(root, 'home-B');
    try {
      spawnCodexAppServer({
        codexBinary: '/nonexistent/codex-for-contract-test',
        env: { CODEX_HOME: home },
        spawnImpl: ((_b: string, _a: string[], o: { env: Record<string, string | undefined> }) => {
          seen.push(o.env);
          throw new Error('stop — 계약만 본다');
        }) as never,
      } as never);
    } catch { /* 스폰은 일부러 막는다 */ }
    // ⛔ 주입이 «안 물리면» 이 축은 못 잰 것이다 — 조용히 통과시키지 않고 여기서 깨진다
    expect(seen.length).toBe(1);
    expect(seen[0].CODEX_HOME).toBe(home);           // 넘긴 값이 이긴다
    expect(seen[0].PATH).toBe(process.env.PATH);     // 나머지 부모 env 는 보존된다
    expect(process.env.CODEX_HOME).toBe(join(root, 'home-A'));   // ⛔ 부모는 그대로
  });
});
