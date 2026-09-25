// RFC #2161 FU A6-real P3 (2026-05-11) — firecrawl-crawl source tests.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  firecrawlCrawlSource,
  isFirecrawlCliAvailable,
  __resetFirecrawlCliCache,
  type FirecrawlSpawnFn,
  FirecrawlSpawnKilledError,
  classifyProcessGroupError,
  sliceUtf8AtBoundary,
} from '../src/registry/discovery/sources/firecrawl-crawl.js';
import { resetUserConfig } from '../src/user-config.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpDir: string;
const ENV_KEYS = ['FIRECRAWL_API_KEY'];

function writeConfig(payload: Record<string, unknown>): void {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(payload), 'utf-8');
  resetUserConfig();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'firecrawl-crawl-'));
  setMonadConfigDir(tmpDir);
  for (const k of ENV_KEYS) delete process.env[k];
  resetUserConfig();
  __resetFirecrawlCliCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetMonadConfigDir();
  for (const k of ENV_KEYS) delete process.env[k];
  resetUserConfig();
  __resetFirecrawlCliCache();
});

function stubSpawn(impl: (args: readonly string[], opts: { apiKey: string }) => { status: number | null; stdout?: string; stderr?: string }): FirecrawlSpawnFn {
  return (args, opts) => {
    const out = impl(args, opts);
    return {
      status: out.status,
      stdout: out.stdout ?? '',
      stderr: out.stderr ?? '',
    };
  };
}

/** Put a fake `firecrawl` binary first on PATH so production `defaultSpawnFn` is exercised. */
function installFakeFirecrawl(script: string): () => void {
  const binDir = mkdtempSync(join(tmpdir(), 'fake-firecrawl-bin-'));
  const binPath = join(binDir, 'firecrawl');
  writeFileSync(binPath, script, { encoding: 'utf-8', mode: 0o755 });
  chmodSync(binPath, 0o755);
  const prevPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}${delimiter}${prevPath}`;
  return () => {
    process.env.PATH = prevPath;
    rmSync(binDir, { recursive: true, force: true });
  };
}

describe('firecrawlCrawlSource gates', () => {
  test('missing-api-key when neither user-config nor env set', async () => {
    const result = await firecrawlCrawlSource.run({ cliAvailable: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing-api-key/);
  });

  test('missing-cli when CLI absent (even with key set)', async () => {
    process.env.FIRECRAWL_API_KEY = 'env-key';
    const result = await firecrawlCrawlSource.run({ cliAvailable: false });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing-cli/);
  });

  test('user-config API key wins over env', async () => {
    writeConfig({
      registry: { discovery: { firecrawl: { apiKey: 'config-key' } } },
    });
    process.env.FIRECRAWL_API_KEY = 'env-key';
    let capturedKey: string | null = null;
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn((_args, opts) => {
        capturedKey = opts.apiKey;
        return { status: 0, stdout: JSON.stringify({ models: [] }) };
      }),
    });
    expect(result.ok).toBe(true);
    expect(capturedKey as unknown as string).toBe('config-key');
  });

  test('falls back to env API key when user-config absent', async () => {
    process.env.FIRECRAWL_API_KEY = 'env-key';
    let capturedKey: string | null = null;
    await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn((_args, opts) => {
        capturedKey = opts.apiKey;
        return { status: 0, stdout: JSON.stringify({ models: [] }) };
      }),
    });
    expect(capturedKey as unknown as string).toBe('env-key');
  });
});

describe('firecrawlCrawlSource parse / contract', () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
  });

  test('happy path parses models with auto-firecrawl-crawl meta', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn(() => ({
        status: 0,
        stdout: JSON.stringify({
          models: [
            { id: 'mistral-large-3', provider: 'mistral', contextSize: 128000 },
            { id: 'command-r-plus', provider: 'cohere', displayName: 'Command R+' },
          ],
        }),
      })),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
    expect(result.models[0]!.discoveryMeta.source).toBe('auto-firecrawl-crawl');
    expect(result.models[0]!.discoveryMeta.confidence).toBe('medium');
    expect(result.models[0]!.partial.displayName).toBe('mistral-large-3'); // missing → id
    expect(result.models[1]!.partial.displayName).toBe('Command R+');
  });

  test('filters out providers not in crawl list', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn(() => ({
        status: 0,
        stdout: JSON.stringify({
          models: [
            { id: 'a', provider: 'mistral' },
            { id: 'b', provider: 'openai' },  // not in default list → drop
            { id: 'c', provider: 'groq' },
          ],
        }),
      })),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
    expect(result.models.map(m => m.id).sort()).toEqual(['a', 'c']);
  });

  test('providers override is honoured + passed to prompt', async () => {
    let capturedPrompt: string | null = null;
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      providers: ['mistral', 'cohere'],
      spawnFn: stubSpawn((args) => {
        // args[0] is 'agent', args[1] is the prompt
        capturedPrompt = args[1] ?? null;
        return {
          status: 0,
          stdout: JSON.stringify({
            models: [
              { id: 'm', provider: 'mistral' },
              { id: 'c', provider: 'cohere' },
              { id: 'd', provider: 'deepseek' }, // not in override → drop
            ],
          }),
        };
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
    expect(capturedPrompt).toMatch(/mistral, cohere/);
    expect(capturedPrompt).not.toMatch(/deepseek/);
    const prompt = capturedPrompt ?? '';
    expect(prompt).toContain('{"models": [{"id": "<api-id>", "provider": "<provider>", "displayName": "<label>", "releaseDate": "<YYYY-MM-DD or omit>", "description": "<short or omit>", "contextSize": <integer or omit>, "outputMaxTokens": <integer or omit>}]}');
    expect(prompt).toContain('"id" matches the provider\'s canonical API model id.');
    expect(prompt).toContain('"provider" must be one of the providers in this query.');
    expect(prompt.includes('\\"')).toBe(false);
  });

  test('parses JSON wrapped in code fences', async () => {
    const wrapped = '```json\n' + JSON.stringify({
      models: [{ id: 'p1', provider: 'perplexity' }],
    }) + '\n```';
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn(() => ({ status: 0, stdout: wrapped })),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(1);
  });

  test('non-zero exit code returns upstream-http error', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn(() => ({
        status: 1,
        stderr: 'Error: rate limit exceeded',
      })),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream-http-1/);
    expect(result.error).toMatch(/rate limit/);
  });

  // ⛔ `status: null` 하나로 셋을 접으면 안 된다 — spawn 실패 · abort · 진짜 timeout 이
  //    전부 null 을 낸다. 그 셋을 «가르는» 값이 killReason 이고, 아래 셋이 그것을 «각각» 문다.
  test('null exit with killReason=timeout says timeout', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: (async () => ({ status: null, stdout: '', stderr: '', killReason: 'timeout' as const, treeState: 'exited' as const })) as unknown as FirecrawlSpawnFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream-timeout/);
    expect(result.error).not.toMatch(/still alive/);
  });

  test('null exit with NO killReason is a spawn failure, not a timeout', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn(() => ({ status: null })),
    });
    expect(result.ok).toBe(false);
    // 우리가 안 죽였는데 종료코드가 없다 ⇒ 「시간 초과」라고 말하면 «거짓»이다.
    expect(result.error).toMatch(/upstream-failed/);
    expect(result.error).not.toMatch(/upstream-timeout/);
  });

  test('a process group that outlived SIGKILL is reported, not swallowed', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: (async () => ({ status: null, stdout: '', stderr: '', killReason: 'timeout' as const, treeState: 'alive' as const })) as unknown as FirecrawlSpawnFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream-timeout/);
    // 「죽였다」와 「죽은 것을 확인했다」는 다른 값이다.
    expect(result.error).toMatch(/still alive/);
  });

  // ⛔ 음수 PGID 시그널은 POSIX 규약이다. 지원 안 하는 플랫폼(Windows 등)에서는
  //    kill(-pgid, 0) 이 EINVAL/ENOSYS 로 실패하고, 그것을 「없다」로 접으면
  //    ***후손이 살아 있는데 treeState:'exited' 를 허위 보고***하게 된다.
  //    POSIX 인 이 러너에서 그 플랫폼을 «실물로» 만들 수 없으므로 분류기를 직접 문다.
  // ⛔ 임의 바이트에서 자르면 toString('utf-8') 이 U+FFFD(3바이트)를 «삽입»해
  //    ***저장 바이트가 상한을 넘는다*** — 상한을 지키려던 코드가 상한을 깬다.
  //    위 flood 시험은 ASCII 라 이 경우를 «영영 못 본다». 그래서 경계 함수를 직접 문다.
  // ⛔ 위 전수 시험은 «순수 함수»만 문다. 「생산 경로가 keep.length 를 세나 remaining 을
  //    세나」는 그것으로 안 갈린다 — 작은 cap 을 주입해 «실제 spawn» 으로 잰다.
  //    cap=10 · '가'=3바이트 ⇒ 3자(9바이트)까지만 담기고 10 은 «못» 채운다.
  //    remaining 을 세면 bufferedBytes 가 10 으로 나온다.
  test('production path counts BYTES ACTUALLY STORED, not the budget it meant to use', async () => {
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
trap '' TERM
yes 가가가가가가가가가가
`);
    const prevKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = 'utf8-key';
    try {
      __resetFirecrawlCliCache();
      const result = await firecrawlCrawlSource.run({ maxBufferBytes: 10 });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/upstream-killed/);
      const m = /bufferedBytes=(\d+)/.exec(result.error ?? '');
      expect(m).not.toBeNull();
      // 9 다. 10 이면 「담으려던 양」을 센 것이고 그 값은 거짓이다.
      expect(Number(m?.[1])).toBe(9);
    } finally {
      __resetFirecrawlCliCache();
      if (prevKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = prevKey;
      restore();
    }
  }, 30_000);

  // ⛔ 이 판이 고치는 병이 「상한이 장식이 된다」인데, 내가 더한 씨앗이 cap=0 에서
  //    같은 병을 다시 냈다(조기 return 이 kill 을 영영 안 돌게 했다). 그 자리를 문다.
  test('a zero cap still kills — an unreachable kill is a decorative cap', async () => {
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
trap '' TERM
yes 가가가가가가가가가가
`);
    const prevKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = 'zero-cap-key';
    try {
      __resetFirecrawlCliCache();
      const result = await firecrawlCrawlSource.run({ maxBufferBytes: 0 });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/upstream-killed/);
      expect(result.error).toMatch(/maxBuffer/);
      expect(result.error).toMatch(/bufferedBytes=0/);
    } finally {
      __resetFirecrawlCliCache();
      if (prevKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = prevKey;
      restore();
    }
  }, 30_000);

  test('utf-8 truncation never emits a replacement char nor exceeds the limit', () => {
    // '가' = UTF-8 3바이트. 10자 = 30바이트.
    const buf = Buffer.from('가'.repeat(10), 'utf-8');
    expect(buf.length).toBe(30);
    for (let limit = 0; limit <= 30; limit++) {
      const keep = sliceUtf8AtBoundary(buf, limit);
      const text = keep.toString('utf-8');
      // ⑴ 실제 저장 바이트가 상한을 «절대» 넘지 않는다.
      expect(Buffer.byteLength(text, 'utf-8')).toBeLessThanOrEqual(limit);
      // ⑵ 그리고 그 수가 keep.length 와 «같다» — 즉 bufferedBytes 가 참이다.
      expect(Buffer.byteLength(text, 'utf-8')).toBe(keep.length);
      // ⑶ 치환 문자가 «없다».
      expect(text).not.toContain('\uFFFD');
    }
  });

  test('process-group probe splits three states — «없다» ≠ «못 물어봤다»', () => {
    expect(classifyProcessGroupError('ESRCH')).toBe('exited');
    expect(classifyProcessGroupError('EPERM')).toBe('alive');
    // 아래 셋이 핵심이다. 어느 하나라도 'exited' 로 접히면 허위 보고가 된다.
    expect(classifyProcessGroupError('EINVAL')).toBe('unobservable');
    expect(classifyProcessGroupError('ENOSYS')).toBe('unobservable');
    expect(classifyProcessGroupError(undefined)).toBe('unobservable');
  });

  test('an unobservable process group is reported, not silently called exited', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: (async () => ({ status: null, stdout: '', stderr: '', killReason: 'timeout' as const, treeState: 'unobservable' as const })) as unknown as FirecrawlSpawnFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream-timeout/);
    expect(result.error).toMatch(/could not observe/);
    expect(result.error).toMatch(/descendants may survive/);
  });

  // ⛔ 위 프로브 시험은 --version 경로만 문다. 「진짜 crawl 이 상한에 닿으면
  //    어떻게 되나」는 «생산 경로»로 재야 한다.
  // ⛔ 위 프로브 시험은 --version 경로만 문다. 「진짜 crawl 이 상한에 닿으면 어떻게 되나」는
  //    «생산 경로»로 재야 하고, 「닿은 뒤 읽기를 «멈추나»」는 ***누적 바이트로만*** 잴 수 있다.
  //    무한히 쏟는 자식이어야 한다 — 유한 출력이면 안 멈춰도 총량이 저절로 묶인다.
  test('flooding stdout is killed AND reading stops at the cap (production path)', async () => {
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
# ⛔ SIGTERM 을 «무시»한다. 그래야 유예 250ms 창이 실제로 열리고,
# 「상한에 닿은 뒤에도 계속 읽나」를 잴 수 있다. 즉사하는 자식으로는 못 잰다.
trap '' TERM
yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`);
    const prevKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = 'flood-key';
    try {
      __resetFirecrawlCliCache();
      const result = await firecrawlCrawlSource.run({});
      expect(result.ok).toBe(false);
      // ⑴ 우리가 죽였다 — 네트워크 오류로 보이면 안 된다.
      expect(result.error).toMatch(/upstream-killed/);
      expect(result.error).toMatch(/maxBuffer/);
      expect(result.error).not.toMatch(/upstream-network/);
      // ⑵ 그리고 «상한 근처»에서 멈췄다. 읽기를 안 끊으면 SIGTERM 유예 250ms 동안
      //    계속 쏟아져 이 값이 상한을 훨씬 넘는다.
      const m = /bufferedBytes=(\d+)/.exec(result.error ?? '');
      expect(m).not.toBeNull();
      const buffered = Number(m?.[1]);
      const cap = 10 * 1024 * 1024;
      // 계약은 「상한에 «도달»하면 끊는다」이므로 >= 다(> 가 아니다).
      expect(buffered).toBeGreaterThanOrEqual(cap);
      // ⭐ ASCII 라 경계 되감기가 없어 정확히 cap 이다. 안 끊으면 여기가 GB 단위로 뛴다(실측 1.83e9).
      expect(buffered).toBe(cap);
    } finally {
      __resetFirecrawlCliCache();
      if (prevKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = prevKey;
      restore();
    }
  }, 60_000);

  test('output cap counts BYTES, not UTF-16 code units', async () => {
    // 한글 한 자 = UTF-16 «1 유닛» · UTF-8 «3 바이트». 프로브 캡은 64KiB 다.
    // 30,000 자 ⇒ length 30,000 (캡 아래) · byteLength 90,000 (캡 위).
    //   .length 로 재면      → 안 걸린다 → 프로브가 성공했다고 말한다
    //   Buffer.byteLength 면 → 걸려서 죽는다 → 프로브가 실패로 답한다
    // ⇒ 이 시험은 «두 자를 가른다».
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then
  awk 'BEGIN{ s=""; for(i=0;i<1000;i++) s=s "가"; for(j=0;j<30;j++) print s }'
  exit 0
fi
echo '{"models":[]}'
exit 0
`);
    try {
      __resetFirecrawlCliCache();
      expect(await isFirecrawlCliAvailable()).toBe(false);
    } finally {
      __resetFirecrawlCliCache();
      restore();
    }
  });

  test('an aborted run still reports killReason and a surviving process group', async () => {
    const ac = new AbortController();
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      signal: ac.signal,
      spawnFn: (async () => {
        ac.abort();
        return { status: null, stdout: '', stderr: '', killReason: 'abort' as const, treeState: 'alive' as const };
      }) as unknown as FirecrawlSpawnFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cancelled/);
    // ⛔ 「취소됐다」만 말하고 나머지를 버리면 이 둘이 조용히 사라진다.
    expect(result.error).toMatch(/abort/);
    expect(result.error).toMatch(/process group still alive/);
  });

  test('cancelled before spawn carries no detail — «없다» 와 «버렸다» 는 다르다', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      signal: ac.signal,
      spawnFn: stubSpawn(() => ({ status: 0, stdout: '{"models":[]}' })),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cancelled/);
    expect(result.error).not.toMatch(/process group/);
  });

  test('maxBuffer kill keeps its reason instead of looking like a network fault', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: (() => { throw new FirecrawlSpawnKilledError('maxBuffer', 'exited', 0); }) as unknown as FirecrawlSpawnFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream-killed/);
    expect(result.error).toMatch(/maxBuffer/);
    expect(result.error).not.toMatch(/upstream-network/);
  });

  test('spawn throwing returns upstream-network', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: (() => { throw new Error('ENOENT firecrawl'); }) as FirecrawlSpawnFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream-network/);
    expect(result.error).toMatch(/ENOENT/);
  });

  test('malformed JSON returns ok:true with empty models', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn(() => ({ status: 0, stdout: 'not json at all' })),
    });
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([]);
  });

  test('rejects models missing id or provider', async () => {
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      spawnFn: stubSpawn(() => ({
        status: 0,
        stdout: JSON.stringify({
          models: [
            { id: 'ok1', provider: 'mistral' },
            { provider: 'cohere' },
            { id: 'ok2', provider: 'groq' },
            { id: '', provider: 'deepseek' },
          ],
        }),
      })),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
  });

  test('timeout passed to CLI matches opts.timeoutMs', async () => {
    let capturedArgs: readonly string[] | null = null;
    await firecrawlCrawlSource.run({
      cliAvailable: true,
      timeoutMs: 45_000,
      spawnFn: stubSpawn((args) => {
        capturedArgs = args;
        return { status: 0, stdout: '{"models":[]}' };
      }),
    });
    // args = ['agent', '<prompt>', '--wait', '--timeout', '45']
    expect(capturedArgs).not.toBeNull();
    const t = capturedArgs!.indexOf('--timeout');
    expect(t).toBeGreaterThan(0);
    expect(capturedArgs![t + 1]).toBe('45');
  });
});

describe('firecrawlCrawlSource event-loop + cancellation', () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
  });

  test('timers advance while the production spawn awaits a child process', async () => {
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "firecrawl 0.0.0-test"
  exit 0
fi
sleep 0.4
echo '{"models":[]}'
exit 0
`);
    try {
      let ticks = 0;
      const timer = setInterval(() => { ticks += 1; }, 20);
      const result = await firecrawlCrawlSource.run({
        timeoutMs: 5_000,
      });
      clearInterval(timer);
      expect(result.ok).toBe(true);
      expect(ticks).toBeGreaterThanOrEqual(1);
    } finally {
      restore();
    }
  });

  test('already-aborted signal returns promptly with a cancellation result', async () => {
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    const result = await firecrawlCrawlSource.run({
      cliAvailable: true,
      signal: ac.signal,
      spawnFn: () => {
        throw new Error('spawnFn must not run when already aborted');
      },
    });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cancel/);
    expect(elapsed).toBeLessThan(200);
  });

  test('abort during a running child returns promptly with a cancellation result', async () => {
    const shellPidFile = join(tmpDir, 'child.pid');
    const descendantPidFile = join(tmpDir, 'descendant.pid');
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "firecrawl 0.0.0-test"
  exit 0
fi
echo $$ > ${JSON.stringify(shellPidFile)}
# Grandchild ignores SIGTERM/SIGHUP so a shell-only kill would leak it.
# The parent must SIGKILL the process group before returning.
# $$ inside ( ) is the parent shell on POSIX sh — record $! instead.
( trap '' TERM HUP INT; while true; do sleep 1; done ) &
echo $! > ${JSON.stringify(descendantPidFile)}
# Shell itself exits on SIGTERM; the grandchild stays in the same group.
while true; do sleep 1; done
`);
    try {
      const ac = new AbortController();
      const started = Date.now();
      const pending = firecrawlCrawlSource.run({
        signal: ac.signal,
        timeoutMs: 20_000,
      });
      for (let i = 0; i < 50; i++) {
        if (await Bun.file(descendantPidFile).exists()) break;
        await Bun.sleep(20);
      }
      ac.abort();
      const result = await pending;
      const elapsed = Date.now() - started;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/cancel/);
      expect(elapsed).toBeLessThan(2_000);
      const shellPidText = await Bun.file(shellPidFile).text().catch(() => '');
      const shellPid = Number.parseInt(shellPidText.trim(), 10);
      expect(Number.isFinite(shellPid) && shellPid > 0).toBe(true);
      const descendantPidText = await Bun.file(descendantPidFile).text().catch(() => '');
      const descendantPid = Number.parseInt(descendantPidText.trim(), 10);
      expect(Number.isFinite(descendantPid) && descendantPid > 0).toBe(true);
      expect(descendantPid).not.toBe(shellPid);
      const shellAlive = spawnSync('kill', ['-0', String(shellPid)], { encoding: 'utf-8' });
      expect(shellAlive.status).not.toBe(0);
      const descendantAlive = spawnSync('kill', ['-0', String(descendantPid)], { encoding: 'utf-8' });
      expect(descendantAlive.status).not.toBe(0);
    } finally {
      restore();
    }
  });

  test('timeout escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const shellPidFile = join(tmpDir, 'timeout-child.pid');
    const descendantPidFile = join(tmpDir, 'timeout-descendant.pid');
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "firecrawl 0.0.0-test"
  exit 0
fi
echo $$ > ${JSON.stringify(shellPidFile)}
( trap '' TERM HUP INT; while true; do sleep 1; done ) &
echo $! > ${JSON.stringify(descendantPidFile)}
while true; do sleep 1; done
`);
    try {
      const started = Date.now();
      const result = await firecrawlCrawlSource.run({
        timeoutMs: 200,
      });
      const elapsed = Date.now() - started;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/upstream-timeout/);
      expect(elapsed).toBeLessThan(2_000);
      const shellPidText = await Bun.file(shellPidFile).text().catch(() => '');
      const shellPid = Number.parseInt(shellPidText.trim(), 10);
      expect(Number.isFinite(shellPid) && shellPid > 0).toBe(true);
      const descendantPidText = await Bun.file(descendantPidFile).text().catch(() => '');
      const descendantPid = Number.parseInt(descendantPidText.trim(), 10);
      expect(Number.isFinite(descendantPid) && descendantPid > 0).toBe(true);
      expect(descendantPid).not.toBe(shellPid);
      const shellAlive = spawnSync('kill', ['-0', String(shellPid)], { encoding: 'utf-8' });
      expect(shellAlive.status).not.toBe(0);
      const descendantAlive = spawnSync('kill', ['-0', String(descendantPid)], { encoding: 'utf-8' });
      expect(descendantAlive.status).not.toBe(0);
    } finally {
      restore();
    }
  });

  test('availability probe is async and cached without blocking timers', async () => {
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then
  sleep 0.25
  echo "firecrawl 0.0.0-test"
  exit 0
fi
echo '{"models":[]}'
exit 0
`);
    try {
      let ticks = 0;
      const timer = setInterval(() => { ticks += 1; }, 20);
      const first = await isFirecrawlCliAvailable();
      clearInterval(timer);
      expect(first).toBe(true);
      expect(ticks).toBeGreaterThanOrEqual(1);
      const secondStarted = Date.now();
      const second = await isFirecrawlCliAvailable();
      expect(second).toBe(true);
      expect(Date.now() - secondStarted).toBeLessThan(50);
    } finally {
      restore();
    }
  });

  test('already-aborted signal skips the availability probe entirely', async () => {
    const restore = installFakeFirecrawl(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "probe-ran" >&2
  exit 0
fi
echo '{"models":[]}'
exit 0
`);
    try {
      const ac = new AbortController();
      ac.abort();
      const started = Date.now();
      const result = await firecrawlCrawlSource.run({
        signal: ac.signal,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/cancel/);
      expect(Date.now() - started).toBeLessThan(200);
    } finally {
      restore();
    }
  });
});
