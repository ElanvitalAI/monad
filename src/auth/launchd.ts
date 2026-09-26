// Step 5 PR δ — launchd plist install (macOS only).
//
// PLAN-step5-sdk-zero-env.md §1 D-Phase3-A-2: opt-in supervisor
// wire. `elanous ctl install-launchd` resolves the user's elanous
// binary, generates a plist at
// `~/Library/LaunchAgents/com.elanous.control.plist`, and prints the
// `launchctl load` command for the user to run. Auto-load is
// avoided so the user always confirms the supervised lifecycle.
//
// Linux (systemd) + Windows (Service) variants are stubbed — they
// print a "not yet wired" message + a follow-up issue link. macOS
// is the priority because the dev fleet is mac-heavy.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join as joinPath } from 'node:path';
import { elanousStateRoot } from '../autopilot/state-paths.js';

import { debug } from '../debug/log.js';

export const LAUNCHD_PLIST_LABEL = 'com.elanous.control';
const LAUNCHD_BASENAME = `${LAUNCHD_PLIST_LABEL}.plist`;

export interface LaunchdInstallOpts {
  /** Override the resolved elanous binary path. Production resolves
   *  via `which elanous`; tests pin this. */
  elanousBinaryPath?: string;
  /** Override `~/Library/LaunchAgents/` for tests. */
  launchAgentsDirOverride?: string;
  /** Bind port for the control plane (default 31413). */
  port?: number;
  /** Bind hostname (default 127.0.0.1). */
  hostname?: string;
  /** Stdout/stderr log path (default `~/.elanous/control.log`). */
  logPath?: string;
}

export interface LaunchdInstallResult {
  plistPath: string;
  loadCommand: string;
  unloadCommand: string;
  /** Body of the plist file written. */
  plistBody: string;
}

function resolveElanousBinary(): string {
  // `which elanous` is the user's PATH-resolved binary. If not on
  // PATH, fall back to a sensible dev-checkout marker so the user
  // sees the failure mode instantly.
  try {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const r = spawnSync('which', ['elanous'], { encoding: 'utf-8' });
    if (r.status === 0) {
      const out = r.stdout.trim();
      if (out.length > 0) return out;
    }
  } catch { /* ignore */ }
  return '/usr/local/bin/elanous'; // Homebrew default — works for most users
}

function defaultLogPath(): string {
  // control.log 은 state-family 로그(#5312 control-audit-log 선례) → elanousStateRoot()
  // 로 스코프. prod(ELANOUS_STATE_DIR 부재)=~/.elanous 동치·test 인스턴스는 자기 루트로 격리.
  return joinPath(elanousStateRoot(), 'control.log');
}

/** Generate the plist body. Pure — tests can verify the content
 *  without writing to disk. */
export function generateLaunchdPlist(opts: LaunchdInstallOpts = {}): string {
  const elanous = opts.elanousBinaryPath ?? resolveElanousBinary();
  const port = opts.port ?? 31413;
  const hostname = opts.hostname ?? '127.0.0.1';
  const logPath = opts.logPath ?? defaultLogPath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${elanous}</string>
    <string>ctl</string>
    <string>serve</string>
    <string>--port</string>
    <string>${port}</string>
    <string>--host</string>
    <string>${hostname}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

/** Install the plist (writes the file; does NOT call launchctl
 *  load). Returns paths + the command the user should run next. */
export function installLaunchdPlist(opts: LaunchdInstallOpts = {}): LaunchdInstallResult {
  if (platform() !== 'darwin') {
    throw new Error(`installLaunchdPlist: macOS only (current platform: ${platform()})`);
  }
  const launchAgentsDir = opts.launchAgentsDirOverride
    ?? joinPath(homedir(), 'Library', 'LaunchAgents');
  const plistPath = joinPath(launchAgentsDir, LAUNCHD_BASENAME);

  const body = generateLaunchdPlist(opts);
  if (!existsSync(launchAgentsDir)) {
    mkdirSync(launchAgentsDir, { recursive: true });
  }
  writeFileSync(plistPath, body, { mode: 0o644 });

  const loadCommand = `launchctl load ${plistPath}`;
  const unloadCommand = `launchctl unload ${plistPath}`;
  if (debug.enabled) debug.log('auth.launchd.installed', plistPath);

  return { plistPath, loadCommand, unloadCommand, plistBody: body };
}
