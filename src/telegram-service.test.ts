import { describe, expect, test } from 'bun:test';
import { renderTelegramServiceFile, telegramRunCommand, TELEGRAM_LAUNCHD_LABEL } from './telegram-service.js';

describe('telegram service definition (print only)', () => {
  test('the command runs `telegram run` from the stable installed path, not a version folder', () => {
    const cmd = telegramRunCommand('/usr/bin/bun', '/h/.local/share/monad/versions/1.0.0-abc/node_modules/monadagent/bin/monad.mjs', () => true);
    expect(cmd).toEqual(['/usr/bin/bun', '/h/.local/share/monad/current/node_modules/monadagent/bin/monad.mjs', 'telegram', 'run']);
  });

  test('darwin renders a launchd plist with its own label beside the nexus one, and names the enable command', () => {
    const f = renderTelegramServiceFile({ platform: 'darwin', home: '/h', logDir: '/h/.monad/logs', command: ['/usr/bin/bun', '/x/monad.mjs', 'telegram', 'run'], uid: 501 })!;
    expect(f.path).toBe('/h/Library/LaunchAgents/com.monad.telegram.plist');
    expect(f.content).toContain(`<string>${TELEGRAM_LAUNCHD_LABEL}</string>`);
    expect(f.content).toContain('<string>telegram</string>');
    expect(f.content).toContain('<string>run</string>');
    expect(f.content).toContain('/h/.monad/logs/telegram-run.err.log');
    expect(f.enable).toEqual(['launchctl bootstrap gui/501 /h/Library/LaunchAgents/com.monad.telegram.plist']);
  });

  test('linux renders a user systemd unit', () => {
    const f = renderTelegramServiceFile({ platform: 'linux', home: '/h', command: ['/usr/bin/bun', '/x/monad.mjs', 'telegram', 'run'] })!;
    expect(f.path).toBe('/h/.config/systemd/user/monad-telegram.service');
    expect(f.content).toContain('ExecStart=/usr/bin/bun /x/monad.mjs telegram run');
    expect(f.enable.at(-1)).toBe('systemctl --user enable --now monad-telegram.service');
  });

  test('other platforms have no definition', () => {
    expect(renderTelegramServiceFile({ platform: 'win32', home: 'C:/h', command: ['x'] })).toBeNull();
  });
});
