import { describe, expect, test } from 'bun:test';
import { PluginCapabilityPolicy, requestedCommand } from '../src/plugins/core/capability-policy.js';

describe('PluginCapabilityPolicy', () => {
  test('built-in plugins can spawn processes by default', () => {
    const policy = new PluginCapabilityPolicy();
    expect(policy.canSpawnProcess({
      pluginId: 'builtin.demo',
      source: 'builtin',
      capabilities: [],
    }, { cwd: '/tmp', command: 'python3 script.py' })).toEqual({ ok: true });
  });

  test('user plugins need an explicit process capability', () => {
    const policy = new PluginCapabilityPolicy();
    expect(policy.canSpawnProcess({
      pluginId: 'user.demo',
      source: 'user',
      capabilities: [],
    }, { cwd: '/tmp', command: 'python3 script.py' })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('process execution requires capability'),
    });
  });

  test('process capabilities can restrict command names', () => {
    const policy = new PluginCapabilityPolicy();
    const ctx = {
      pluginId: 'user.demo',
      source: 'user' as const,
      capabilities: [{ kind: 'process:spawn' as const, commands: ['python3'] }],
    };

    expect(policy.canSpawnProcess(ctx, { cwd: '/tmp', command: '/usr/bin/python3 script.py' })).toEqual({ ok: true });
    expect(policy.canSpawnProcess(ctx, { cwd: '/tmp', command: 'bash run.sh' })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('bash'),
    });
  });

  test('workspace plugins require workspace trust', () => {
    const policy = new PluginCapabilityPolicy();
    expect(policy.canSpawnProcess({
      pluginId: 'workspace.demo',
      source: 'workspace',
      capabilities: [{ kind: 'process:spawn' }],
    }, { cwd: '/tmp', command: 'echo ok' })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('workspace plugin is not trusted'),
    });
  });

  test('fs capabilities restrict roots', () => {
    const policy = new PluginCapabilityPolicy();
    const ctx = {
      pluginId: 'user.demo',
      source: 'user' as const,
      capabilities: [{ kind: 'fs:read' as const, roots: ['/workspace'] }],
    };
    expect(policy.canReadFile(ctx, '/workspace/README.md')).toEqual({ ok: true });
    expect(policy.canReadFile(ctx, '/etc/passwd')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not allowed'),
    });
  });

  test('network and clipboard require declared capabilities', () => {
    const policy = new PluginCapabilityPolicy();
    const ctx = {
      pluginId: 'user.demo',
      source: 'user' as const,
      capabilities: [
        { kind: 'network' as const, hosts: ['example.com'] },
        { kind: 'clipboard:read' as const },
      ],
    };
    expect(policy.canNetwork(ctx, 'https://example.com/a')).toEqual({ ok: true });
    expect(policy.canNetwork(ctx, 'https://other.example/a')).toMatchObject({ ok: false });
    expect(policy.canClipboard(ctx, 'read')).toEqual({ ok: true });
    expect(policy.canClipboard(ctx, 'write')).toMatchObject({ ok: false });
  });

  test('persisted workspace trust can allow workspace plugins', () => {
    const policy = new PluginCapabilityPolicy();
    expect(policy.canReadFile({
      pluginId: 'workspace.demo',
      source: 'workspace',
      workspaceTrusted: true,
      capabilities: [{ kind: 'fs:read' }],
    }, '/tmp/a')).toEqual({ ok: true });
  });

  test('requestedCommand extracts the executable basename', () => {
    expect(requestedCommand({ cwd: '/tmp', command: '/usr/local/bin/python3 -V' })).toBe('python3');
    expect(requestedCommand({ cwd: '/tmp', command: '"bun test" --watch' })).toBe('bun test');
    expect(requestedCommand({ cwd: '/tmp', shell: '/bin/zsh' })).toBe('zsh');
  });
});
