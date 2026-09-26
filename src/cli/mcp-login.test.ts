import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistDiscoveredIssuer } from './mcp-login.js';
import { reloadUserConfig, saveUserConfig } from '../user-config.js';

// 🔴 이 파일이 무는 사고 (2026-09-10 실물):
//
//   `elanous mcp login krea` 가 `✓ credentials saved for 'krea' (https://www.krea.ai)`
//   를 «찍고 exit 0» 했는데, 데몬의 krea 도구 수는 0 이었다. 자격증명 저장소는
//   issuer 를 키로 쓰지만 데몬은 그 issuer 를 오직 config 의
//   `mcp.servers[].oauthIssuer` 에서만 얻고, 로그인은 그 칸을 «안 적었다».
//   사람이 config.json 을 손으로 고쳐야만 이어졌다.
//
// ⛔ 그래서 이 시험은 「함수가 true 를 내나」가 아니라 ***「디스크의 config.json
//    파일에 그 두 줄이 실제로 남나」***를 묻는다 — 그것이 데몬이 읽는 자리다.

function seedConfig(servers: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-login-persist-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify({ mcp: { servers } }, null, 2));
  return path;
}

/** 테스트가 끝나면 캐시를 운영 경로로 되돌린다 — 이 파일이 다음 파일의
 *  config 를 오염시키지 않게. */
function restoreConfigCache(): void {
  reloadUserConfig();
}

describe('persistDiscoveredIssuer', () => {
  test('발견한 issuer/tokenEndpoint 가 디스크 config.json 에 실제로 남는다', () => {
    const path = seedConfig([{ id: 'krea', transport: 'http', url: 'https://api.krea.ai/mcp', enabled: true }]);
    const result = persistDiscoveredIssuer({
      serverId: 'krea',
      issuer: 'https://www.krea.ai',
      tokenEndpoint: 'https://www.krea.ai/auth/v1/oauth/token',
      configPath: path,
    });
    restoreConfigCache();
    expect(result.error).toBeUndefined();
    expect(result.written).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { mcp: { servers: Record<string, unknown>[] } };
    const row = onDisk.mcp.servers.find((s) => s.id === 'krea');
    expect(row?.oauthIssuer).toBe('https://www.krea.ai');
    expect(row?.oauthTokenEndpoint).toBe('https://www.krea.ai/auth/v1/oauth/token');
  });

  test('같은 값이면 다시 쓰지 않는다 (written=false · 오류 아님)', () => {
    const path = seedConfig([{ id: 'krea', transport: 'http', url: 'https://api.krea.ai/mcp', enabled: true, oauthIssuer: 'https://www.krea.ai' }]);
    const result = persistDiscoveredIssuer({ serverId: 'krea', issuer: 'https://www.krea.ai', configPath: path });
    restoreConfigCache();
    expect(result.written).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test('config 에 없는 서버 id 면 이름을 댄 오류를 낸다 (조용히 0 으로 접지 않는다)', () => {
    const path = seedConfig([{ id: 'higgsfield', transport: 'http', url: 'https://x/mcp', enabled: true }]);
    const result = persistDiscoveredIssuer({ serverId: 'krea', issuer: 'https://www.krea.ai', configPath: path });
    restoreConfigCache();
    expect(result.written).toBe(false);
    expect(result.error).toContain('krea');
  });

  // ⭐⭐ 이 시험이 진짜 반증이다 — 되쓰기는 `saveUserConfig` 를 통과해야 하고,
  //     그 함수는 typed 섹션을 raw 에서 «지운다». mcp 가 그 목록에 «들어가면»
  //     이 두 줄이 저장에서 조용히 사라진다. 그때 이 시험이 빨개진다.
  test('saveUserConfig 라운드트립이 oauthIssuer 를 삼키지 않는다', () => {
    const path = seedConfig([{ id: 'krea', transport: 'http', url: 'https://api.krea.ai/mcp', enabled: true, oauthIssuer: 'https://www.krea.ai' }]);
    const cfg = reloadUserConfig(path);
    saveUserConfig(cfg, path);
    restoreConfigCache();
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { mcp?: { servers?: Record<string, unknown>[] } };
    const row = onDisk.mcp?.servers?.find((s) => s.id === 'krea');
    expect(row?.oauthIssuer).toBe('https://www.krea.ai');
  });
});
