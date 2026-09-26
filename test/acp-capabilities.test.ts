// Unit tests for ACP capability negotiation — H2 #4.
//
// Pure data-shape + version-check tests. No subprocess involved.

import { describe, expect, test } from 'bun:test';
import { isVisionCapableModel } from '../src/llm-vision-capability.js';
import {
  AcpLoadSessionUnsupportedError,
  AcpProtocolVersionError,
  AcpResumeSessionUnsupportedError,
  buildAgentDeclaration,
  buildClientDeclaration,
  buildDeclaration,
  checkProtocolVersion,
  defaultAgentCapabilities,
  ELANOUS_PROTOCOL_VERSION,
  negotiate,
  parsePeerCapabilities,
  type ElanousCapabilities,
} from '../src/acp/capabilities.js';

function elanousCaps(overrides: Partial<ElanousCapabilities>): ElanousCapabilities {
  return {
    protocolVersion: ELANOUS_PROTOCOL_VERSION,
    prompt: {
      text: true,
      resourceLink: true,
      image: false,
      audio: false,
      embeddedContext: false,
      video: false,
    },
    loadSession: false,
    session: { fork: false, list: false, resume: false },
    mcp: { http: false, sse: false },
    fileOps: { readTextFile: false, writeTextFile: false },
    planMode: false,
    ui: { showModal: false, showToast: false, updateStatusPill: false, usage: false },
    term: { terminalOutput: false, terminalExit: false },
    ...overrides,
    // Re-merge the nested prompt object when overridden
    prompt: {
      text: true,
      resourceLink: true,
      image: false,
      audio: false,
      embeddedContext: false,
      video: false,
      ...(overrides.prompt ?? {}),
    },
  };
}

describe('parsePeerCapabilities', () => {
  test('undefined peer → conservative baseline', () => {
    const c = parsePeerCapabilities(undefined, ELANOUS_PROTOCOL_VERSION);
    expect(c.prompt.text).toBe(true);
    expect(c.prompt.resourceLink).toBe(true);
    expect(c.prompt.image).toBe(false);
    expect(c.prompt.audio).toBe(false);
    expect(c.prompt.embeddedContext).toBe(false);
    expect(c.loadSession).toBe(false);
    expect(c.session).toEqual({ fork: false, list: false, resume: false });
    expect(c.mcp).toEqual({ http: false, sse: false });
    expect(c.planMode).toBe(false);
    expect(c.protocolVersion).toBe(ELANOUS_PROTOCOL_VERSION);
  });

  test('null peer → conservative baseline (same as undefined)', () => {
    const c = parsePeerCapabilities(null, ELANOUS_PROTOCOL_VERSION);
    expect(c.prompt.image).toBe(false);
    expect(c.loadSession).toBe(false);
  });

  test('empty object peer → conservative baseline', () => {
    const c = parsePeerCapabilities({}, ELANOUS_PROTOCOL_VERSION);
    expect(c.prompt.image).toBe(false);
    expect(c.loadSession).toBe(false);
  });

  test('loadSession:true passes through', () => {
    const c = parsePeerCapabilities({ loadSession: true }, ELANOUS_PROTOCOL_VERSION);
    expect(c.loadSession).toBe(true);
    expect(c.prompt.image).toBe(false);
  });

  test('promptCapabilities.image:true passes through', () => {
    const c = parsePeerCapabilities(
      { promptCapabilities: { image: true } },
      ELANOUS_PROTOCOL_VERSION,
    );
    expect(c.prompt.image).toBe(true);
    expect(c.prompt.audio).toBe(false);
  });

  test('full promptCapabilities passes through each flag independently', () => {
    const c = parsePeerCapabilities(
      { promptCapabilities: { audio: true, embeddedContext: true, image: false } },
      ELANOUS_PROTOCOL_VERSION,
    );
    expect(c.prompt.audio).toBe(true);
    expect(c.prompt.embeddedContext).toBe(true);
    expect(c.prompt.image).toBe(false);
  });

  test('preserves protocolVersion', () => {
    const c = parsePeerCapabilities({}, 42 as any);
    expect(c.protocolVersion).toBe(42);
  });

  test('preserves advertised session and MCP capabilities independently', () => {
    const c = parsePeerCapabilities(
      {
        loadSession: true,
        sessionCapabilities: { fork: {}, list: {}, resume: {} },
        mcpCapabilities: { http: true, sse: true },
      },
      ELANOUS_PROTOCOL_VERSION,
    );
    expect(c.loadSession).toBe(true);
    expect(c.session).toEqual({ fork: true, list: true, resume: true });
    expect(c.mcp).toEqual({ http: true, sse: true });
  });

  test('missing session and MCP capability bundles normalize to unsupported', () => {
    const c = parsePeerCapabilities({ loadSession: true }, ELANOUS_PROTOCOL_VERSION);
    expect(c.loadSession).toBe(true);
    expect(c.session).toEqual({ fork: false, list: false, resume: false });
    expect(c.mcp).toEqual({ http: false, sse: false });
  });

  test('peer fileOps always false (fs lives on client side)', () => {
    const c = parsePeerCapabilities({ loadSession: true }, ELANOUS_PROTOCOL_VERSION);
    expect(c.fileOps.readTextFile).toBe(false);
    expect(c.fileOps.writeTextFile).toBe(false);
  });
});

describe('defaultAgentCapabilities', () => {
  test('claude baseline — all off except text/resource_link', () => {
    const c = defaultAgentCapabilities('claude');
    expect(c.prompt.image).toBe(false);
    expect(c.prompt.audio).toBe(false);
    expect(c.loadSession).toBe(false);
    expect(c.protocolVersion).toBe(ELANOUS_PROTOCOL_VERSION);
  });

  test('gemini advertises image', () => {
    const c = defaultAgentCapabilities('gemini');
    expect(c.prompt.image).toBe(true);
    expect(c.prompt.audio).toBe(false);
    expect(c.loadSession).toBe(false);
  });

  test('codex baseline — all off', () => {
    const c = defaultAgentCapabilities('codex');
    expect(c.prompt.image).toBe(false);
  });

  test('unknown brand → pure conservative baseline', () => {
    const c = defaultAgentCapabilities('unknown-llm');
    expect(c.prompt.image).toBe(false);
    expect(c.prompt.audio).toBe(false);
    expect(c.loadSession).toBe(false);
    expect(c.planMode).toBe(false);
  });
});

describe('buildClientDeclaration', () => {
  test('defaults — everything off', () => {
    const c = buildClientDeclaration();
    expect(c.fs.readTextFile).toBe(false);
    expect(c.fs.writeTextFile).toBe(false);
    expect(c.terminal).toBe(false);
  });

  test('opts honored per field', () => {
    const c = buildClientDeclaration({ fs: { readTextFile: true }, terminal: true });
    expect(c.fs.readTextFile).toBe(true);
    expect(c.fs.writeTextFile).toBe(false);
    expect(c.terminal).toBe(true);
  });
});

describe('PR9 — video capability advertise + parse + negotiate', () => {
  test('parsePeerCapabilities reads peer-advertised video=true', () => {
    const peer = {
      promptCapabilities: { image: true, audio: false, embeddedContext: false, video: true },
    } as unknown as Parameters<typeof parsePeerCapabilities>[0];
    const c = parsePeerCapabilities(peer, ELANOUS_PROTOCOL_VERSION);
    expect(c.prompt.video).toBe(true);
    expect(c.prompt.image).toBe(true);
  });

  test('parsePeerCapabilities legacy peer (no video field) → conservative video=false', () => {
    const peer = {
      promptCapabilities: { image: true, audio: false, embeddedContext: false },
    } as unknown as Parameters<typeof parsePeerCapabilities>[0];
    const c = parsePeerCapabilities(peer, ELANOUS_PROTOCOL_VERSION);
    expect(c.prompt.video).toBe(false);
  });

  test('defaultAgentCapabilities Gemini brand → video true (BRAND_DEFAULTS)', () => {
    const c = defaultAgentCapabilities('gemini');
    expect(c.prompt.video).toBe(true);
    expect(c.prompt.image).toBe(true);
  });

  test('defaultAgentCapabilities claude / codex / unknown → video false (conservative)', () => {
    expect(defaultAgentCapabilities('claude').prompt.video).toBe(false);
    expect(defaultAgentCapabilities('codex').prompt.video).toBe(false);
    expect(defaultAgentCapabilities('unknown-brand').prompt.video).toBe(false);
  });

  test('negotiate AND-merges video (both must be true)', () => {
    const local = elanousCaps({ prompt: { text: true, resourceLink: true, image: false, audio: false, embeddedContext: false, video: true } });
    const peerYes = elanousCaps({ prompt: { text: true, resourceLink: true, image: false, audio: false, embeddedContext: false, video: true } });
    const peerNo = elanousCaps({ prompt: { text: true, resourceLink: true, image: false, audio: false, embeddedContext: false, video: false } });
    expect(negotiate(local, peerYes).prompt.video).toBe(true);
    expect(negotiate(local, peerNo).prompt.video).toBe(false);
    expect(negotiate(peerNo, peerYes).prompt.video).toBe(false); // local off blocks
  });
});

describe('buildAgentDeclaration', () => {
  test('omits unknown image capability while preserving loadSession and video defaults', () => {
    const c = buildAgentDeclaration();
    // M2.3 — loadSession default flip ON. PR9 (2026-05-14) — video
    // capability advertise (Gemini routes natively · others graceful).
    expect(c.loadSession).toBe(true);
    expect(c.promptCapabilities).toEqual({
      audio: false,
      embeddedContext: false,
      video: true,
    } as unknown as typeof c.promptCapabilities);
  });

  test('rejects a partial model identity instead of declaring image:false', () => {
    expect(() => buildAgentDeclaration({ brand: 'gemini' } as any)).toThrow();
    expect(() => buildAgentDeclaration({ model: 'gemini-3.1-pro' } as any)).toThrow();
  });

  test('advertises image: true for a vision-capable user-message model', () => {
    const brand = 'gemini' as const;
    const model = 'gemini-3.1-pro';
    const c = buildAgentDeclaration({ brand, model });
    const image = (c.promptCapabilities as { image: boolean }).image;
    expect(image).toBe(true);
    expect(isVisionCapableModel(brand, model, 'userMessage')).toBe(image);
    expect((c.promptCapabilities as { video?: boolean }).video).toBe(true);
  });

  test('advertises image: false for a vision-incapable user-message model', () => {
    const brand = 'local' as const;
    const model = 'llama3';
    const c = buildAgentDeclaration({ brand, model });
    const image = (c.promptCapabilities as { image: boolean }).image;
    expect(image).toBe(false);
    expect(isVisionCapableModel(brand, model, 'userMessage')).toBe(image);
  });

  test('opt-out video advertisement when explicitly disabled', () => {
    const c = buildAgentDeclaration({ video: false });
    expect((c.promptCapabilities as unknown as { video?: boolean }).video).toBeUndefined();
  });

  test('preserves video opt-out alongside a vision identity', () => {
    const c = buildAgentDeclaration({
      brand: 'gemini',
      model: 'gemini-3.1-pro',
      video: false,
    });
    expect((c.promptCapabilities as { image: boolean }).image).toBe(true);
    expect((c.promptCapabilities as { video?: boolean }).video).toBeUndefined();
  });
});

describe('buildDeclaration', () => {
  test('bundles client + agent + protocol version', () => {
    const d = buildDeclaration();
    expect(d.protocolVersion).toBe(ELANOUS_PROTOCOL_VERSION);
    expect(d.asClient.terminal).toBe(false);
    // M2.3 — loadSession defaults ON. PR9 — video advertise ON.
    expect(d.asAgent.loadSession).toBe(true);
    expect((d.asAgent.promptCapabilities as unknown as { video?: boolean }).video).toBe(true);
  });
});

describe('negotiate', () => {
  test('AND semantics — both sides must be true', () => {
    const local = elanousCaps({ prompt: { image: true, audio: true, embeddedContext: true } } as any);
    const peer = elanousCaps({ prompt: { image: true, audio: false, embeddedContext: true } } as any);
    const n = negotiate(local, peer);
    expect(n.prompt.image).toBe(true);
    expect(n.prompt.audio).toBe(false);
    expect(n.prompt.embeddedContext).toBe(true);
  });

  test('loadSession requires both sides', () => {
    const local = elanousCaps({ loadSession: true });
    const peer = elanousCaps({ loadSession: false });
    expect(negotiate(local, peer).loadSession).toBe(false);
    expect(negotiate(peer, local).loadSession).toBe(false);
    expect(negotiate(local, local).loadSession).toBe(true);
  });

  test('protocolVersion = min(local, peer)', () => {
    const local = elanousCaps({ protocolVersion: 3 as any });
    const peer = elanousCaps({ protocolVersion: 2 as any });
    expect(negotiate(local, peer).protocolVersion).toBe(2);
    expect(negotiate(peer, local).protocolVersion).toBe(2);
  });
});

describe('checkProtocolVersion', () => {
  test('equal versions → null', () => {
    expect(checkProtocolVersion(1, 1)).toBeNull();
    expect(checkProtocolVersion(5 as any, 5 as any)).toBeNull();
  });

  test('mismatch → AcpProtocolVersionError with both versions', () => {
    const err = checkProtocolVersion(1, 2);
    expect(err).not.toBeNull();
    expect(err).toBeInstanceOf(AcpProtocolVersionError);
    expect(err!.local).toBe(1);
    expect(err!.peer).toBe(2);
    expect(err!.name).toBe('AcpProtocolVersionError');
    expect(err!.message).toContain('1');
    expect(err!.message).toContain('2');
  });

  test('mismatch in either direction', () => {
    const lowPeer = checkProtocolVersion(2, 1);
    const highPeer = checkProtocolVersion(1, 2);
    expect(lowPeer).not.toBeNull();
    expect(highPeer).not.toBeNull();
    expect(lowPeer!.local).toBe(2);
    expect(lowPeer!.peer).toBe(1);
  });

  test('error carries upgrade guidance in message', () => {
    const err = checkProtocolVersion(1, 99 as any);
    expect(err!.message.toLowerCase()).toContain('update');
  });
});

describe('AcpProtocolVersionError', () => {
  test('is a real Error subclass', () => {
    const err = new AcpProtocolVersionError(1, 2);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AcpProtocolVersionError);
    expect(err.stack).toBeDefined();
  });
});

describe('AcpLoadSessionUnsupportedError (H2 #5)', () => {
  test('is a real Error subclass with backendId', () => {
    const err = new AcpLoadSessionUnsupportedError('claude');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AcpLoadSessionUnsupportedError);
    expect(err.backendId).toBe('claude');
    expect(err.name).toBe('AcpLoadSessionUnsupportedError');
  });

  test('message names the backend', () => {
    const err = new AcpLoadSessionUnsupportedError('codex');
    expect(err.message).toContain('codex');
    expect(err.message.toLowerCase()).toContain('loadsession');
  });
});

describe('AcpResumeSessionUnsupportedError', () => {
  test('is a distinct Error subclass that identifies the backend and capability', () => {
    const err = new AcpResumeSessionUnsupportedError('claude');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AcpResumeSessionUnsupportedError);
    expect(err).not.toBeInstanceOf(AcpLoadSessionUnsupportedError);
    expect(err.backendId).toBe('claude');
    expect(err.name).toBe('AcpResumeSessionUnsupportedError');
    expect(err.message).toContain('claude');
    expect(err.message).toContain('session.resume');
  });
});
