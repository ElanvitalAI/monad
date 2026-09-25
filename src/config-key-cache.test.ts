// 키 해석 규약 회귀 — 「파일이 SSOT, env 는 캐시」(대표 2026-08-06 · 1안+2안).
//
// ⛔⭐⭐ **이 파일이 지키는 사건**: 8/4 에 뜬 프로세스가 **소진된 팀**의 XAI 키를 들고 403 을
//    받았고, 캐시 파일의 키는 200 이었다. 같은 사건이 그 4일 전에도 났다.
//    셸(`api-keys.zsh`)은 이미 캐시 우선으로 고쳐져 있었지만 그것은 **새 셸에만** 먹는다 —
//    ***이미 뜬 프로세스는 영영 옛 env 를 들고 산다.*** 그래서 판독기가 캐시를 먼저 본다.
//
// ⚠️ `keyFromCacheOrEnv` 는 프로세스당 1회만 파일을 읽고 기억한다(파일 I/O 억제).
//    그래서 아래 테스트는 상태를 **`refreshKeyFromCache` 로만** 움직인다 — 그것이 유일하게
//    「다시 읽는」 문이고, 2안(401/403 경로)이 실제로 쓰는 문도 이것이다.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFromCacheOrEnv, refreshKeyFromCache } from './config.js';

const KEY = 'MONAD_TEST_FAKE_API_KEY';
let home = '';
let prevHome: string | undefined;
let prevKeep: string | undefined;

function writeCache(value: string): void {
  mkdirSync(join(home, '.cache'), { recursive: true });
  writeFileSync(join(home, '.cache', KEY.toLowerCase()), `${value}\n`);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'monad-key-'));
  prevHome = process.env.MONAD_KEY_CACHE_DIR;
  prevKeep = process.env.MONAD_KEEP_ENV_KEYS;
  // ⛔ `HOME` 이 아니라 이 seam 을 쓴다 — `os.homedir()` 는 바뀐 `HOME` 을 안 따라온다(실측).
  process.env.MONAD_KEY_CACHE_DIR = join(home, '.cache');
  delete process.env.MONAD_KEEP_ENV_KEYS;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.MONAD_KEY_CACHE_DIR; else process.env.MONAD_KEY_CACHE_DIR = prevHome;
  if (prevKeep === undefined) delete process.env.MONAD_KEEP_ENV_KEYS; else process.env.MONAD_KEEP_ENV_KEYS = prevKeep;
  delete process.env[KEY];
  rmSync(home, { recursive: true, force: true });
});

describe('키 해석 — 파일이 SSOT, env 는 캐시', () => {
  test('캐시가 없으면 env 를 쓴다 — ⛔ 살아 있는 키를 지우지 않는다', () => {
    process.env[KEY] = 'from-env';
    refreshKeyFromCache(KEY);                 // 캐시 없음을 확정
    expect(keyFromCacheOrEnv(KEY)).toBe('from-env');
  });

  test('⭐ 캐시가 있으면 «낡은 env 를 이긴다» — 이 사건이 이 파일의 이유다', () => {
    process.env[KEY] = 'stale-from-old-shell';
    writeCache('fresh-from-cache');
    expect(refreshKeyFromCache(KEY)).toBe(true);      // 값이 «바뀌었다»고 말한다
    expect(keyFromCacheOrEnv(KEY)).toBe('fresh-from-cache');
  });

  test('빈 캐시 파일은 «없는 것»으로 본다 — 빈 값으로 살아 있는 키를 덮지 않는다', () => {
    process.env[KEY] = 'from-env';
    writeCache('   ');
    refreshKeyFromCache(KEY);
    expect(keyFromCacheOrEnv(KEY)).toBe('from-env');
  });

  test('MONAD_KEEP_ENV_KEYS=1 이면 캐시를 무시한다(임시 키 탈출구)', () => {
    process.env[KEY] = 'deliberate-override';
    writeCache('fresh-from-cache');
    process.env.MONAD_KEEP_ENV_KEYS = '1';
    expect(refreshKeyFromCache(KEY)).toBe(false);
    expect(keyFromCacheOrEnv(KEY)).toBe('deliberate-override');
  });

  test('⭐ 2안 계약 — 값이 «안 바뀌면» false 다(재시도해도 같은 답이므로)', () => {
    writeCache('same');
    expect(refreshKeyFromCache(KEY)).toBe(true);   // 최초 적재
    expect(refreshKeyFromCache(KEY)).toBe(false);  // 두 번째는 변화 없음
  });

  test('env 별칭 폴백은 캐시가 없을 때만 쓰인다', () => {
    process.env['MONAD_TEST_ALIAS_KEY'] = 'alias-value';
    refreshKeyFromCache(KEY);
    expect(keyFromCacheOrEnv(KEY, 'MONAD_TEST_ALIAS_KEY')).toBe('alias-value');
    delete process.env['MONAD_TEST_ALIAS_KEY'];
  });
});
