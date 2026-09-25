import type { TransferTarget } from '../transfer/transfer-targets.js';

export interface DashboardTransferFeedbackRuntimeDeps {
  muted: (text: string) => string;
  warning: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
  pushChatLine: (line: string) => void;
  setChatScrollBottom: () => void;
  draw: () => void;
  basename: (path: string) => string;
}

/**
 * Structural mirror of `SshTransferProgress` (../transfer/ssh-transfer.ts).
 * The real event is a discriminated union: the `mkdir` prelude phase carries
 * no file coordinates, while the per-file phases (`start`/`done`/`error`)
 * always have index/total/localPath. Modeling it as a union (rather than a
 * single interface with mandatory fields) lets the whole real union be passed
 * in, while the `done`/`error` branches below still narrow to non-optional
 * index/total/localPath.
 */
export type DashboardSshTransferProgressLike =
  | { phase: 'mkdir'; remoteDir?: string; index?: number; total?: number; localPath?: string; message?: string }
  | { phase: 'start' | 'done' | 'error'; index: number; total: number; localPath: string; message?: string };

export interface DashboardSshTransferResultLike {
  uploaded: string[];
  failed: Array<unknown>;
}

export interface DashboardIphoneTransferResultLike {
  ok: boolean;
  transport?: string;
  uploaded?: string[];
  pushcutUrls?: string[];
  reason?: string;
  message?: string;
}

export function createDashboardTransferFeedbackRuntime(
  deps: DashboardTransferFeedbackRuntimeDeps,
) {
  const push = (line: string): void => {
    deps.pushChatLine(line);
    deps.setChatScrollBottom();
    deps.draw();
  };

  return {
    onNoFilesToTransfer(): void {
      push(deps.warning('  no files to transfer.'));
    },
    onTransferDisabled(reason?: string | null): void {
      push(deps.warning(`  ${reason ?? 'transfer is disabled for this browser.'} — exit remote mode (Esc) first.`));
    },
    onNoTransferTargets(): void {
      push(deps.warning('  no transfer targets configured.'));
    },
    onTransferStarted(target: TransferTarget, fileCount: number): void {
      push(deps.muted(`  sending ${fileCount} file${fileCount === 1 ? '' : 's'} → ${target.name}…`));
    },
    onSshProgress(evt: DashboardSshTransferProgressLike): void {
      if (evt.phase === 'done') {
        push(deps.muted(`  ✓ ${evt.index + 1}/${evt.total} ${deps.basename(evt.localPath)}`));
      } else if (evt.phase === 'error') {
        push(deps.error(`  ✗ ${deps.basename(evt.localPath)} — ${evt.message ?? 'error'}`));
      }
    },
    onSshTransferCompleted(target: Extract<TransferTarget, { kind: 'ssh' }>, result: DashboardSshTransferResultLike): void {
      push(
        result.failed.length === 0
          ? deps.success(`  ✓ uploaded ${result.uploaded.length} → ${target.host.name}:${target.remoteDir}`)
          : deps.warning(`  ⚠ ${result.uploaded.length} uploaded, ${result.failed.length} failed → ${target.host.name}`),
      );
    },
    onIphoneTransferCompleted(target: TransferTarget, result: DashboardIphoneTransferResultLike): void {
      if (result.ok) {
        push(deps.success(`  ✓ sent to ${target.name} via ${result.transport} (${result.uploaded?.length ?? 0} file${(result.uploaded?.length ?? 0) === 1 ? '' : 's'})`));
        for (const url of result.pushcutUrls ?? []) {
          push(deps.muted(`    ${url}`));
        }
        return;
      }
      push(deps.error(`  ✗ iPhone transfer failed (${result.reason}): ${result.message}`));
    },
    onTransferCrashed(error: unknown): void {
      push(deps.error(`  transfer crashed: ${error instanceof Error ? error.message : String(error)}`));
    },
  };
}
