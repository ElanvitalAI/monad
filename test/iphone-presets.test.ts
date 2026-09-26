import { describe, expect, test } from 'bun:test';

import {
  createIPhonePresets,
  DEFAULT_AGENT_RESULT_NOTIFICATION,
  DEFAULT_CAMERA_SHORTCUT,
  DEFAULT_OPEN_URL_NOTIFICATION,
} from '../src/pushcut/iphone-presets.js';
import type { PushcutClient, PushcutSendResult } from '../src/pushcut/client.js';

function fakeClient(opts?: {
  configured?: boolean;
  executeImpl?: (action: string, p: Record<string, unknown>) => Promise<PushcutSendResult>;
  notifyImpl?: (name: string, body: Record<string, unknown>) => Promise<PushcutSendResult>;
}): PushcutClient & { calls: Array<{ kind: string; args: unknown[] }> } {
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  const c: PushcutClient = {
    configured: opts?.configured ?? true,
    async notify(name, body) {
      calls.push({ kind: 'notify', args: [name, body] });
      return opts?.notifyImpl
        ? await opts.notifyImpl(name, body as Record<string, unknown>)
        : { ok: true };
    },
    async execute(action, payload) {
      calls.push({ kind: 'execute', args: [action, payload] });
      return opts?.executeImpl
        ? await opts.executeImpl(action, payload as Record<string, unknown>)
        : { ok: true };
    },
  };
  (c as unknown as { calls: typeof calls }).calls = calls;
  return c as PushcutClient & { calls: typeof calls };
}

describe('openUrlOnSafari', () => {
  test('uses execute(openUrl) when available', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    const r = await presets.openUrlOnSafari('https://example.com');
    expect(r.ok).toBe(true);
    expect(c.calls[0]!.kind).toBe('execute');
    expect(c.calls[0]!.args[0]).toBe('openUrl');
  });

  test('falls back to notify when execute fails', async () => {
    const c = fakeClient({
      executeImpl: async () => ({ ok: false, reason: 'no-such-endpoint' }),
    });
    const presets = createIPhonePresets({ client: c });
    const r = await presets.openUrlOnSafari('https://example.com');
    expect(r.ok).toBe(true);
    // 1st call: execute, 2nd call: notify fallback.
    expect(c.calls.length).toBe(2);
    expect(c.calls[1]!.kind).toBe('notify');
    expect(c.calls[1]!.args[0]).toBe(DEFAULT_OPEN_URL_NOTIFICATION);
  });

  test('empty url → missing-url error', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    const r = await presets.openUrlOnSafari('');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-url');
  });
});

describe('triggerCamera', () => {
  test('runs elanous-camera by default', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.triggerCamera();
    const call = c.calls[0]!;
    expect(call.kind).toBe('execute');
    expect(call.args[0]).toBe('runShortcut');
    expect((call.args[1] as { shortcut: string }).shortcut).toBe(DEFAULT_CAMERA_SHORTCUT);
  });

  test('shortcut override + input pass through', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.triggerCamera({ shortcut: 'custom-cam', input: 'front' });
    const call = c.calls[0]!;
    expect((call.args[1] as { shortcut: string }).shortcut).toBe('custom-cam');
    expect((call.args[1] as { input: string }).input).toBe('front');
  });
});

describe('triggerLocationPreset', () => {
  test('default shortcut name is elanous-location-<name>', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.triggerLocationPreset('home');
    const call = c.calls[0]!;
    expect((call.args[1] as { shortcut: string }).shortcut).toBe('elanous-location-home');
    expect((call.args[1] as { input: string }).input).toBe('home');
  });

  test('shortcut override wins', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.triggerLocationPreset('work', { shortcut: 'my-shortcut' });
    expect((c.calls[0]!.args[1] as { shortcut: string }).shortcut).toBe('my-shortcut');
  });
});

describe('notifyAgentResult', () => {
  test('builds actions from url + extras', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.notifyAgentResult({
      title: 'Done',
      summary: 'Result ready',
      url: 'https://example.com/results/1',
      extraActions: [{ name: 'Retry', shortcut: 'elanous-retry' }],
    });
    const [name, body] = c.calls[0]!.args as [string, Record<string, unknown>];
    expect(name).toBe(DEFAULT_AGENT_RESULT_NOTIFICATION);
    expect((body.actions as Array<{ name: string }>).map(a => a.name)).toEqual(['Open', 'Retry']);
  });

  test('no url + no extras → actions unset', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.notifyAgentResult({ title: 'ok' });
    const [, body] = c.calls[0]!.args as [string, Record<string, unknown>];
    expect(body.actions).toBeUndefined();
  });

  test('device override passes through', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.notifyAgentResult({ title: 'x', devices: ['work-phone'] });
    const [, body] = c.calls[0]!.args as [string, Record<string, unknown>];
    expect(body.devices).toEqual(['work-phone']);
  });

  test('custom notification name override', async () => {
    const c = fakeClient();
    const presets = createIPhonePresets({ client: c });
    await presets.notifyAgentResult({ title: 'x' }, { notificationName: 'custom' });
    expect(c.calls[0]!.args[0]).toBe('custom');
  });
});
