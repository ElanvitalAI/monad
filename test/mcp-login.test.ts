import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { runMcpLogin } from '../src/cli/mcp-login.js';
import {
  mcpOAuthStorePath,
  type McpOAuthFetch,
} from '../src/mcp/mcp-oauth.js';
import { loadTokens } from '../src/oauth/store.js';

const ENDPOINT = 'https://mcp.example.test/mcp';
const RESOURCE = 'https://auth.example.test/resource';
const ISSUER = 'https://auth.example.test';
const AUTHORIZE = 'https://auth.example.test/authorize';
const TOKEN = 'https://auth.example.test/token';
const REGISTER = 'https://auth.example.test/register';
const dirs: string[] = [];
const prevStateDir = process.env.MONAD_STATE_DIR;
const prevXdg = process.env.XDG_CONFIG_HOME;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (prevStateDir === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = prevStateDir;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
});

function isolated(): void {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-login-'));
  dirs.push(dir);
  // ⛔ MCP 자격은 전역 자격 파일(authStorePath)에 간다 — XDG 로 tmp 에 못 박는다.
  process.env.XDG_CONFIG_HOME = join(dir, 'config');
  process.env.MONAD_STATE_DIR = join(dir, 'universe');
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function oauthFetch(counts: { register: number; token: number }): McpOAuthFetch {
  return async (url, init) => {
    if (url === ENDPOINT) return new Response('', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${RESOURCE}", scope="mcp:tools"` } });
    if (url === RESOURCE) return json(200, { resource: ENDPOINT, authorization_servers: [ISSUER] });
    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, { issuer: ISSUER, authorization_endpoint: AUTHORIZE, token_endpoint: TOKEN, registration_endpoint: REGISTER, code_challenge_methods_supported: ['S256'] });
    if (url === REGISTER) { counts.register += 1; return json(201, { client_id: 'client-id', client_secret: 'client-secret' }); }
    if (url === TOKEN) { counts.token += 1; return json(200, { access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600 }); }
    throw new Error(`unexpected ${url} ${init?.method ?? 'GET'}`);
  };
}

function config(servers: unknown[]) {
  return () => ({ mcp: { servers: servers as never[] } });
}

function out() {
  const logs: string[] = []; const errors: string[] = [];
  return { logs, errors, sink: { log: (line: string) => logs.push(line), error: (line: string) => errors.push(line) } };
}

describe('runMcpLogin', () => {
  test('unknown and stdio servers fail before any network request', async () => {
    let calls = 0;
    const missing = await runMcpLogin({ serverId: 'missing', out: out().sink, readConfigFn: config([]), fetch: async () => { calls += 1; return json(500, {}); } });
    const stdio = await runMcpLogin({ serverId: 'local', out: out().sink, readConfigFn: config([{ id: 'local', transport: 'stdio', command: ['x'] }]), fetch: async () => { calls += 1; return json(500, {}); } });
    expect(missing.exitCode).toBe(1); expect(stdio.exitCode).toBe(1); expect(calls).toBe(0);
  });

  test('loopback bind errors reject before the MCP request', async () => {
    let calls = 0;
    const result = await runMcpLogin({
      serverId: 'remote',
      out: out().sink,
      readConfigFn: config([{ id: 'remote', transport: 'http', url: ENDPOINT }]),
      fetch: async () => { calls += 1; return json(500, {}); },
      createListener: (handler) => {
        const server = createServer(handler);
        server.listen = ((..._args: unknown[]) => {
          queueMicrotask(() => server.emit('error', new Error('port already in use')));
          return server;
        }) as typeof server.listen;
        return server;
      },
    });
    expect(result.exitCode).toBe(1);
    expect(calls).toBe(0);
  });

  test('401-derived metadata builds S256 state and redirect, browser failure falls back, then saves without secrets in output', async () => {
    isolated();
    const counts = { register: 0, token: 0 }; const captured = out();
    let authorizationUrl = '';
    const result = await runMcpLogin({
      serverId: 'remote', out: captured.sink, readConfigFn: config([{ id: 'remote', transport: 'http', url: ENDPOINT }]), fetch: oauthFetch(counts),
      openBrowser: async (url) => {
        authorizationUrl = url;
        const state = new URL(url).searchParams.get('state')!;
        const redirect = new URL(url).searchParams.get('redirect_uri')!;
        await fetch(`${redirect}?code=code-1&state=${encodeURIComponent(state)}`);
        throw new Error('no browser');
      },
    });
    expect(result.exitCode).toBe(0); expect(counts).toEqual({ register: 1, token: 1 });
    const params = new URL(authorizationUrl).searchParams;
    expect(params.get('code_challenge_method')).toBe('S256'); expect(params.get('state')).toBeTruthy(); expect(params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    expect(captured.errors.join('\n')).toContain('manually');
    expect([...captured.logs, ...captured.errors].join('\n')).not.toContain('access-secret');
    expect([...captured.logs, ...captured.errors].join('\n')).not.toContain('refresh-secret');
    expect([...captured.logs, ...captured.errors].join('\n')).not.toContain('client-secret');
    // ⛔⭐⭐ 「저장했다」를 «호출 횟수»로 세지 않는다 — 저장소를 «다시 읽어» 단언한다.
    //    리뷰 must-fix: 이 시험의 이름이 "saves" 인데 그 주장을 검증하는 줄이 없었다.
    //    ⊕ 열쇠가 «발급자 식별자»라는 계약도 여기서 같이 물린다.
    const stored = loadTokens(ISSUER, mcpOAuthStorePath());
    expect(stored?.tokens.accessToken).toBe('access-secret');
    expect(stored?.tokens.refreshToken).toBe('refresh-secret');
    expect(stored?.authMode).toBe('mcp-oauth');
    // ⛔ 저장 위치는 «우주 밖» 전역 자격 파일이다(격리 매뉴얼 §6).
    expect(mcpOAuthStorePath().startsWith(process.env.XDG_CONFIG_HOME!)).toBe(true);
    expect(mcpOAuthStorePath().startsWith(process.env.MONAD_STATE_DIR!)).toBe(false);
  });

  test('⭐⭐ 기대 state 가 정해지기 «전»에 도착한 콜백도 유실되지 않는다', async () => {
    isolated();
    const captured = out();
    // ⛔ 경합을 «진짜로» 만든다. `wait()` 는 인가 요청 조립 «뒤»에 불리므로,
    //    그 조립 «중»인 동적 등록 시점에 콜백을 쏘면 기대 state 가 아직 없다.
    //    등록 요청 본문에 redirect_uris 가 실려 오므로 그 주소를 여기서 얻는다.
    //    ⚠️ state 는 아직 세상에 없다 — 그래서 «틀린» state 를 쏘고, 그 값이
    //    나중에 대조돼 «실패»로 끝나는 것이 옳은 동작이다(성공으로 뭉개지면 안 된다).
    let earlyFired = false;
    const fetchSeam: McpOAuthFetch = async (url, init) => {
      if (url === ENDPOINT) return new Response('', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${RESOURCE}", scope="mcp:tools"` } });
      if (url === RESOURCE) return json(200, { resource: ENDPOINT, authorization_servers: [ISSUER] });
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, { issuer: ISSUER, authorization_endpoint: AUTHORIZE, token_endpoint: TOKEN, registration_endpoint: REGISTER, code_challenge_methods_supported: ['S256'] });
      if (url === REGISTER) {
        const redirect = (JSON.parse(init?.body ?? '{}') as { redirect_uris?: string[] }).redirect_uris?.[0];
        if (redirect) { earlyFired = true; await fetch(`${redirect}?code=code-1&state=stale-state`); }
        return json(201, { client_id: 'client-id', client_secret: 'client-secret' });
      }
      if (url === TOKEN) return json(200, { access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600 });
      throw new Error(`unexpected ${url}`);
    };
    const result = await runMcpLogin({
      serverId: 'remote', out: captured.sink,
      readConfigFn: config([{ id: 'remote', transport: 'http', url: ENDPOINT }]),
      fetch: fetchSeam,
      openBrowser: async () => undefined,
      timeoutMs: 2000,
    });
    expect(earlyFired).toBe(true);
    // ⛔ 담아 두지 않으면 그 요청은 유실되어 «타임아웃» 문면으로 끝난다.
    //    담아 두면 나중에 대조되어 «state 불일치»로 끝난다 — 그 갈림을 여기서 센다.
    expect(result.exitCode).toBe(1);
    expect(captured.errors.join('\n')).toContain('state does not match');
    expect(captured.errors.join('\n')).not.toContain('timed out');
  });

  test('state mismatch, OAuth callback error, and timeout fail and close the loopback listener', async () => {
    for (const mode of ['mismatch', 'oauth-error', 'timeout'] as const) {
      isolated();
      const counts = { register: 0, token: 0 }; let redirect = '';
      const result = await runMcpLogin({
        serverId: 'remote', timeoutMs: 15, out: out().sink, readConfigFn: config([{ id: 'remote', transport: 'http', url: ENDPOINT }]), fetch: oauthFetch(counts),
        openBrowser: async (url) => {
          redirect = new URL(url).searchParams.get('redirect_uri')!;
          if (mode === 'mismatch') await fetch(`${redirect}?code=x&state=wrong`);
          if (mode === 'oauth-error') await fetch(`${redirect}?error=access_denied`);
        },
      });
      expect(result.exitCode).toBe(1); expect(counts.token).toBe(0);
      if (redirect) await expect(fetch(redirect)).rejects.toBeDefined();
    }
  });
});
