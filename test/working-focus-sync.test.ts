// IDX-F3.5a — computeWorkingFocusSync decision gate.
//
// The pure helper behind dashboard.ts's `setWorkingFocus` wrapper. It
// replaces the per-frame projection block (dashboard.ts:6302-6314)
// with a per-assignment call, preserving the same three-rule
// invariant: skip when a modal owns focus, skip when an execution
// surface owns focus, sync to the derived surfaceId otherwise.

import { describe, test, expect } from 'bun:test';
import { computeWorkingFocusSync } from '../src/display/working-focus-sync.js';

describe('computeWorkingFocusSync', () => {
  test('syncs to the mapped surfaceId when no modal and no execution surface', () => {
    expect(computeWorkingFocusSync({
      surfaceId: 'wd-browser',
      currentFocus: 'pane:input',
      blockingForegroundModalOpen: false,
    })).toEqual({ action: 'sync', target: 'wd-browser' });
  });

  test('syncs when current focus is null (first projection)', () => {
    expect(computeWorkingFocusSync({
      surfaceId: 'wd-log',
      currentFocus: null,
      blockingForegroundModalOpen: false,
    })).toEqual({ action: 'sync', target: 'wd-log' });
  });

  test('skips with reason=modal when a blocking foreground modal is open', () => {
    expect(computeWorkingFocusSync({
      surfaceId: 'wd-browser',
      currentFocus: 'pane:input',
      blockingForegroundModalOpen: true,
    })).toEqual({ action: 'skip', reason: 'modal' });
  });

  test('does not skip for non-blocking foreground surfaces', () => {
    expect(computeWorkingFocusSync({
      surfaceId: 'wd-browser',
      currentFocus: 'pane:input',
      blockingForegroundModalOpen: false,
    })).toEqual({ action: 'sync', target: 'wd-browser' });
  });

  test('skips with reason=execution when an execution surface owns focus', () => {
    expect(computeWorkingFocusSync({
      surfaceId: 'wd-browser',
      currentFocus: 'execution:abc-123',
      blockingForegroundModalOpen: false,
    })).toEqual({ action: 'skip', reason: 'execution' });
  });

  test('modal rule takes precedence over execution rule', () => {
    // If both a modal is open and execution owns focus, we still skip
    // for "modal" — the more specific reason wins the debug log.
    expect(computeWorkingFocusSync({
      surfaceId: 'wd-browser',
      currentFocus: 'execution:abc-123',
      blockingForegroundModalOpen: true,
    })).toEqual({ action: 'skip', reason: 'modal' });
  });

  test('skips with reason=no-mapping when surfaceId is null', () => {
    expect(computeWorkingFocusSync({
      surfaceId: null,
      currentFocus: 'pane:input',
      blockingForegroundModalOpen: false,
    })).toEqual({ action: 'skip', reason: 'no-mapping' });
  });

  test('plugin-style surfaceId strings are passed through unchanged', () => {
    expect(computeWorkingFocusSync({
      surfaceId: 'plugin:sync:roster-42',
      currentFocus: 'pane:input',
      blockingForegroundModalOpen: false,
    })).toEqual({ action: 'sync', target: 'plugin:sync:roster-42' });
  });
});
