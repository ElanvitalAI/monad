import { describe, expect, test } from 'bun:test';
import {
  badgeForStub,
  buildAcpChannelSidebarItems,
  buildStubSnapshot,
  buildStubDetailText,
  descriptionForStub,
  resolvePrimaryActionForStub,
  sortAcpChannelStubs,
} from '../src/acp/channel-browser-catalog.js';
import type { AcpSessionStub } from '../src/session/card.js';
import type { PersistedAcpSession } from '../src/acp/session-persistence.js';

function stub(
  id: string,
  title: string,
  meta: Record<string, unknown>,
  lastActivityAt: number,
): AcpSessionStub {
  return {
    id,
    title,
    isAlive: true,
    createdAt: lastActivityAt - 1,
    lastActivityAt,
    meta,
  };
}

describe('ACP channel browser catalog', () => {
  test('sorts live cli/server lanes before background terminal states', () => {
    const stubs = sortAcpChannelStubs([
      stub('bg-done', 'BG done', { namespace: 'acp-bg', state: 'completed', backendId: 'codex' }, 30),
      stub('srv', 'Server', { namespace: 'acp-srv' }, 40),
      stub('bg-live', 'BG live', { namespace: 'acp-bg', state: 'running', backendId: 'codex' }, 50),
      stub('cli', 'Client', { namespace: 'acp-cli', backendId: 'claude-code' }, 60),
    ]);
    expect(stubs.map((entry) => entry.id)).toEqual(['cli', 'srv', 'bg-live', 'bg-done']);
  });

  test('builds shared rail badge and detail content from one catalog seam', () => {
    const items = buildAcpChannelSidebarItems([
      stub('bg-live', 'BG live', { namespace: 'acp-bg', state: 'running', backendId: 'codex', origin: 'test' }, 50),
    ], {
      status: () => ({
        id: 'bg-live',
        clientSessionId: '1',
        backendSessionId: 'bg-1',
        backendId: 'codex',
        cwd: '/tmp',
        initialMessage: 'hi',
        state: 'running',
        startedAt: 1,
        lastSeenAt: 2,
        outputPreview: 'partial output',
        fullOutput: 'partial output',
        origin: 'test',
      }),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.badge).toBe('live');
    expect(items[0]?.description).toBe('Running · codex');
  });

  test('action status can override rail badge presentation for ACP lanes', () => {
    const items = buildAcpChannelSidebarItems([
      stub('bg-live', 'BG live', { namespace: 'acp-bg', state: 'running', backendId: 'codex', origin: 'test' }, 50),
    ], {
      status: () => null,
      actionStatus: () => 'Running · Promote background lane to VW',
    });
    const presentation = items[0]?.presentation?.();
    expect(presentation?.badge).toBe('act');
    expect(presentation?.badgeTone).toBe('wait');
  });

  test('persisted history lanes surface turn-count cues on the rail', () => {
    const persisted: PersistedAcpSession = {
      sessionId: 'acp-cli:claude:hist-1',
      backendSessionId: 'hist-1',
      backendId: 'claude-code',
      cwd: '/tmp/monad-agent',
      protocolVersion: 1,
      history: [
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
        { type: 'text', text: 'three' },
      ],
      planSnapshot: null,
      toolCalls: [],
      createdAt: 10,
      lastSeenAt: 20,
      origin: 'history-test',
    };
    const items = buildAcpChannelSidebarItems([
      stub('hist', 'History', { namespace: 'acp-hist', backendId: 'claude-code' }, 20),
    ], {
      status: () => null,
      loadPersisted: () => persisted,
    });
    const presentation = items[0]?.presentation?.();
    expect(presentation?.badge).toBe('3');
    expect(presentation?.badgeTone).toBe('count');
    expect(presentation?.description).toContain('3 turns');
    expect(presentation?.description).toContain('ago');
  });

  test('live lanes surface attention cues from recent event blocks', () => {
    const items = buildAcpChannelSidebarItems([
      stub('cli', 'Client', { namespace: 'acp-cli', backendId: 'claude-code', activeHops: 0 }, 1),
    ], {
      status: () => null,
      getBlocks: () => [
        {
          id: 'b1',
          ts: 1,
          source: 'system',
          body: { kind: 'error', text: 'bad route' },
        },
      ],
    });
    const presentation = items[0]?.presentation?.();
    expect(presentation?.badge).toBe('err');
    expect(presentation?.badgeTone).toBe('err');
    expect(presentation?.description).toContain('error');
  });

  test('uses live event stream excerpt when provided for client lanes', () => {
    const cli = stub('acp-cli:claude:1', 'Client', { namespace: 'acp-cli', backendId: 'claude-code', activeHops: 0 }, 1);
    const text = buildStubDetailText(cli, null, {
      status: () => null,
      getBlocks: () => [
        {
          id: 'b1',
          ts: 1,
          source: 'agent',
          body: { kind: 'assistant', text: 'recent assistant excerpt' },
        },
      ],
    });
    expect(text).toContain('Output excerpt');
    expect(text).toContain('assistant> recent assistant excerpt');
  });

  test('buildStubSnapshot exposes summary and transcript-like excerpt together', () => {
    const cli = stub('acp-cli:claude:1', 'Client', { namespace: 'acp-cli', backendId: 'claude-code', activeHops: 0 }, 1);
    const snapshot = buildStubSnapshot(cli, null, {
      status: () => null,
      getBlocks: () => [
        {
          id: 'b1',
          ts: 1,
          source: 'user',
          body: { kind: 'user', text: 'show me logs' },
        },
      ],
    });
    expect(snapshot.laneType).toBe('Live client');
    expect(snapshot.summaryBody).toContain('Backend: claude-code');
    expect(snapshot.excerpt).toContain('user> show me logs');
  });

  test('renders persisted ACP history excerpt and history metadata', () => {
    const hist = stub(
      'acp-cli:claude:hist-1',
      'History · claude-code · monad-agent',
      { namespace: 'acp-hist', backendId: 'claude-code', backendSessionId: 'hist-1' },
      20,
    );
    const persisted: PersistedAcpSession = {
      sessionId: 'acp-cli:claude:hist-1',
      backendSessionId: 'hist-1',
      backendId: 'claude-code',
      cwd: '/tmp/monad-agent',
      protocolVersion: 1,
      history: [
        { type: 'text', text: 'earlier user turn' },
        { type: 'text', text: 'assistant reply excerpt' },
      ],
      planSnapshot: null,
      toolCalls: [],
      createdAt: 10,
      lastSeenAt: 20,
      origin: 'history-test',
    };
    const text = buildStubDetailText(hist, null, {
      status: () => null,
      loadPersisted: () => persisted,
    }, persisted);
    expect(text).toContain('History');
    expect(text).toContain('History blocks');
    expect(text).toContain('Last seen (relative)');
    expect(text).toContain('Workspace');
    expect(text).toContain('Primary action');
    expect(text).toContain('Resume persisted ACP session');
    expect(text).toContain('2');
    expect(text).toContain('monad-agent');
    expect(text).toContain('saved> assistant reply excerpt');
  });

  test('exposes stable primary action ids for background and history lanes', () => {
    const bg = stub('bg-live', 'BG live', { namespace: 'acp-bg', state: 'running', backendId: 'codex' }, 10);
    const hist = stub('hist', 'History', { namespace: 'acp-hist', backendId: 'claude-code' }, 20);
    expect(resolvePrimaryActionForStub(bg).id).toBe('promote-background-vw');
    expect(resolvePrimaryActionForStub(hist).id).toBe('resume-persisted-session');
  });

  test('keeps stub badge and description vocabulary canonical', () => {
    const cli = stub('cli', 'Client', { namespace: 'acp-cli', backendId: 'claude-code' }, 1);
    const srv = stub('srv', 'Server', { namespace: 'acp-srv' }, 1);
    expect(badgeForStub(cli)).toBe('live');
    expect(descriptionForStub(cli)).toContain('hops 0');
    expect(descriptionForStub(srv)).toBe('Server · live');
  });
});
