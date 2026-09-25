import { describe, expect, test } from 'bun:test';
import type { View } from '../src/ui/view.js';
import { createIntakeStore } from '../src/intake-plane/store.js';
import { captureAndDraftIntakeRecord } from '../src/intake-plane/capture.js';
import { buildIntakeNextActions } from '../src/intake-plane/presenter.js';
import {
  applyDashboardIntakeClarifyAnswers,
  applyDashboardIntakeReviewAction,
  openDashboardIntakeSessionPicker,
  openDashboardIntakeReviewModal,
  shouldOpenDashboardIntakeSessionPicker,
  shouldOpenDashboardIntakeReviewModal,
} from '../src/dashboard/intake-review-runtime.js';
import type { SearchItem } from '../src/chat/search/modal.js';
import type { DeclarativeRuntimeArtifact } from '../src/ui/declarative/index.js';

function makeFakeView(): View {
  return {
    draw: () => {},
    onEvent: () => ({ consumed: false }),
    layout: () => {},
    requiredSize: (constraint) => constraint,
    takeFocus: () => true,
  };
}

describe('dashboard intake review runtime', () => {
  test('recognizes show/review slash results with a session payload', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-1',
      source: 'tui-scratch',
      rawText: '- compare two repos',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });
    expect(shouldOpenDashboardIntakeReviewModal(['show'], { output: 'x', session })).toBe(true);
    expect(shouldOpenDashboardIntakeReviewModal(['review'], { output: 'x', session })).toBe(true);
    expect(shouldOpenDashboardIntakeReviewModal(['draft'], { output: 'x', session })).toBe(true);
    expect(shouldOpenDashboardIntakeReviewModal(['capture'], { output: 'x', session })).toBe(true);
    expect(shouldOpenDashboardIntakeReviewModal(['search'], { output: 'x', session })).toBe(false);
  });

  test('recognizes list/search slash results with session lists', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-list',
      source: 'tui-scratch',
      rawText: '- compare two repos',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });
    expect(shouldOpenDashboardIntakeSessionPicker(['list'], { output: 'x', sessions: [session] })).toBe(true);
    expect(shouldOpenDashboardIntakeSessionPicker(['search'], { output: 'x', sessions: [session] })).toBe(true);
    expect(shouldOpenDashboardIntakeSessionPicker(['show'], { output: 'x', sessions: [session] })).toBe(false);
  });

  test('clarify answers advance the intake to review-ready', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-clarify',
      source: 'tui-scratch',
      rawText: '\n\n====\n',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });
    const question = session.draft?.openQuestions[0];
    expect(question).toBeTruthy();
    const resolved = applyDashboardIntakeClarifyAnswers(store, session.intakeId, [{
      questionId: question!.id,
      value: 'keep this as backlog',
    }]);
    expect(resolved.output).toContain(`resolved ${question!.id}`);
    expect(resolved.session.state).toBe('review-ready');
  });

  test('backlog-only action returns the backlog review follow-up', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-backlog',
      source: 'tui-scratch',
      rawText: '- compare two repos',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });
    const result = await applyDashboardIntakeReviewAction(store, {
      kind: 'decide-backlog-only',
      intakeId: session.intakeId,
    });
    expect(result.output).toContain('backlog-only');
    expect(result.session?.decision?.mode).toBe('backlog-only');
    expect(buildIntakeNextActions(result.session!, 'slash')[0]?.label).toBe('Review backlog intake');
  });

  test('modal refreshes through clarify and review transitions', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-modal',
      source: 'tui-scratch',
      rawText: '\n\n====\n',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });

    const artifacts: string[] = [];
    const pushed: string[] = [];
    const statuses: string[] = [];
    const mountedOwners: Array<string | undefined> = [];
    let requestSubmit: ((answers: { questionId: string; value: unknown }[]) => void) | null = null;
    let dialogSubmit: ((value: unknown) => void) | null = null;

    const createArtifact = (
      current: typeof session,
      options = {},
    ): DeclarativeRuntimeArtifact => {
      artifacts.push(current.state);
      requestSubmit = options.viewDeps?.onRequestSubmit
        ? (answers) => options.viewDeps?.onRequestSubmit?.(answers as any)
        : null;
      dialogSubmit = options.viewDeps?.onDialogSubmit ?? null;
      return {
        kind: 'view',
        spec: { type: 'intake-review', chrome: { title: current.intakeId }, config: {} },
        view: makeFakeView(),
      };
    };

    await openDashboardIntakeReviewModal(session, {
      store,
      ownerWorkspaceId: 'virtual-window:8',
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface: (surface) => {
        pushed.push(surface.id);
        return { dispose: () => {} };
      },
      redraw: () => {},
      onStatus: (line) => { statuses.push(line); },
      createArtifact,
      mountSurface: (handle) => {
        pushed.push(handle.surface.id);
        mountedOwners.push(handle.surface.ownerWorkspaceId);
        return { dispose: () => {} };
      },
    });

    expect(artifacts).toEqual(['clarifying']);
    expect(mountedOwners[0]).toBe('virtual-window:8');
    expect(requestSubmit).toBeTruthy();
    requestSubmit?.([{ questionId: session.draft!.openQuestions[0]!.id, value: 'keep this as backlog' }]);
    await Promise.resolve();
    expect(artifacts).toEqual(['clarifying', 'review-ready']);
    expect(dialogSubmit).toBeTruthy();
    dialogSubmit?.({ kind: 'decide-backlog-only', intakeId: session.intakeId });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSession(session.intakeId)?.decision?.mode).toBe('backlog-only');
    expect(statuses.join('\n')).toContain('backlog-only');
  });

  test('session picker reuses search modal and opens review for selected intake', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-pick',
      source: 'tui-scratch',
      rawText: '- compare two repos',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });
    let accepted: ((item: SearchItem) => void) | null = null;
    const mounted: string[] = [];
    let pushedSurface: any = null;
    const createArtifact = (): DeclarativeRuntimeArtifact => ({
      kind: 'view',
      spec: { type: 'intake-review', chrome: { title: session.intakeId }, config: {} },
      view: makeFakeView(),
    });

    openDashboardIntakeSessionPicker([session], {
      store,
      ownerWorkspaceId: 'virtual-window:6',
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface: (surface) => {
        pushedSurface = surface;
        mounted.push(surface.id);
        return { dispose: () => {} };
      },
      redraw: () => {},
      createSearchModal: (spec) => {
        accepted = spec.onAccept;
        return {
          surface: {
            id: spec.id,
            owner: 'dashboard',
            kind: 'modal',
            tier: 'dialog',
            focus: 'owns',
            priority: 1,
            bounds: spec.bounds,
            render: () => [],
            paint: () => '',
            cursor: () => null,
          },
          type: () => {},
          backspace: () => {},
          up: () => {},
          down: () => {},
          accept: () => {},
          cancel: () => {},
          state: () => ({ query: '', items: [], selectedIdx: 0 }),
        };
      },
      createArtifact,
      mountSurface: (handle) => {
        mounted.push(handle.surface.id);
        return { dispose: () => {} };
      },
    });

    expect(mounted[0]).toBe('intake-session-picker');
    expect(pushedSurface?.ownerWorkspaceId).toBe('virtual-window:6');
    expect(accepted).toBeTruthy();
    accepted?.({ label: 'pick', payload: session.intakeId });
    expect(mounted).toContain(`intake-review:${session.intakeId}`);
  });

  test('session picker query matching is case-insensitive across title and raw text', () => {
    const store = createIntakeStore({ archiveDir: null });
    const alpha = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-alpha',
      source: 'discord',
      rawText: '- fix Voice trigger',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });
    const beta = captureAndDraftIntakeRecord(store, {
      intakeId: 'intake-beta',
      source: 'slack',
      rawText: '- dashboard polish',
      attachments: [],
      receivedAt: '2026-04-30T00:00:00.000Z',
    });
    let onQuery: ((query: string) => SearchItem[]) | null = null;

    openDashboardIntakeSessionPicker([alpha, beta], {
      store,
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface: () => ({ dispose: () => {} }),
      redraw: () => {},
      createSearchModal: (spec) => {
        onQuery = spec.onQuery;
        return {
          surface: {
            id: spec.id,
            owner: 'dashboard',
            kind: 'modal',
            tier: 'dialog',
            focus: 'owns',
            priority: 1,
            bounds: spec.bounds,
            render: () => [],
            paint: () => '',
            cursor: () => null,
          },
          type: () => {},
          backspace: () => {},
          up: () => {},
          down: () => {},
          accept: () => {},
          cancel: () => {},
          state: () => ({ query: '', items: [], selectedIdx: 0 }),
        };
      },
      createArtifact: () => ({
        kind: 'view',
        spec: { type: 'intake-review', chrome: { title: alpha.intakeId }, config: {} },
        view: makeFakeView(),
      }),
      mountSurface: () => ({ dispose: () => {} }),
    });

    expect(onQuery).toBeTruthy();
    expect(onQuery?.('VOICE').map((item) => item.payload)).toEqual(['intake-alpha']);
    expect(onQuery?.('dashboard').map((item) => item.payload)).toEqual(['intake-beta']);
    expect(onQuery?.('').map((item) => item.payload)).toEqual(['intake-alpha', 'intake-beta']);
  });
});
