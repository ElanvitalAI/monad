import { afterEach, describe, expect, test } from 'bun:test';

import {
  initDashboardApprovers,
  createInjectApprover,
  createPaneInjectApprover,
  createBroadcastApprover,
  createAcpPermissionApprover,
  createCodeEditApprover,
  _resetDashboardApproversForTesting,
} from '../src/dashboard/runtime/approvers.js';
import { approvalModalRouter } from '../src/approval-modal.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';

afterEach(() => {
  _resetDashboardApproversForTesting();
});

function mk() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  initDashboardApprovers({
    coordinator: coord,
    termSize: () => ({ cols: 120, rows: 30 }),
    getTheme: () => DEFAULT_THEME_TOKENS,
  });
  return coord;
}

async function answer(boolAns: boolean): Promise<void> {
  // Wait one tick so the approver's pushModal + router.set settle.
  await new Promise((r) => setImmediate(r));
  const handle = approvalModalRouter.current();
  if (!handle) throw new Error('no modal visible');
  handle.handleKey({ name: boolAns ? 'y' : 'n' } as never);
}

describe('dashboard approvers', () => {
  test('throws before init', () => {
    _resetDashboardApproversForTesting();
    const approver = createInjectApprover();
    expect(() => approver({
      sessionId: 's', sessionTitle: 't', previewBytes: 'x',
      isKey: false, totalBytes: 1,
    })).toThrow(/not initialized/);
  });

  test('inject approver resolves true on y', async () => {
    mk();
    const approver = createInjectApprover();
    const p = approver({
      sessionId: 'abc', sessionTitle: 'claude',
      previewBytes: 'hi', isKey: false, totalBytes: 2,
    });
    await answer(true);
    expect(await p).toBe(true);
  });

  test('inject approver resolves false on n', async () => {
    mk();
    const approver = createInjectApprover();
    const p = approver({
      sessionId: 'abc', sessionTitle: 'claude',
      previewBytes: 'hi', isKey: false, totalBytes: 2,
    });
    await answer(false);
    expect(await p).toBe(false);
  });

  test('pane inject approver exposes pane address in the prompt', async () => {
    const coord = mk();
    const approver = createPaneInjectApprover();
    const p = approver({
      paneAddr: 'pane:ab12',
      paneKind: 'terminal',
      previewBytes: 'ls\\r',
      totalBytes: 3,
    });
    await new Promise((r) => setImmediate(r));
    const handle = approvalModalRouter.current();
    expect(handle).not.toBeNull();
    expect(handle!.surface.paint()).toContain('pane:ab12');
    expect(handle!.surface.paint()).toContain('terminal');
    expect(coord.modalStack().length).toBeGreaterThan(0);
    handle!.handleKey({ name: 'y' } as never);
    expect(await p).toBe(true);
  });

  test('broadcast approver shows target count + preview', async () => {
    mk();
    const approver = createBroadcastApprover();
    const p = approver({
      targets: ['pane:a', 'pane:b', 'pane:c'],
      previewBytes: 'cmd',
      totalBytes: 3,
    });
    await new Promise((r) => setImmediate(r));
    const handle = approvalModalRouter.current();
    expect(handle).not.toBeNull();
    expect(handle!.surface.paint()).toContain('3 panes');
    handle!.handleKey({ name: 'y' } as never);
    expect(await p).toBe(true);
  });

  test('ACP permission approver shows backend, tool title, and raw input', async () => {
    mk();
    const approver = createAcpPermissionApprover();
    const p = approver({
      backendId: 'claude',
      sessionId: 'session-1',
      title: 'Edit file',
      kind: 'edit',
      rawInput: { file_path: '/tmp/a.ts' },
      options: [
        { optionId: 'allow-1', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-1', name: 'Reject', kind: 'reject_once' },
      ],
    });
    await new Promise((r) => setImmediate(r));
    const handle = approvalModalRouter.current();
    expect(handle).not.toBeNull();
    const painted = handle!.surface.paint();
    expect(painted).toContain('Approve ACP tool?');
    expect(painted).toContain('Edit file');
    expect(painted).toContain('backend: claude');
    expect(painted).toContain('input:');
    handle!.handleKey({ name: 'y' } as never);
    expect(await p).toBe(true);
  });

  test('code-edit approver shows diff preview rows when preview payload is present', async () => {
    mk();
    const approver = createCodeEditApprover();
    const p = approver({
      kind: 'edit',
      file_path: '/tmp/a.ts',
      changeSummary: '1 lines added, 1 removed',
      reason: 'policy: ask-edit',
      preview: {
        structuredPatch: [{
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-before', '+after'],
        }],
        originalContent: 'before\n',
        newContent: 'after\n',
        linesAdded: 1,
        linesRemoved: 1,
      },
    });
    await new Promise((r) => setImmediate(r));
    const handle = approvalModalRouter.current();
    expect(handle).not.toBeNull();
    const painted = handle!.surface.paint();
    expect(painted).toContain('Approve file edit?');
    expect(painted).toContain('Edited /tmp/a.ts');
    expect(painted).toContain('after');
    handle!.handleKey({ name: 'y' } as never);
    expect(await p).toBe(true);
  });

  test('approval modal inherits themed static chrome when theme getter is wired', async () => {
    mk();
    const p = createInjectApprover()({
      sessionId: 'abc', sessionTitle: 'claude',
      previewBytes: 'hi', isKey: false, totalBytes: 2,
    });
    await new Promise((r) => setImmediate(r));
    const handle = approvalModalRouter.current();
    expect(handle).not.toBeNull();
    expect(handle!.surface.paint()).toContain('✕');
    handle!.handleKey({ name: 'y' } as never);
    expect(await p).toBe(true);
  });

  test('concurrent approvals — second one is auto-rejected', async () => {
    mk();
    const first = createInjectApprover()({
      sessionId: 's1', sessionTitle: 't1', previewBytes: 'a',
      isKey: false, totalBytes: 1,
    });
    const second = createInjectApprover()({
      sessionId: 's2', sessionTitle: 't2', previewBytes: 'b',
      isKey: false, totalBytes: 1,
    });
    // Second rejects immediately without any key press.
    expect(await second).toBe(false);
    // First is still pending — resolve it.
    await answer(true);
    expect(await first).toBe(true);
  });

  test('modal is popped off coordinator stack after answer', async () => {
    const coord = mk();
    const p = createInjectApprover()({
      sessionId: 's', sessionTitle: 't', previewBytes: 'x',
      isKey: false, totalBytes: 1,
    });
    await new Promise((r) => setImmediate(r));
    expect(coord.modalStack().length).toBeGreaterThan(0);
    await answer(true);
    await p;
    await new Promise((r) => setImmediate(r));
    expect(coord.modalStack().length).toBe(0);
  });
});
