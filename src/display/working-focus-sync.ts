// IDX-F3.5a — pure decision helper for `setWorkingFocus` wrapper in
// dashboard.ts. Takes the inputs that the projection block used to
// consult per frame (modal stack, current coordinator focus,
// derived surfaceId) and returns the action the wrapper should take.
//
// Factored out so the invariants (skip when modal owns focus, skip
// when an execution surface owns focus, sync otherwise) can be
// unit-tested without standing up a full dashboard harness. Once
// F3.5c deletes the projection block this helper becomes the sole
// gate between `workingDir.focus` writes and `display.setFocus`.

export type WorkingFocusSyncAction =
  | { action: 'sync'; target: string }
  | { action: 'skip'; reason: 'modal' | 'execution' | 'no-mapping' };

export function computeWorkingFocusSync(
  opts: {
    surfaceId: string | null;
    currentFocus: string | null;
    blockingForegroundModalOpen: boolean;
  },
): WorkingFocusSyncAction {
  if (opts.blockingForegroundModalOpen) {
    return { action: 'skip', reason: 'modal' };
  }
  if (opts.currentFocus?.startsWith('execution:')) {
    return { action: 'skip', reason: 'execution' };
  }
  if (opts.surfaceId === null) {
    return { action: 'skip', reason: 'no-mapping' };
  }
  return { action: 'sync', target: opts.surfaceId };
}
