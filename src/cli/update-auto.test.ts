import { describe, expect, test } from 'bun:test';
import { cronSelfUpdateLines, renderUpdatePlist, renderUpdateUnits, runAutoUpdate, updateCommand, type AutoUpdateDeps } from './update-auto.js';

const CMD = ['/Users/u/.bun/bin/bun', '/Users/u/.local/share/elanous/current/node_modules/elanous/bin/elanous.mjs', 'self-update', '--restart', '--alert'];

function rig(platform: NodeJS.Platform, crontab: string | null = '') {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const lines: string[] = [];
  const deps: AutoUpdateDeps = {
    platform, home: '/Users/u', uid: 501, command: CMD,
    exists: (p) => files.has(p),
    write: (p, b) => { files.set(p, b); },
    remove: (p) => { files.delete(p); },
    runCli: async (cmd) => { calls.push(cmd.join(' ')); return { stdout: '', stderr: '', exitCode: 0 }; },
    readCrontab: () => crontab,
    log: (l) => lines.push(l),
  };
  return { deps, files, calls, lines };
}

describe('elanous update --auto (09-26 request)', () => {
  test('the scheduled command is bun + this elanous + self-update --restart --alert', () => {
    const c = updateCommand();
    expect(c.slice(-3)).toEqual(['self-update', '--restart', '--alert']);
    expect(c).not.toContain('nexus');
  });

  test('plist runs daily 04:17 from home; systemd timer is persistent with a random delay', () => {
    const plist = renderUpdatePlist(CMD, '/Users/u', '/Users/u/.elanous/logs/self-update-auto.log');
    expect(plist).toContain('<string>com.elanous.update</string>');
    expect(plist).toContain('<key>Hour</key>\n    <integer>4</integer>');
    expect(plist).toContain('<string>self-update</string>');
    expect(plist).toContain('<key>WorkingDirectory</key>\n  <string>/Users/u</string>');
    const units = renderUpdateUnits(['/home/u/.bun/bin/bun', '/home/u/a b/elanous.mjs', 'self-update'], '/home/u');
    expect(units.service).toContain('ExecStart=/home/u/.bun/bin/bun "/home/u/a b/elanous.mjs" self-update');
    expect(units.timer).toContain('OnCalendar=*-*-* 04:17:00');
    expect(units.timer).toContain('Persistent=true');
  });

  test('on: macOS writes the agent and bootstraps it; off removes it', async () => {
    const r = rig('darwin');
    expect((await runAutoUpdate('on', r.deps)).exitCode).toBe(0);
    expect([...r.files.keys()]).toEqual(['/Users/u/Library/LaunchAgents/com.elanous.update.plist']);
    expect(r.calls).toContain('launchctl bootstrap gui/501 /Users/u/Library/LaunchAgents/com.elanous.update.plist');
    expect((await runAutoUpdate('status', r.deps)).schedulers).toEqual(['launchd /Users/u/Library/LaunchAgents/com.elanous.update.plist']);
    expect((await runAutoUpdate('off', r.deps)).exitCode).toBe(0);
    expect(r.files.size).toBe(0);
  });

  test('on: Linux writes service + timer and enables the timer; off disables and removes both', async () => {
    const r = rig('linux');
    r.deps.home = '/home/u';
    expect((await runAutoUpdate('on', r.deps)).exitCode).toBe(0);
    expect([...r.files.keys()].sort()).toEqual(['/home/u/.config/systemd/user/elanous-update.service', '/home/u/.config/systemd/user/elanous-update.timer']);
    expect(r.calls).toContain('systemctl --user enable --now elanous-update.timer');
    await runAutoUpdate('off', r.deps);
    expect(r.files.size).toBe(0);
    expect(r.calls).toContain('systemctl --user disable --now elanous-update.timer');
  });

  test('on refuses when cron already runs self-update (the operating mac) and names the line; status shows it', async () => {
    const cron = '# 33 4 * * * old\n33 4 * * * cd /ops && bun bin/elanous.mjs self-update --restart --alert >> /tmp/x.log 2>&1\n';
    expect(cronSelfUpdateLines(cron)).toHaveLength(1);
    const r = rig('darwin', cron);
    expect((await runAutoUpdate('on', r.deps)).exitCode).toBe(1);
    expect(r.files.size).toBe(0);
    expect(r.lines.join('\n')).toContain('이미 크론이 self-update 를 부른다');
    expect((await runAutoUpdate('status', r.deps)).schedulers[0]).toStartWith('cron 33 4 * * *');
  });

  test('unsupported platforms say so with rc 2', async () => {
    const r = rig('win32');
    expect((await runAutoUpdate('on', r.deps)).exitCode).toBe(2);
    expect(r.files.size).toBe(0);
  });
});
