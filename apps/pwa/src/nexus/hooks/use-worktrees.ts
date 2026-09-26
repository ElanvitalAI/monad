// PWA · BACKLOG #5 — active worktrees hook.
//
// Wraps GET /v1/worktrees. State changes when:
//   • EnterWorktree / ExitWorktree LLM tool runs
//   • A elanous session crashes mid-worktree (creates an orphan)
//   • `git worktree add/remove` from CLI
// 5s refetch is a sweet spot: fast enough to feel live during
// interactive work, cheap enough that the spawn-git poll doesn't
// thrash. (No SSE event for worktree state yet; future PR could
// fire `worktree.changed` from the EnterWorktree/ExitWorktree
// runtimes.)

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';
import { NexusApiError } from '../client';
import type {
  DisposeWorktreeBody,
  DisposeWorktreeResponse,
  WorktreesResponse,
} from '../client';

export function useWorktrees(opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery<WorktreesResponse>({
    queryKey: nexusKeys.worktrees(),
    queryFn: () => client.getWorktrees(),
    enabled: opts.enabled ?? true,
    refetchInterval: 5_000,
  });
}

/** Pull a structured `DisposeWorktreeResponse` out of a NexusApiError
 *  whose body carries one. Returns null when the error is unrelated
 *  (e.g. transport failure, malformed JSON) — caller re-throws in
 *  that case. Pure so the unwrap behavior is unit-testable without
 *  spinning up react-query. */
export function unwrapDisposeApiError(err: unknown): DisposeWorktreeResponse | null {
  if (err instanceof NexusApiError && err.body && typeof err.body === 'object') {
    const b = err.body as DisposeWorktreeResponse;
    if ('ok' in b) return b;
  }
  return null;
}

/** HANDOFF §4.2 — dispose mutation. Posts a worktree path (or orphan
 *  session's worktreePath) to `POST /v1/worktrees/dispose`. On
 *  success, invalidates the worktrees query so the table refreshes.
 *
 *  Endpoint returns 4xx with a structured body for semantic errors
 *  ("cannot dispose main worktree", "git-worktree-failed" when the
 *  worktree is dirty, etc.). The transport layer raises that as a
 *  `NexusApiError` whose `.body` carries the same fields a 200
 *  response would have. We unwrap that here so callers get a uniform
 *  `DisposeWorktreeResponse` shape regardless of HTTP status — UI
 *  toasts can render `result.error` directly. */
export function useDisposeWorktree() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation<DisposeWorktreeResponse, Error, DisposeWorktreeBody>({
    mutationFn: async (body) => {
      try {
        return await client.disposeWorktree(body);
      } catch (err) {
        const unwrapped = unwrapDisposeApiError(err);
        if (unwrapped) return unwrapped;
        throw err;
      }
    },
    onSuccess: (result) => {
      if (result.ok) qc.invalidateQueries({ queryKey: nexusKeys.worktrees() });
    },
  });
}
