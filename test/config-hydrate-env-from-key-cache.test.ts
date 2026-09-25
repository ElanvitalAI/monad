// 설치본 전환 RFC 0b — 상주 프로세스가 plist 평문 키 대신 키 캐시로 env 를 채운다.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetKeyCacheForTests, getOpenAiRelaySharedSecret, hydrateEnvFromKeyCache } from '../src/config.js';

const saved = { dir: process.env.MONAD_KEY_CACHE_DIR, keep: process.env.MONAD_KEEP_ENV_KEYS, relay: process.env.MONAD_OPENAI_RELAY_SHARED_SECRET };
const dirs: string[] = [];

afterEach(() => {
  for (const [k, v] of [['MONAD_KEY_CACHE_DIR', saved.dir], ['MONAD_KEEP_ENV_KEYS', saved.keep], ['MONAD_OPENAI_RELAY_SHARED_SECRET', saved.relay]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  _resetKeyCacheForTests();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function cacheDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'key-cache-'));
  dirs.push(dir);
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), value);
  process.env.MONAD_KEY_CACHE_DIR = dir;
  delete process.env.MONAD_KEEP_ENV_KEYS;
  _resetKeyCacheForTests();
  return dir;
}

describe('hydrateEnvFromKeyCache', () => {
  test('the cache wins over a stale env value, and only the filled names come back', () => {
    cacheDir({ xai_api_key: 'fresh\n', openai_api_key: 'same' });
    const env: NodeJS.ProcessEnv = { XAI_API_KEY: 'stale-from-plist', OPENAI_API_KEY: 'same' };
    expect(hydrateEnvFromKeyCache(['XAI_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'], env)).toEqual(['XAI_API_KEY']);
    expect(env.XAI_API_KEY).toBe('fresh');
    expect(env.GEMINI_API_KEY).toBeUndefined();   // 캐시가 없으면 건드리지 않는다
  });

  test('an empty cache file leaves a live env key alone', () => {
    cacheDir({ anthropic_api_key: '   \n' });
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'live' };
    expect(hydrateEnvFromKeyCache(['ANTHROPIC_API_KEY'], env)).toEqual([]);
    expect(env.ANTHROPIC_API_KEY).toBe('live');
  });

  test('MONAD_KEEP_ENV_KEYS=1 keeps the env as is', () => {
    cacheDir({ xai_api_key: 'fresh' });
    process.env.MONAD_KEEP_ENV_KEYS = '1';
    const env: NodeJS.ProcessEnv = { XAI_API_KEY: 'pinned' };
    expect(hydrateEnvFromKeyCache(['XAI_API_KEY'], env)).toEqual([]);
    expect(env.XAI_API_KEY).toBe('pinned');
  });

  test('the relay shared secret is read from the cache when the plist no longer carries it', () => {
    cacheDir({ monad_openai_relay_shared_secret: 's3cret\n' });
    delete process.env.MONAD_OPENAI_RELAY_SHARED_SECRET;
    expect(getOpenAiRelaySharedSecret()).toBe('s3cret');
  });
});
