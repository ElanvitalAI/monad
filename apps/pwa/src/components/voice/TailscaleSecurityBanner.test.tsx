import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import React from 'react';
import { renderToString } from 'react-dom/server';

import { discoverChromeBinary } from '../../../../../src/browser-cdp/client';
import { TailscaleSecurityBanner } from './TailscaleSecurityBanner';
import type { SecureContextStatus } from '@/lib/secure-context-guard';

const DISMISS_SESSION_KEY = 'elanous.webterm.voiceBanner.dismissed';
const require = createRequire(import.meta.url);
const REACT_ENTRY = require.resolve('react');
const REACT_DOM_CLIENT_ENTRY = require.resolve('react-dom/client');
const temp = mkdtempSync(join(tmpdir(), 'elanous-voice-banner-hydration-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const CHROME = discoverChromeBinary();
const TERMINAL_PANEL_SOURCE = readFileSync(join(import.meta.dir, '../terminal/TerminalPanel.tsx'), 'utf8');
const insecureTailscale: SecureContextStatus = {
  isSecure: false,
  reason: 'http-tailscale',
  hostname: '100.64.1.5',
  protocol: 'http:',
  guidance: 'Tailscale HTTP requires HTTPS.',
};
const secureLocalhost: SecureContextStatus = {
  isSecure: true,
  reason: 'localhost',
  hostname: 'localhost',
  protocol: 'http:',
};
const Banner = TailscaleSecurityBanner as React.ComponentType<{ statusOverride?: SecureContextStatus }>;

const clientSource = `
  import React from ${JSON.stringify(REACT_ENTRY)};
  import { hydrateRoot } from ${JSON.stringify(REACT_DOM_CLIENT_ENTRY)};
  import { TailscaleSecurityBanner } from ${JSON.stringify(join(import.meta.dir, 'TailscaleSecurityBanner.tsx'))};

  const config = JSON.parse(document.body.dataset.config || '{}');
  const errors = [];
  const recordError = error => errors.push(String(error));
  window.addEventListener('error', event => recordError(event.error || event.message));
  window.addEventListener('unhandledrejection', event => recordError(event.reason));
  document.body.dataset.initial = encodeURIComponent(JSON.stringify(snapshot()));
  if (config.storedDismissal) sessionStorage.setItem(${JSON.stringify(DISMISS_SESSION_KEY)}, '1');
  if (config.failStorageRead) {
    const getItem = Storage.prototype.getItem;
    let shouldThrow = true;
    Object.defineProperty(Storage.prototype, 'getItem', {
      configurable: true,
      value(key) {
        if (shouldThrow && key === ${JSON.stringify(DISMISS_SESSION_KEY)}) {
          shouldThrow = false;
          throw new Error('blocked');
        }
        return getItem.call(this, key);
      },
    });
  }
  hydrateRoot(document.getElementById('root'), React.createElement(TailscaleSecurityBanner, config.status ? { statusOverride: config.status } : undefined), {
    onRecoverableError: recordError,
  });
  setTimeout(() => {
    if (config.dismiss) document.querySelector('button[aria-label="dismiss banner"]')?.click();
    setTimeout(() => {
      document.body.dataset.result = encodeURIComponent(JSON.stringify({ ...snapshot(), errors }));
    }, 0);
  }, 100);

  function snapshot() {
    const banner = document.querySelector('[data-testid="webterm-voice-banner"]');
    return {
      banner: Boolean(banner),
      role: banner?.getAttribute('role') || '',
      reason: banner?.getAttribute('data-reason') || '',
      text: banner?.textContent || '',
      persisted: sessionStorage.getItem(${JSON.stringify(DISMISS_SESSION_KEY)}) || '',
    };
  }
`;
const clientEntry = join(temp, 'client.tsx');
writeFileSync(clientEntry, clientSource);
const build = await Bun.build({ entrypoints: [clientEntry], outdir: temp, target: 'browser', minify: true });
if (!build.success) throw new Error(build.logs.map((entry) => entry.message).join('\n'));
const bundle = Bun.file(join(temp, 'client.js'));

type BrowserResult = {
  initial: string;
  result: {
    banner: boolean;
    role: string;
    reason: string;
    text: string;
    persisted: string;
    errors: string[];
  };
};

async function visit(config: Record<string, unknown>, element: React.ReactElement): Promise<BrowserResult> {
  if (!CHROME) throw new Error('Browser hydration test requires ELANOUS_CHROME_BIN or Chrome/Chromium');
  const html = `<!doctype html><html><body data-config="${encodeURIComponent(JSON.stringify(config))}"><div id="root">${renderToString(element)}</div><script>document.body.dataset.config=decodeURIComponent(document.body.dataset.config)</script><script src="/client.js"></script></body></html>`;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === '/client.js'
        ? new Response(bundle)
        : new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
  // ⛔⭐ 키체인을 «건드리지 않게» 띄운다 (2026-08-27 실측 · 값을 치르고 얻은 조합).
  //    ⓐ 왜 필요한가 — 이 스폰이 그냥 뜨면 Chrome 이 쿠키 암호화용 `Chrome Safe Storage` 를
  //       macOS 로그인 키체인에서 찾는다. 시험은 GUI 세션에 «안 붙은» 셸에서 도므로 그 조회가
  //       실패하고, 사람 화면에 ***「Keychain Not Found — A keychain cannot be found to store "Chrome."」***
  //       모달이 뜬다. 시험을 반복해 돌리면 그 창이 «반복해서» 뜬다(실물: pwa 이분 탐색 중 계속 떴다).
  //       ⛔ 그 창의 「Reset To Defaults」를 누르면 안 된다 — `Chrome Safe Storage` 는 «Chrome 전체가
  //       공유»하는 단일 항목이라, 사람이 평소 쓰는 Chrome 의 저장된 비밀번호·쿠키 암호키가 무효가 된다.
  //    ⓑ ⛔ `--user-data-dir` 를 «쓰지 마라» — 그것이 「더 격리되니 더 안전하다」로 보이지만,
  //       실측하면 이 조합에서 ***40초를 넘겨 매달린다***(시험 시한은 15초라 전부 빨강이 된다).
  //       재사용해도 같다 — 프로파일 «생성 비용»이 아니라 그 플래그 자체다.
  //       📏 같은 기계 · 같은 명령: 기본 1,577ms / `--user-data-dir` 40,131ms /
  //          `--password-store=basic` 1,895ms / `--use-mock-keychain` 1,752ms
  try {
    const process = Bun.spawn([
      CHROME, '--headless=new', '--disable-gpu', '--no-first-run',
      '--password-store=basic', '--use-mock-keychain',
      '--virtual-time-budget=1000', '--dump-dom', `http://localhost:${server.port}/`,
    ], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(process.stdout).text();
    await process.exited;
    const initial = output.match(/data-initial="([^"]*)"/)?.[1];
    const result = output.match(/data-result="([^"]*)"/)?.[1];
    if (!initial || !result) throw new Error('browser hydration result was not captured');
    return { initial: JSON.parse(decodeURIComponent(initial)), result: JSON.parse(decodeURIComponent(result)) };
  } finally {
    server.stop(true);
  }
}

function browserTest(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    if (!CHROME) throw new Error('Browser hydration test requires ELANOUS_CHROME_BIN or Chrome/Chromium');
    await fn();
  }, { timeout: 15_000 });
}

describe('TailscaleSecurityBanner SSR and hydration behavior', () => {
  test('is reached from TerminalPanel', () => {
    expect(TERMINAL_PANEL_SOURCE).toContain("import { TailscaleSecurityBanner } from '@/components/voice/TailscaleSecurityBanner'");
    expect(TERMINAL_PANEL_SOURCE).toContain('<TailscaleSecurityBanner />');
  });

  test('SSR renders insecure Tailscale guidance with the preserved role and reason', () => {
    const html = renderToString(React.createElement(Banner, { statusOverride: insecureTailscale }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="webterm-voice-banner"');
    expect(html).toContain('data-reason="http-tailscale"');
    expect(html).toContain('🎙 Tailscale HTTP 에서 마이크가 차단됩니다');
    expect(html).toContain('Tailscale HTTP requires HTTPS.');
    expect(html).toContain('tailscale serve --bg --https=443 31415');
  });

  browserTest('hydrates matching SSR markup without recoverable or uncaught errors and retains guidance', async () => {
    const { initial, result } = await visit({ status: insecureTailscale }, React.createElement(Banner, { statusOverride: insecureTailscale }));
    expect(initial).toMatchObject({ banner: true, role: 'alert', reason: 'http-tailscale' });
    expect(result).toMatchObject({ banner: true, role: 'alert', reason: 'http-tailscale', errors: [] });
    expect(result.text).toContain('🎙 Tailscale HTTP 에서 마이크가 차단됩니다');
    expect(result.text).toContain('Tailscale HTTP requires HTTPS.');
  });

  browserTest('uses the live localhost secure-context check only after matching the override-free SSR banner', async () => {
    const { initial, result } = await visit({}, React.createElement(Banner));
    expect(initial).toMatchObject({ banner: true, role: 'alert', reason: 'unknown' });
    expect(result).toMatchObject({ banner: false, errors: [] });
  });

  browserTest('reflects a stored dismissal only after hydration while SSR initially renders the banner', async () => {
    const { initial, result } = await visit({ status: insecureTailscale, storedDismissal: true }, React.createElement(Banner, { statusOverride: insecureTailscale }));
    expect(initial).toMatchObject({ banner: true, role: 'alert', reason: 'http-tailscale' });
    expect(result).toMatchObject({ banner: false, persisted: '1', errors: [] });
  });

  browserTest('dismisses through a user click and persists the established session key', async () => {
    const { result } = await visit({ status: insecureTailscale, dismiss: true }, React.createElement(Banner, { statusOverride: insecureTailscale }));
    expect(result).toMatchObject({ banner: false, persisted: '1', errors: [] });
  });

  browserTest('continues rendering when the dismissal storage read throws', async () => {
    const { result } = await visit({ status: insecureTailscale, failStorageRead: true }, React.createElement(Banner, { statusOverride: insecureTailscale }));
    expect(result).toMatchObject({ banner: true, role: 'alert', reason: 'http-tailscale', errors: [] });
  });

  browserTest('hides when a secure status is synchronized after hydration', async () => {
    const { initial, result } = await visit({ status: secureLocalhost }, React.createElement(Banner, { statusOverride: secureLocalhost }));
    expect(initial).toMatchObject({ banner: false });
    expect(result).toMatchObject({ banner: false, errors: [] });
  });
});
