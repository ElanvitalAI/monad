// ── Destructive Guardian (AU3) ──

import { describe, test, expect, afterEach } from 'bun:test';
import {
  classifyDestructive,
  isGuardianDisabled,
  setGuardianDisabled,
} from '../../src/ask-user-question/guardian.js';

describe('classifyDestructive — filesystem patterns', () => {
  afterEach(() => {
    setGuardianDisabled(false);
    delete process.env.ELANOUS_GUARDIAN;
  });

  test('rm -rf', () => {
    const f = classifyDestructive(['rm', '-rf', '/tmp/x']);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe('destructive');
    expect(f!.reason).toContain('recursive');
  });

  test('rm -r (alternate flag)', () => {
    const f = classifyDestructive(['bash', '-c', 'rm -r foo']);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe('destructive');
  });

  test('rm --no-preserve-root', () => {
    const f = classifyDestructive(['rm', '--no-preserve-root', '-rf', '/']);
    expect(f).not.toBeNull();
  });

  test('shred', () => {
    expect(classifyDestructive(['shred', 'secret.txt'])).not.toBeNull();
  });

  test('fork bomb', () => {
    const f = classifyDestructive([':(){ :|:& };:']);
    expect(f).not.toBeNull();
    expect(f!.reason).toContain('fork bomb');
  });

  test('plain ls → clean', () => {
    expect(classifyDestructive(['ls', '-la'])).toBeNull();
  });

  test('mv src dest → clean', () => {
    expect(classifyDestructive(['mv', 'a', 'b'])).toBeNull();
  });

  test('rm single file (no recursive flag) → clean', () => {
    expect(classifyDestructive(['rm', 'foo.txt'])).toBeNull();
  });
});

describe('classifyDestructive — git history rewrites', () => {
  test('git push --force (no --force-with-lease)', () => {
    const f = classifyDestructive(['git', 'push', '--force', 'origin', 'main']);
    expect(f).not.toBeNull();
    expect(f!.reason).toContain('force');
  });

  test('git push -f', () => {
    expect(classifyDestructive(['git', 'push', '-f'])).not.toBeNull();
  });

  test('git push --force-with-lease → clean (safer alternative)', () => {
    expect(classifyDestructive(['git', 'push', '--force-with-lease', 'origin', 'main'])).toBeNull();
  });

  test('git reset --hard', () => {
    expect(classifyDestructive(['git', 'reset', '--hard', 'HEAD~3'])).not.toBeNull();
  });

  test('git branch -D', () => {
    expect(classifyDestructive(['git', 'branch', '-D', 'feat'])).not.toBeNull();
  });

  test('git clean -fd', () => {
    expect(classifyDestructive(['git', 'clean', '-fd'])).not.toBeNull();
  });

  test('plain git status → clean', () => {
    expect(classifyDestructive(['git', 'status'])).toBeNull();
  });

  test('git commit → clean', () => {
    expect(classifyDestructive(['git', 'commit', '-m', 'wip'])).toBeNull();
  });
});

describe('classifyDestructive — SQL', () => {
  test('DROP TABLE', () => {
    const f = classifyDestructive(['psql', '-c', 'DROP TABLE users;']);
    expect(f).not.toBeNull();
    expect(f!.reason).toContain('DROP');
  });

  test('DROP DATABASE', () => {
    expect(classifyDestructive(['psql', '-c', 'DROP DATABASE prod;'])).not.toBeNull();
  });

  test('TRUNCATE TABLE', () => {
    expect(classifyDestructive(['mysql', '-e', 'TRUNCATE TABLE sessions;'])).not.toBeNull();
  });

  test('DELETE FROM without WHERE', () => {
    expect(classifyDestructive(['psql', '-c', 'DELETE FROM users'])).not.toBeNull();
  });

  test('DELETE FROM users WHERE id=1 → clean', () => {
    expect(classifyDestructive(['psql', '-c', 'DELETE FROM users WHERE id=1'])).toBeNull();
  });

  test('SELECT → clean', () => {
    expect(classifyDestructive(['psql', '-c', 'SELECT * FROM users'])).toBeNull();
  });
});

describe('classifyDestructive — disk + permissions + privilege', () => {
  test('dd of=/dev/sda', () => {
    expect(classifyDestructive(['dd', 'if=/tmp/img', 'of=/dev/sda'])).not.toBeNull();
  });

  test('mkfs.ext4', () => {
    expect(classifyDestructive(['mkfs.ext4', '/dev/sda1'])).not.toBeNull();
  });

  test('chmod -R 777 /', () => {
    expect(classifyDestructive(['chmod', '-R', '777', '/'])).not.toBeNull();
  });

  test('sudo → escalated', () => {
    const f = classifyDestructive(['sudo', 'apt', 'update']);
    expect(f!.severity).toBe('escalated');
  });

  test('chmod 644 → clean', () => {
    expect(classifyDestructive(['chmod', '644', 'foo'])).toBeNull();
  });
});

describe('guardian disable switches', () => {
  afterEach(() => {
    setGuardianDisabled(false);
    delete process.env.ELANOUS_GUARDIAN;
  });

  test('ELANOUS_GUARDIAN=off bypass', () => {
    process.env.ELANOUS_GUARDIAN = 'off';
    expect(isGuardianDisabled()).toBe(true);
    expect(classifyDestructive(['rm', '-rf', '/tmp/x'])).toBeNull();
  });

  test('setGuardianDisabled(true) bypass', () => {
    setGuardianDisabled(true);
    expect(isGuardianDisabled()).toBe(true);
    expect(classifyDestructive(['rm', '-rf', '/'])).toBeNull();
  });

  test('re-enabled after flip off', () => {
    setGuardianDisabled(true);
    setGuardianDisabled(false);
    expect(isGuardianDisabled()).toBe(false);
    expect(classifyDestructive(['rm', '-rf', '/tmp/x'])).not.toBeNull();
  });

  test('empty argv → null', () => {
    expect(classifyDestructive([])).toBeNull();
    expect(classifyDestructive('')).toBeNull();
  });
});

describe('classifyDestructive — accepts string form', () => {
  test('raw command string works identically', () => {
    expect(classifyDestructive('rm -rf /tmp/x')).not.toBeNull();
    expect(classifyDestructive('ls -la')).toBeNull();
  });
});
