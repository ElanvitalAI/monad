import { describe, expect, test } from 'bun:test';
import { posixShellHint, requirePosixShell, requirePosixShellCommand, resolvePosixShell } from './default-shell.js';

describe('resolvePosixShell', () => {
  test('chooses Git for Windows instead of the System32 WSL launcher', () => {
    const path = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const result = resolvePosixShell({
      platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, gitExecPath: () => undefined,
      existsSync: (candidate) => candidate === path || candidate === 'C:\\Windows\\System32\\bash.exe',
    });
    expect(result).toEqual({ found: true, path });
    expect(requirePosixShellCommand('/bin/sh', { platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, gitExecPath: () => undefined,
      existsSync: (candidate) => candidate === path || candidate === 'C:\\Windows\\System32\\bash.exe' })).toBe(path);
    expect(result.found && result.path).not.toContain('System32');
  });

  test('honors explicit Git Bash first but never accepts a System32 override', () => {
    const path = 'D:\\Git\\bin\\bash.exe';
    const deps = { platform: 'win32' as const, env: { ELANOUS_GIT_BASH_PATH: path, ProgramFiles: 'C:\\Program Files' },
      gitExecPath: () => { throw new Error('git lookup must not run for an explicit path'); }, existsSync: () => true };
    expect(resolvePosixShell(deps)).toEqual({ found: true, path });
    expect(resolvePosixShell({ ...deps, gitExecPath: () => undefined, env: { ...deps.env, ELANOUS_GIT_BASH_PATH: 'C:\\Windows\\System32\\bash.exe' } })).toEqual({ found: true, path: 'C:\\Program Files\\Git\\bin\\bash.exe' });
    const absent = resolvePosixShell({ ...deps, gitExecPath: () => undefined, env: { ELANOUS_GIT_BASH_PATH: 'C:\\Windows\\System32\\bash.exe' } });
    expect(absent.found).toBe(false);
    expect(resolvePosixShell({ ...deps, gitExecPath: () => undefined, env: { ELANOUS_GIT_BASH_PATH: 'C:\\Windows\\System32\\cmd.exe' } }).found).toBe(false);
    expect(resolvePosixShell({ ...deps, gitExecPath: () => undefined, env: { ELANOUS_GIT_BASH_PATH: 'C:\\Windows\\System32\\..\\System32\\bash.exe' } }).found).toBe(false);
    expect(resolvePosixShell({ ...deps, gitExecPath: () => undefined, env: { ELANOUS_GIT_BASH_PATH: 'D:\\Tools\\other.exe' } }).found).toBe(false);
  });

  test('uses git --exec-path then LOCALAPPDATA before failing', () => {
    const fromGit = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    expect(resolvePosixShell({ platform: 'win32', env, gitExecPath: () => 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core', existsSync: (p) => p === fromGit })).toEqual({ found: true, path: fromGit });
    expect(resolvePosixShell({ platform: 'win32', env, gitExecPath: () => 'D:\\PortableGit\\usr\\libexec\\git-core', existsSync: (p) => p === 'D:\\PortableGit\\bin\\bash.exe' })).toEqual({ found: true, path: 'D:\\PortableGit\\bin\\bash.exe' });
    const local = 'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
    expect(resolvePosixShell({ platform: 'win32', env, gitExecPath: () => undefined, existsSync: (p) => p === local })).toEqual({ found: true, path: local });
    expect(resolvePosixShell({ platform: 'win32', env, gitExecPath: () => { throw new Error('git unavailable'); }, existsSync: (p) => p === local })).toEqual({ found: true, path: local });
    expect(resolvePosixShell({ platform: 'win32', env, gitExecPath: () => 'C:\\Windows\\System32', existsSync: (p) => p === local || p === 'C:\\Windows\\bin\\bash.exe' })).toEqual({ found: true, path: local });
  });

  test('returns an actionable failure instead of a guessed path', () => {
    const deps = { platform: 'win32' as const, env: {}, gitExecPath: () => undefined, existsSync: () => false };
    const result = resolvePosixShell(deps);
    expect(result.found).toBe(false);
    if (!result.found) expect(result.reason).toContain('ELANOUS_GIT_BASH_PATH');
    expect(() => requirePosixShell('/bin/sh', deps)).toThrow('set ELANOUS_GIT_BASH_PATH or install Git for Windows');
    expect(() => requirePosixShellCommand('bash', deps)).toThrow('set ELANOUS_GIT_BASH_PATH or install Git for Windows');
    try { requirePosixShell('/bin/sh', deps); } catch (error) {
      expect((error as Error).stack).toBe((error as Error).message);
    }
  });

  test('preserves the non-Windows environment shell and fallback', () => {
    expect(resolvePosixShell({ platform: 'darwin', env: { SHELL: '/bin/zsh' } })).toEqual({ found: true, path: '/bin/zsh' });
    expect(resolvePosixShell({ platform: 'linux', env: {} })).toEqual({ found: true, path: '/bin/sh' });
    expect(posixShellHint('/bin/bash', { SHELL: '/bin/zsh' })).toBe('/bin/zsh');
    expect(posixShellHint('/bin/bash', {})).toBe('/bin/bash');
    expect(requirePosixShellCommand('sh', { platform: 'darwin' })).toBe('sh');
    expect(requirePosixShellCommand('bash', { platform: 'linux' })).toBe('bash');
    expect(requirePosixShellCommand('/bin/sh', { platform: 'linux' })).toBe('/bin/sh');
    if (process.platform !== 'win32') expect(requirePosixShell('/bin/bash')).toBe(process.env.SHELL ?? '/bin/bash');
  });
});
