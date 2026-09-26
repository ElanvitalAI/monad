import { describe, test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';

import { detectShellKind, makeOsc133RcFile } from '../../src/shell-runner/osc133-rc.js';

describe('detectShellKind', () => {
  test('bash path → bash', () => {
    expect(detectShellKind('/bin/bash')).toBe('bash');
    expect(detectShellKind('/usr/local/bin/bash')).toBe('bash');
    expect(detectShellKind('bash')).toBe('bash');
  });

  test('zsh path → zsh', () => {
    expect(detectShellKind('/bin/zsh')).toBe('zsh');
    expect(detectShellKind('zsh')).toBe('zsh');
  });

  test('unsupported shells → null', () => {
    expect(detectShellKind('/usr/bin/fish')).toBeNull();
    expect(detectShellKind('/bin/sh')).toBeNull();
    expect(detectShellKind('/usr/local/bin/pwsh')).toBeNull();
  });

  test('undefined → null', () => {
    expect(detectShellKind(undefined)).toBeNull();
  });
});

describe('makeOsc133RcFile — bash', () => {
  test('returns --rcfile arg pointing at a real file', () => {
    const rc = makeOsc133RcFile('bash')!;
    try {
      expect(rc.spawnArgs[0]).toBe('--rcfile');
      expect(rc.spawnArgs[1]).toBe(rc.path);
      expect(existsSync(rc.path)).toBe(true);
    } finally {
      rc.cleanup();
    }
  });

  test('rc content sources ~/.bashrc and emits OSC 133;B + ;A', () => {
    const rc = makeOsc133RcFile('bash')!;
    try {
      const body = readFileSync(rc.path, 'utf8');
      expect(body).toContain('$HOME/.bashrc');
      expect(body).toContain('\\033]133;B;%s\\007');
      expect(body).toContain('\\033]133;A\\007');
      // PROMPT_COMMAND guarded so repeat re-sourcing doesn't double-append.
      expect(body).toContain('__elanous_osc133_prompt');
    } finally {
      rc.cleanup();
    }
  });

  test('env advertises ELANOUS_OSC133=1', () => {
    const rc = makeOsc133RcFile('bash')!;
    try {
      expect(rc.env.ELANOUS_OSC133).toBe('1');
    } finally {
      rc.cleanup();
    }
  });

  test('cleanup removes the tmp dir', () => {
    const rc = makeOsc133RcFile('bash')!;
    const path = rc.path;
    expect(existsSync(path)).toBe(true);
    rc.cleanup();
    expect(existsSync(path)).toBe(false);
  });

  test('cleanup is idempotent', () => {
    const rc = makeOsc133RcFile('bash')!;
    rc.cleanup();
    expect(() => rc.cleanup()).not.toThrow();
  });
});

describe('makeOsc133RcFile — zsh', () => {
  test('returns ZDOTDIR env + no spawnArgs', () => {
    const rc = makeOsc133RcFile('zsh')!;
    try {
      expect(rc.spawnArgs).toEqual([]);
      expect(rc.env.ZDOTDIR).toBe(rc.path);
      expect(existsSync(`${rc.path}/.zshrc`)).toBe(true);
    } finally {
      rc.cleanup();
    }
  });

  test('.zshrc sources HOME rc files + installs precmd hook', () => {
    const rc = makeOsc133RcFile('zsh')!;
    try {
      const body = readFileSync(`${rc.path}/.zshrc`, 'utf8');
      expect(body).toContain('$HOME/.zshrc');
      expect(body).toContain('\\033]133;B;%s\\007');
      expect(body).toContain('\\033]133;A\\007');
      expect(body).toContain('add-zsh-hook precmd __elanous_osc133_prompt');
    } finally {
      rc.cleanup();
    }
  });

  test('cleanup removes the ZDOTDIR', () => {
    const rc = makeOsc133RcFile('zsh')!;
    expect(existsSync(rc.path)).toBe(true);
    rc.cleanup();
    expect(existsSync(rc.path)).toBe(false);
  });
});
