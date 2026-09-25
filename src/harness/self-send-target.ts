export type SelfSendTargetResolution =
  | { kind: 'space'; spaceId: string }
  | { kind: 'space'; spaceId: string; via: 'pty'; ptyId: string }
  | {
    kind: 'refuse';
    reason: 'tui-self-report-has-no-inbox-reader' | 'pty-not-found' | 'pty-has-no-space';
    hint?: string;
  };

export interface SelfSendTargetDeps {
  getPtyManifest(id: string): { spaceId: string; ptyPid?: number } | null;
  listPtyManifestRows(): Array<{ id: string; spaceId: string; ptyPid?: number }>;
}

export function resolveSelfSendTarget(requested: string, deps: SelfSendTargetDeps): SelfSendTargetResolution {
  if (requested.startsWith('pty_')) {
    const manifest = deps.getPtyManifest(requested);
    if (manifest === null) return { kind: 'refuse', reason: 'pty-not-found' };
    if (manifest.spaceId === '') return { kind: 'refuse', reason: 'pty-has-no-space' };
    return { kind: 'space', spaceId: manifest.spaceId, via: 'pty', ptyId: requested };
  }

  if (requested.startsWith('tui:')) {
    const ptyPid = Number(requested.slice('tui:'.length));
    const matchingRow = Number.isInteger(ptyPid)
      ? deps.listPtyManifestRows().find((row) => row.ptyPid === ptyPid && row.spaceId !== '')
      : undefined;
    return {
      kind: 'refuse',
      reason: 'tui-self-report-has-no-inbox-reader',
      ...(matchingRow === undefined ? {} : { hint: matchingRow.spaceId }),
    };
  }

  return { kind: 'space', spaceId: requested };
}
