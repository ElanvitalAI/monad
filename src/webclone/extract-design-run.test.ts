import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { probeUsableBrowserCdp } from '../browser-cdp/availability.js';
import { debug } from '../debug/log.js';
import { DEFAULT_MIRROR_DEPTH } from './archive-run.js';
import { runExtractDesign } from './extract-design-run.js';

const browser = await probeUsableBrowserCdp();
const browserTest = browser.available ? test : test.skip;
const browserTestName = (name: string) => browser.available ? name : `${name} (skipped: ${browser.note})`;

// ⛔⭐ `mock.module()` 을 «쓰지 않는다»(`.rules/30-harness/testing-gates.md` `R-TST23`).
//   초판은 `mock.module('node:child_process', …)` 로 미러 명령을 갈랐는데, 그 목은 «프로세스 전역»이고
//   `mock.restore()` 로 «안 돌아온다» — 착지 게이트가 그 부채를 세어 «다음 착지»를 막았다(2026-09-09 실물).
//   ⇒ `docs-cli.test.ts` 가 이미 쓰는 처방을 따른다: ***목 대신 주입 심***. 목이 이 파일 밖으로 안 샌다.
const wgetCalls: Array<{ command: string; args: string[] }> = [];
const recordingSpawn = ((command: string, args: string[]) => {
  wgetCalls.push({ command, args });
  return { status: 0 };
}) as unknown as NonNullable<Parameters<typeof runExtractDesign>[0]['spawn']>;

const stopAfterDownloader: NonNullable<Parameters<typeof runExtractDesign>[0]['createBrowser']> = () => {
  throw new Error('stop after downloader argument observation');
};

type LogCall = { category: string; event: string; data?: unknown; options?: unknown };

function captureDebugLog(): { logs: LogCall[]; restore: () => void } {
  const logs: LogCall[] = [];
  const originalLog = debug.log;
  (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown, options?: unknown) => {
    logs.push({ category, event, data, options });
  }) as typeof debug.log;
  return { logs, restore: () => { (debug as { log: typeof debug.log }).log = originalLog; } };
}

describe('runExtractDesign 관측', () => {
  browserTest(browserTestName('성공 시 URL·추출 결과·경과 시간을 done 이벤트로 남긴다'), async () => {
    const root = mkdtempSync(join(tmpdir(), 'webclone-extract-observation-'));
    const page = join(root, 'page.html');
    writeFileSync(page, '<!doctype html><title>observation</title><style>:root { --brand: #112233; }</style><main>ok</main>');
    const { logs, restore } = captureDebugLog();
    try {
      const result = await runExtractDesign({ url: new URL(`file://${page}`).href, outRoot: root, withAssets: false });
      const done = logs.find((log) => log.category === 'webclone.extract' && log.event === 'done');
      expect(done).toBeDefined();
      expect(done?.data).toMatchObject({
        url: new URL(`file://${page}`).href,
        slug: result.slug,
        outRoot: root,
        withAssets: false,
        assetCount: result.assets.length,
        unresolvedCount: result.missingRoles.length,
      });
      expect((done?.data as { elapsedMs: number }).elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      restore();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  browserTest(browserTestName('computed transition 측정값을 tokens.json과 DESIGN.md Motion 절로 전달한다'), async () => {
    const root = mkdtempSync(join(tmpdir(), 'webclone-extract-transitions-'));
    const page = join(root, 'page.html');
    writeFileSync(page, '<!doctype html><title>motion</title><style>.button { transition: color .5s ease; }</style><button class="button">ok</button>');
    try {
      const result = await runExtractDesign({ url: new URL(`file://${page}`).href, outRoot: root, withAssets: false });
      const tokens = JSON.parse(readFileSync(join(result.outDir, 'tokens.json'), 'utf8')) as { transitions: { status: string; elementCount?: number } };
      const design = readFileSync(join(result.outDir, 'DESIGN.md'), 'utf8');
      expect(tokens.transitions.status).toBe('measured');
      expect(tokens.transitions.elementCount).toBeGreaterThan(0);
      expect(design).toContain('계산된 전환이 걸린 요소:');
      expect(design).toContain('길이: 0.5s');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test.each([
    ['www URL', 'https://www.example.co.uk/page', ['www.example.co.uk', 'example.co.uk']],
    ['non-www URL', 'https://example.co.uk/page', ['example.co.uk', 'www.example.co.uk']],
    ['non-URL input', 'not a URL', []],
  ])('자산 미러는 archive 형제 호스트 인자를 실제 wget 호출에 전달한다: %s', async (_name, url, hosts) => {
    const root = mkdtempSync(join(tmpdir(), 'webclone-extract-assets-'));
    wgetCalls.length = 0;
    try {
      await expect(runExtractDesign({
        url, outRoot: root, withAssets: true, spawn: recordingSpawn,
        chrome: () => 'chrome', createBrowser: stopAfterDownloader,
      })).rejects.toThrow('stop after downloader argument observation');
      const wget = wgetCalls.find((call) => call.command === 'wget')!;
      expect(wget.args).toEqual(expect.arrayContaining([
        '--mirror', '-l', String(DEFAULT_MIRROR_DEPTH), '-p', '-k', '-nH', '-q', '-e', 'robots=off',
        '--timeout=30', '--tries=2', '--user-agent=Mozilla/5.0',
        '--restrict-file-names=windows', '-E', url,
      ]));
      if (hosts.length === 0) {
        expect(wget.args).not.toContain('--span-hosts');
        expect(wget.args.some((entry) => entry.startsWith('--domains='))).toBe(false);
        expect(wget.args.some((entry) => entry.startsWith('--accept-regex='))).toBe(false);
      } else {
        expect(wget.args).toContain('--span-hosts');
        expect(wget.args).toContain(`--domains=${hosts.join(',')}`);
        expect(wget.args).toContain(`--accept-regex=^https?://(${hosts.map((host) => host.replace(/\./g, '\\.')).join('|')})(:[0-9]+)?/`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('Chrome 사전 검사가 실패하면 wget과 출력 디렉터리를 만들지 않는다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webclone-extract-chrome-preflight-'));
    wgetCalls.length = 0;
    try {
      await expect(runExtractDesign({
        url: 'https://www.example.co.uk/page', outRoot: root, withAssets: true,
        spawn: recordingSpawn, chrome: () => null,
      })).rejects.toThrow('Chrome 을 못 찾았다');
      expect(wgetCalls).toEqual([]);
      expect([...new Bun.Glob('**/*').scanSync({ cwd: root, onlyFiles: true })]).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  browserTest(browserTestName('withAssets=false면 wget을 부르지 않는다'), async () => {
    const root = mkdtempSync(join(tmpdir(), 'webclone-extract-assets-disabled-'));
    const page = join(root, 'page.html');
    writeFileSync(page, '<!doctype html><title>assets disabled</title><main>ok</main>');
    wgetCalls.length = 0;
    try {
      await runExtractDesign({ url: new URL(`file://${page}`).href, outRoot: root, withAssets: false, spawn: recordingSpawn });
      expect(wgetCalls).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  browserTest(browserTestName('done 로거가 던져도 성공 결과를 반환하고 failed를 남기지 않는다'), async () => {
    const root = mkdtempSync(join(tmpdir(), 'webclone-extract-done-logger-failure-'));
    const page = join(root, 'page.html');
    writeFileSync(page, '<!doctype html><title>done logger failure</title><main>ok</main>');
    const originalLog = debug.log;
    const events: string[] = [];
    (debug as { log: typeof debug.log }).log = ((_category, event) => {
      events.push(event);
      if (event === 'done') throw new Error('logger failed');
    }) as typeof debug.log;
    try {
      const result = await runExtractDesign({ url: new URL(`file://${page}`).href, outRoot: root, withAssets: false });
      expect(result.slug).toBeDefined();
      expect(events).toEqual(['done']);
    } finally {
      (debug as { log: typeof debug.log }).log = originalLog;
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('초기 실패를 failed 이벤트로 남기고 같은 예외를 재전파한다', async () => {
    const { logs, restore } = captureDebugLog();
    const url = 'https://example.invalid/extract-failure';
    const sentinel = new Error('extract sentinel failure');
    const options = {
      url,
      get outRoot(): string { throw sentinel; },
      withAssets: false,
    };
    try {
      const error = await runExtractDesign(options).catch((caught: unknown) => caught);
      expect(error).toBe(sentinel);
      const failed = logs.find((log) => log.category === 'webclone.extract' && log.event === 'failed');
      const loggedError = (failed?.data as { error: unknown }).error;
      expect(typeof loggedError).toBe('string');
      expect(loggedError).toContain(sentinel.message);
      expect(failed?.data).toMatchObject({ url });
      expect(failed?.options).toEqual({ level: 'error' });
    } finally {
      restore();
    }
  });

  test('failed 로거가 던져도 원래 오류를 재전파한다', async () => {
    const originalLog = debug.log;
    let loggedError: unknown;
    (debug as { log: typeof debug.log }).log = ((_category, _event, data) => {
      loggedError = (data as { error: unknown }).error;
      throw new Error('logger failed');
    }) as typeof debug.log;
    try {
      const error = await runExtractDesign({
        url: 'https://example.invalid/extract-logger-failure', outRoot: '/dev/null', withAssets: false,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('ENOTDIR');
      expect(loggedError).toBe(String(error));
    } finally {
      (debug as { log: typeof debug.log }).log = originalLog;
    }
  });
});
