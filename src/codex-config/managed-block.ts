// PLAN-codex-app-server-hermes-parity §5 Phase H3·1 (2026-05-16) —
// marker-aware regenerate of a managed section inside a foreign config
// file. The intent is to wire codex's `~/.codex/config.toml` so codex
// learns to spawn `elanous mcp serve` (exposing the 5 elanous_* tools
// landed in H1·5a-e), WITHOUT clobbering the user's hand-edited
// model / projects / mcp_servers entries that live OUTSIDE our
// managed section.
//
// Marker shape (matches Hermes parity):
//
//   # managed by monad-agent — `elanous codex config-migrate` regenerates this section
//   …generated block…
//   # end monad-agent managed section
//
// First call appends the block after a separator. Subsequent calls
// replace the existing managed section in place. The bytes outside
// the markers are passed through verbatim — even byte-identical
// whitespace + comments survive a regenerate.

export const MARKER_START =
  '# managed by monad-agent — `elanous codex config-migrate` regenerates this section';
export const MARKER_END = '# end monad-agent managed section';

export interface RegenerateOpts {
  /** Override the marker pair (tests). Production callers omit. */
  startMarker?: string;
  endMarker?: string;
}

export interface RegenerateResult {
  /** Full file contents after the regenerate. */
  content: string;
  /** `true` when an existing managed section was replaced;
   *  `false` when the section was newly appended. */
  replaced: boolean;
}

/** Insert or replace the managed section inside `existing`. The
 *  generated block must NOT contain the markers themselves — they
 *  are emitted by this function. */
export function regenerateManagedBlock(
  existing: string,
  generatedBody: string,
  opts: RegenerateOpts = {},
): RegenerateResult {
  const startMarker = opts.startMarker ?? MARKER_START;
  const endMarker = opts.endMarker ?? MARKER_END;
  const trimmedBody = generatedBody.replace(/\n+$/, '');
  const wrapped = `${startMarker}\n${trimmedBody}\n${endMarker}`;

  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    // First write — append after the existing content, with a single
    // blank-line separator so the section visually detaches from the
    // user's hand-edits above.
    const trimmedExisting = existing.replace(/\n+$/, '');
    const separator = trimmedExisting.length === 0 ? '' : '\n\n';
    return {
      content: `${trimmedExisting}${separator}${wrapped}\n`,
      replaced: false,
    };
  }

  // In-place replacement. Slice […startIdx) + wrapped + (endIdx +
  // endMarker.length…]. The bytes outside the markers are byte-
  // identical to the input — this is the user-content preservation
  // guarantee that lets us safely re-run migrate on hand-edited
  // config.toml files.
  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + endMarker.length);
  return {
    content: `${before}${wrapped}${after}`,
    replaced: true,
  };
}

/** Strip an existing managed section (returns the input unchanged
 *  when no markers are found). Useful for tests + `migrate --remove`. */
export function removeManagedBlock(
  existing: string,
  opts: RegenerateOpts = {},
): { content: string; removed: boolean } {
  const startMarker = opts.startMarker ?? MARKER_START;
  const endMarker = opts.endMarker ?? MARKER_END;
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { content: existing, removed: false };
  }
  const before = existing.slice(0, startIdx).replace(/\n+$/, '');
  const after = existing.slice(endIdx + endMarker.length).replace(/^\n+/, '');
  const separator = before.length > 0 && after.length > 0 ? '\n\n' : '';
  const trail = before.length > 0 || after.length > 0 ? '\n' : '';
  return {
    content: `${before}${separator}${after}`.replace(/\n+$/, '') + trail,
    removed: true,
  };
}
