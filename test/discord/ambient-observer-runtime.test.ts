// ── C5 (Phase 3 Bundle 3) — ambient-observer-runtime tests ──

import { describe, expect, test } from 'bun:test';
import {
  createAmbientObserver,
  type AmbientPostureEvent,
} from '../../src/discord/ambient-observer-runtime';
import { createPersonaCapabilityRouter } from '../../src/discord/persona-capability-router';
import { createCapabilityGrantStore } from '../../src/conductor/capability-grant-store';
import type { ChannelPost, DiscordChannel } from '../../src/discord/shell-channel-orchestrator';
import type {
  ShellPostureEvent,
  ShellPostureSubscriber,
  ShellRegistry,
} from '../../src/shell-runner/types';

const CHANNEL: DiscordChannel = { id: 'ch-1', name: 'dev-ops' };

function fakeRegistry(): {
  registry: ShellRegistry;
  emit: (e: ShellPostureEvent) => void;
  unsubscribed: () => boolean;
} {
  const subs = new Set<ShellPostureSubscriber>();
  let didUnsubscribe = false;
  const registry = {
    register: () => {},
    unregister: () => {},
    get: () => null,
    list: () => [],
    findVwRunner: () => null,
    getVwLabel: () => null,
    subscribe: () => () => {},
    attachSurface: () => () => {},
    describePosture: () => null,
    listWithPosture: () => [],
    subscribePosture(cb: ShellPostureSubscriber) {
      subs.add(cb);
      return () => { subs.delete(cb); didUnsubscribe = true; };
    },
  } as unknown as ShellRegistry;
  return {
    registry,
    emit: (e) => { for (const cb of subs) cb(e); },
    unsubscribed: () => didUnsubscribe,
  };
}

function adminRouter() {
  const r = createPersonaCapabilityRouter({ grantStore: createCapabilityGrantStore() });
  r.setPersona({ persona: 'elanous-bot', role: 'admin' });
  return r;
}

describe('createAmbientObserver — death detection', () => {
  test('user-interactive → unavailable fires death post', async () => {
    const fake = fakeRegistry();
    const posts: ChannelPost[] = [];
    const obs = createAmbientObserver({
      registry: fake.registry,
      channels: [CHANNEL],
      observerPersona: 'elanous-bot',
      personaRouter: adminRouter(),
      channelPost: async (p) => { posts.push(p); },
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: { userExposure: 'user-interactive', agentInteractive: true },
      next: { userExposure: 'unavailable', agentInteractive: false },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.message).toContain('🪦');
    expect(obs.count()).toBe(1);
    obs.stop();
  });

  test('non-death transition fires non-death message', async () => {
    const fake = fakeRegistry();
    const posts: ChannelPost[] = [];
    const obs = createAmbientObserver({
      registry: fake.registry,
      channels: [CHANNEL],
      observerPersona: 'elanous-bot',
      personaRouter: adminRouter(),
      channelPost: async (p) => { posts.push(p); },
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: { userExposure: 'user-interactive', agentInteractive: true },
      next: { userExposure: 'observe-only', agentInteractive: true },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(posts[0]!.message).toContain('📡');
    expect(posts[0]!.message).not.toContain('🪦');
    obs.stop();
  });
});

describe('createAmbientObserver — capability gate', () => {
  test('observer persona without read capability → no post', async () => {
    const fake = fakeRegistry();
    const router = createPersonaCapabilityRouter({ grantStore: createCapabilityGrantStore() });
    router.setPersona({ persona: 'guest-bot', role: 'guest' });  // no read
    const posts: ChannelPost[] = [];
    const obs = createAmbientObserver({
      registry: fake.registry,
      channels: [CHANNEL],
      observerPersona: 'guest-bot',
      personaRouter: router,
      channelPost: async (p) => { posts.push(p); },
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: { userExposure: 'user-interactive', agentInteractive: true },
      next: { userExposure: 'unavailable', agentInteractive: false },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(posts).toEqual([]);
    obs.stop();
  });
});

describe('createAmbientObserver — throttle', () => {
  test('repeated events within throttle window suppressed', async () => {
    const fake = fakeRegistry();
    const posts: ChannelPost[] = [];
    const obs = createAmbientObserver({
      registry: fake.registry,
      channels: [CHANNEL],
      observerPersona: 'elanous-bot',
      personaRouter: adminRouter(),
      channelPost: async (p) => { posts.push(p); },
      throttleMs: 1000,
    });
    const event: ShellPostureEvent = {
      kind: 'posture-changed',
      shellId: 's1',
      prev: { userExposure: 'user-interactive', agentInteractive: true },
      next: { userExposure: 'observe-only', agentInteractive: true },
    };
    fake.emit(event);
    fake.emit(event);
    fake.emit(event);
    await new Promise((r) => setTimeout(r, 5));
    expect(posts).toHaveLength(1);
    obs.stop();
  });
});

describe('createAmbientObserver — multi-channel', () => {
  test('posts to each channel', async () => {
    const fake = fakeRegistry();
    const posts: ChannelPost[] = [];
    const obs = createAmbientObserver({
      registry: fake.registry,
      channels: [
        { id: 'ch-1', name: 'a' },
        { id: 'ch-2', name: 'b' },
      ],
      observerPersona: 'elanous-bot',
      personaRouter: adminRouter(),
      channelPost: async (p) => { posts.push(p); },
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: { userExposure: 'user-interactive', agentInteractive: true },
      next: { userExposure: 'unavailable', agentInteractive: false },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.channelId).sort()).toEqual(['ch-1', 'ch-2']);
    obs.stop();
  });
});

describe('createAmbientObserver — stop', () => {
  test('stop unsubscribes (idempotent)', () => {
    const fake = fakeRegistry();
    const obs = createAmbientObserver({
      registry: fake.registry,
      channels: [CHANNEL],
      observerPersona: 'elanous-bot',
      personaRouter: adminRouter(),
      channelPost: async () => {},
    });
    expect(fake.unsubscribed()).toBe(false);
    obs.stop();
    expect(fake.unsubscribed()).toBe(true);
    expect(() => obs.stop()).not.toThrow();
  });
});

describe('createAmbientObserver — composer override', () => {
  test('custom composeMessage honored', async () => {
    const fake = fakeRegistry();
    const posts: ChannelPost[] = [];
    const obs = createAmbientObserver({
      registry: fake.registry,
      channels: [CHANNEL],
      observerPersona: 'elanous-bot',
      personaRouter: adminRouter(),
      channelPost: async (p) => { posts.push(p); },
      composeMessage: (e: AmbientPostureEvent) => `OVERRIDE: ${e.shellId}`,
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 's-x',
      prev: { userExposure: 'user-interactive', agentInteractive: true },
      next: { userExposure: 'unavailable', agentInteractive: false },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(posts[0]!.message).toBe('OVERRIDE: s-x');
    obs.stop();
  });
});
