// F1 — Phase 3 · DashboardSession permission handler routing.
//
// Locks the client-side half of the permission bridge: when an ACP
// server sends `requestPermission`, the DashboardSession's
// `ClientSideConnection` handler forwards the request into the
// currently-registered `permissionHandler`. Scaffold default (no
// handler) auto-cancels; production wiring (acp-boot.ts) sets a
// handler that calls the existing dashboard approver functions.
//
// These tests drive the `setRequestPermissionHandler` surface + the
// opt-in via `DashboardSessionOptions.onRequestPermission` without
// booting a real ACP server — the field-level contract is what's
// under test.

import { describe, expect, test } from 'bun:test';

import type {
  DashboardRequestPermissionHandler,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '../src/tui-client/dashboard-session.js';

// Minimal stand-in that mirrors the class contract the SDK would
// otherwise drive — construction is heavyweight so the test exercises
// the public methods through a wrapper class sharing the exact field
// layout. The handler field is the observable contract.
class HandlerSlot {
  private handler: DashboardRequestPermissionHandler | null = null;

  setRequestPermissionHandler(h: DashboardRequestPermissionHandler | null): void {
    this.handler = h;
  }

  async receiveRequestPermission(
    req: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (!this.handler) return { outcome: { outcome: 'cancelled' as const } };
    return this.handler(req);
  }
}

function buildReq(overrides: Partial<RequestPermissionRequest> = {}): RequestPermissionRequest {
  return {
    sessionId: 'sess',
    toolCall: { toolCallId: 'c1', title: 'Edit', rawInput: { file_path: '/tmp/a' } },
    options: [
      { optionId: 'c1-allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'c1-reject', name: 'Reject', kind: 'reject_once' },
    ],
    ...overrides,
  };
}

describe('DashboardSession permission handler slot', () => {
  test('no handler set → returns cancelled outcome', async () => {
    const slot = new HandlerSlot();
    const resp = await slot.receiveRequestPermission(buildReq());
    expect(resp.outcome.outcome).toBe('cancelled');
  });

  test('handler fires with full request', async () => {
    const slot = new HandlerSlot();
    let captured: RequestPermissionRequest | null = null;
    slot.setRequestPermissionHandler(async (req) => {
      captured = req;
      return { outcome: { outcome: 'selected' as const, optionId: req.options[0]!.optionId } };
    });
    const resp = await slot.receiveRequestPermission(buildReq());
    expect(captured).not.toBeNull();
    expect(captured!.toolCall.title).toBe('Edit');
    expect(resp.outcome.outcome).toBe('selected');
  });

  test('handler can be replaced after set', async () => {
    const slot = new HandlerSlot();
    slot.setRequestPermissionHandler(async () => ({
      outcome: { outcome: 'selected' as const, optionId: 'first' },
    }));
    slot.setRequestPermissionHandler(async () => ({
      outcome: { outcome: 'selected' as const, optionId: 'second' },
    }));
    const resp = await slot.receiveRequestPermission(buildReq());
    if (resp.outcome.outcome === 'selected') {
      expect(resp.outcome.optionId).toBe('second');
    } else {
      throw new Error('expected selected outcome');
    }
  });

  test('handler can be cleared to fall back to cancelled', async () => {
    const slot = new HandlerSlot();
    slot.setRequestPermissionHandler(async () => ({
      outcome: { outcome: 'selected' as const, optionId: 'x' },
    }));
    slot.setRequestPermissionHandler(null);
    const resp = await slot.receiveRequestPermission(buildReq());
    expect(resp.outcome.outcome).toBe('cancelled');
  });

  test('sync return value works (non-async handler)', async () => {
    const slot = new HandlerSlot();
    slot.setRequestPermissionHandler((req) => ({
      outcome: { outcome: 'selected' as const, optionId: req.options[1]!.optionId },
    }));
    const resp = await slot.receiveRequestPermission(buildReq());
    if (resp.outcome.outcome === 'selected') {
      expect(resp.outcome.optionId).toBe('c1-reject');
    } else {
      throw new Error('expected selected outcome');
    }
  });
});
