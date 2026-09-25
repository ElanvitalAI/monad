import { describe, expect, test } from 'bun:test';
import { auxiliaryAiEnvNotice, renderAuxiliaryAiEnvNotice } from './launchd.js';

describe('auxiliaryAiEnvNotice', () => {
  test('reports only names and uses for auxiliary keys that launchd does not carry', () => {
    const secret = 'auxiliary-secret-must-not-appear';
    const notice = auxiliaryAiEnvNotice({
      FIRECRAWL_API_KEY: secret,
      ELEVENLABS_API_KEY: secret,
    });

    expect(notice).toEqual({
      vars: [
        { name: 'FIRECRAWL_API_KEY', usedBy: 'web-search' },
        { name: 'ELEVENLABS_API_KEY', usedBy: 'voice TTS' },
      ],
    });
    const output = renderAuxiliaryAiEnvNotice(notice!);
    const rendered = output.join('\n');
    expect(rendered).toContain('2 auxiliary AI keys');
    expect(rendered).toContain('FIRECRAWL_API_KEY (web-search)');
    expect(rendered).toContain('ELEVENLABS_API_KEY (voice TTS)');
    expect(rendered).toContain('not added to the launchd plist, so the daemon cannot access them');
    expect(rendered).toContain('Review each integration’s supported setup');
    expect(rendered).not.toContain('monad config');
    expect(JSON.stringify(notice)).not.toContain(secret);
    expect(rendered).not.toContain(secret);
  });

  test('is silent when no auxiliary keys are in the shell environment', () => {
    expect(auxiliaryAiEnvNotice({})).toBeUndefined();
  });
});

// 🆕 2026-09-24 — 서비스 파일이 판 폴더가 아니라 current 를 가리킨다.
import { nexusRunCommand, stableInstalledScriptPath } from './launchd.js';
describe('nexusRunCommand — stable installed path', () => {
  const ver = '/home/u/.local/share/monad/versions/1.0.0-abc/node_modules/monadagent/bin/monad.mjs';
  const cur = '/home/u/.local/share/monad/current/node_modules/monadagent/bin/monad.mjs';
  test('a version-dir script maps to current when current exists', () => {
    expect(stableInstalledScriptPath(ver, (p) => p === cur)).toBe(cur);
    expect(nexusRunCommand('/b/bun', ver, (p) => p === cur)).toEqual(['/b/bun', cur, 'nexus', 'run']);
  });
  test('stays on the version path when current is absent; checkout paths unchanged', () => {
    expect(stableInstalledScriptPath(ver, () => false)).toBe(ver);
    expect(stableInstalledScriptPath('/src/pilot/bin/monad.mjs', () => true)).toBe('/src/pilot/bin/monad.mjs');
  });
  test('falls back to bare monad only without an interpreter or script', () => {
    expect(nexusRunCommand('', ver)).toEqual(['monad', 'nexus', 'run']);
    expect(nexusRunCommand('/b/bun', '')).toEqual(['monad', 'nexus', 'run']);
  });
});

import { defaultServiceWorkingDirectory } from './launchd.js';
// 🩸 09-26: 운영 plist 의 WorkingDirectory 가 사람 작업 트리(pilot)였다 — 설치본에서 install 했는데 cwd 가 박혔다.
describe('defaultServiceWorkingDirectory — installed copy uses home, a checkout keeps its tree', () => {
  test('installed (versions/<v> or current) → home · checkout → cwd · unknown argv → cwd', () => {
    const home = '/Users/u';
    const cwd = '/Users/u/work/checkout';
    expect(defaultServiceWorkingDirectory('/Users/u/.local/share/monad/versions/0.1.1-abc/node_modules/monadagent/bin/monad.mjs', cwd, home)).toBe(home);
    expect(defaultServiceWorkingDirectory('/Users/u/.local/share/monad/current/node_modules/monadagent/bin/monad.mjs', cwd, home)).toBe(home);
    expect(defaultServiceWorkingDirectory('/Users/u/work/checkout/bin/monad.mjs', cwd, home)).toBe(cwd);
    expect(defaultServiceWorkingDirectory(undefined, cwd, home)).toBe(cwd);
  });
});
