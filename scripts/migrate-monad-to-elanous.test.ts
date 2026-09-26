import { describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planMigration } from './migrate-monad-to-elanous.js';

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'rebrand-home-'));
  mkdirSync(join(home, '.monad', 'bin'), { recursive: true });
  writeFileSync(join(home, '.monad', 'monad.log'), 'x');
  writeFileSync(join(home, '.monad', 'bin', 'monad-backup.sh'), 'x');
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(join(home, 'Library', 'LaunchAgents', 'com.monad.nexus.plist'), '<plist/>');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), '[projects."/src/monad-agent"]\n[mcp_servers.monad]\ncommand = "/h/.monad/bin/monad"\n');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { '/src/monad-agent': { mcpServers: { monad: { command: 'monad', args: ['mcp'] } } } } }));
  return home;
}

describe('migrate monad → elanous (운영 기계 이행)', () => {
  test('드라이런은 아무것도 안 바꾸고 단계만 낸다', () => {
    const home = fakeHome();
    const { steps } = planMigration({ home, launchctl: () => 0, crontab: { read: () => '0 4 * * * cd ~/.local/share/monad-ops/monad-agent && MONAD_STATE_DIR=~/.monad bun bin/monad.mjs x\n', write: () => {} } });
    expect(steps.map((s) => s.name)).toEqual(['launchd-down', 'move', 'state-file', 'state-file', 'rewrite', 'rewrite', 'crontab']);
    expect(existsSync(join(home, '.monad', 'monad.log'))).toBe(true);
  });

  test('적용: 옮기고 옛 자리에 링크 · 파일 이름 · 설정(보호 토큰 유지) · crontab · 백업', () => {
    const home = fakeHome();
    let cron = '';
    const calls: string[] = [];
    const { steps, backupDir } = planMigration({ home, launchctl: (a) => { calls.push(a.join(' ')); return 0; }, crontab: { read: () => 'MONAD_STATE_DIR=~/.monad bun bin/monad.mjs x\n', write: (b) => { cron = b; } } });
    for (const s of steps) s.run();
    expect(calls[0]).toContain('bootout');
    expect(existsSync(join(home, 'Library', 'LaunchAgents', 'com.monad.nexus.plist'))).toBe(false);
    expect(lstatSync(join(home, '.monad')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, '.elanous', 'elanous.log'))).toBe(true);
    expect(existsSync(join(home, '.elanous', 'bin', 'elanous-backup.sh'))).toBe(true);
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[projects."/src/monad-agent"]');   // 보호: 체크아웃 이름
    expect(toml).toContain('[mcp_servers.elanous]');
    expect(toml).toContain('/h/.elanous/bin/elanous');
    const cj = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    expect(cj.projects['/src/monad-agent'].mcpServers.elanous).toEqual({ command: 'elanous', args: ['mcp'] });
    expect(cron).toBe('ELANOUS_STATE_DIR=~/.elanous bun bin/elanous.mjs x\n');
    expect(readdirSync(backupDir).sort()).toEqual(['.claude.json', '.codex__config.toml', 'com.monad.nexus.plist', 'crontab.before'].sort());
    // 재실행: 할 일이 남지 않는다
    expect(planMigration({ home, launchctl: () => 0, crontab: { read: () => cron, write: () => {} } }).steps).toEqual([]);
  });
});

describe('migrate — 새 판 설치 뒤 서비스를 새 이름으로', () => {
  test('--tgz 면 install → launchd-up(개명된 plist) 순서 · 설치 실패면 멈춘다', () => {
    const home = fakeHome();
    const ran: string[] = []; const lc: string[] = [];
    const { steps } = planMigration({ home, tgz: '/x/elanous.tgz', installer: '/new/scripts/install.sh', run: (c, a) => { ran.push([c, ...a].join(' ')); return 0; }, launchctl: (a) => { lc.push(a.join(' ')); return 0; }, crontab: { read: () => null, write: () => {} } });
    const names = steps.map((s) => s.name);
    expect(names.indexOf('move')).toBeLessThan(names.indexOf('install'));
    expect(names.at(-1)).toBe('launchd-up');
    for (const s of steps) s.run();
    expect(ran).toEqual(['bash /new/scripts/install.sh --source /x/elanous.tgz --no-modify-path']);
    expect(readdirSync(join(home, 'Library', 'LaunchAgents'))).toEqual(['com.elanous.nexus.plist']);
    expect(lc.at(-1)).toContain('bootstrap');
    const bad = planMigration({ home: fakeHome(), tgz: '/x.tgz', run: () => 1, launchctl: () => 0, crontab: { read: () => null, write: () => {} } });
    expect(() => { for (const s of bad.steps) s.run(); }).toThrow('설치 실패');
  });
});

describe('migrate — 새 설치가 먼저 깔린 공개 사용자 순서', () => {
  test('설치 폴더가 이미 새 자리에 있으면 옛 설치 폴더는 두고 · 상태 폴더는 옮긴다', () => {
    const home = fakeHome();
    mkdirSync(join(home, '.local', 'share', 'monad'), { recursive: true });
    mkdirSync(join(home, '.local', 'share', 'elanous'), { recursive: true });
    const { steps } = planMigration({ home, launchctl: () => 0, crontab: { read: () => null, write: () => {} } });
    expect(steps.find((s) => s.name === 'keep-old')?.detail).toContain('share/monad');
    expect(steps.some((s) => s.name === 'move' && s.detail.includes('/.monad →'))).toBe(true);
    for (const s of steps) s.run();
    expect(existsSync(join(home, '.local', 'share', 'monad'))).toBe(true);
    expect(lstatSync(join(home, '.monad')).isSymbolicLink()).toBe(true);
  });
});
