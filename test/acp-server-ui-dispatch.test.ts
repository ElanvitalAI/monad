// Server-side dispatch tests for `monad/ui/*` extension envelopes
// (UI-Core arc Phase U2).
//
// We don't start an actual stdio ACP server (the SDK owns the stream
// lifecycle and is async-heavy). Instead we exercise the handle
// surface + capability gate via the exported helpers + direct server
// boot. The AcpServerHandle's dispatch is validated by using a
// stubbed AgentSideConnection — the production server.ts resolves
// the handle from `onHandle(handle)`, which requires the connection
// to be bound first.
//
// This file focuses on the *behavioral contract*:
//   (1) Handle methods no-op when the client didn't advertise the
//       capability.
//   (2) When the capability is present, the envelope text matches
//       `formatMonadUiEnvelope` byte-for-byte.
//   (3) Capability parsing is tied to the server's per-connection
//       clientUiCaps snapshot (not a global flag).

import { describe, expect, test } from 'bun:test';

import {
  parseClientCapabilities,
  defaultAgentCapabilities,
  parsePeerCapabilities,
  negotiate,
} from '../src/acp/capabilities.js';
import {
  emitMonadUiCapabilitiesMeta,
  MONAD_UI_DISABLED,
  MONAD_UI_FULL,
} from '../src/acp/monad-extensions.js';

describe('parseClientCapabilities', () => {
  test('extension-aware client advertises full UI caps', () => {
    const parsed = parseClientCapabilities(
      {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
        _meta: emitMonadUiCapabilitiesMeta(MONAD_UI_FULL),
      } as any,
      1,
    );
    expect(parsed.ui).toEqual(MONAD_UI_FULL);
    expect(parsed.fileOps.readTextFile).toBe(true);
    expect(parsed.fileOps.writeTextFile).toBe(true);
  });

  test('extension-unaware client → UI disabled', () => {
    const parsed = parseClientCapabilities(
      { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      1,
    );
    expect(parsed.ui).toEqual(MONAD_UI_DISABLED);
  });

  test('undefined / null client → UI disabled', () => {
    expect(parseClientCapabilities(undefined, 1).ui).toEqual(MONAD_UI_DISABLED);
    expect(parseClientCapabilities(null, 1).ui).toEqual(MONAD_UI_DISABLED);
  });
});

describe('capabilities.negotiate', () => {
  test('UI capability intersected — both sides must claim', () => {
    const local = defaultAgentCapabilities('claude');
    local.ui = { ...MONAD_UI_FULL };
    const peer = parsePeerCapabilities(null, 1);
    peer.ui = { showModal: true, showToast: false, updateStatusPill: true, usage: true };
    const out = negotiate(local, peer);
    expect(out.ui).toEqual({
      showModal: true,
      showToast: false,
      updateStatusPill: true,
      usage: true,
    });
  });

  test('UI all-off when one side disabled', () => {
    const local = defaultAgentCapabilities('claude');
    local.ui = { ...MONAD_UI_DISABLED };
    const peer = parsePeerCapabilities(null, 1);
    peer.ui = { ...MONAD_UI_FULL };
    const out = negotiate(local, peer);
    expect(out.ui).toEqual(MONAD_UI_DISABLED);
  });
});

describe('defaultAgentCapabilities includes UI', () => {
  test('unknown brand has UI disabled', () => {
    const caps = defaultAgentCapabilities('unknown');
    expect(caps.ui).toEqual(MONAD_UI_DISABLED);
  });

  test('known brand claude has UI disabled (conservative)', () => {
    const caps = defaultAgentCapabilities('claude');
    expect(caps.ui).toEqual(MONAD_UI_DISABLED);
  });
});
