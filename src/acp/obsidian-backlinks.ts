// PLAN-ipad-notes-obsidian-typora §5 Phase O3·1 (2026-05-17) —
// Vault backlinks via ripgrep reverse index.
//
// Given a target note (basename without `.md`), scan the vault for
// other `.md` files that reference it via Obsidian wikilink syntax:
//   [[Target]]              → exact match
//   [[Target|Alias]]        → match with display alias
//   [[Target#Heading]]      → match with heading anchor
//   [[Path/Target]]         → match by relative path
//
// The pattern intentionally errs on the side of overmatching aliased /
// pathed forms so a rename refactor catches every dangling reference.
// Same-note self-references (`[[Target]]` inside `Target.md` itself)
// are filtered out — the caller asks "who points at me," not "do I
// reference myself."

import { spawn } from 'node:child_process';

export interface BacklinkMatch {
  /** Vault-relative path of the file containing the link. */
  path: string;
  /** 1-based line number where the wikilink appears. */
  lineNumber: number;
  /** Trimmed line snippet (~240 chars cap) for context preview. */
  snippet: string;
  /** C4 (2026-05-17) — heading anchor on the matched wikilink, if any.
   *  `[[Target#heading-name]]` → "heading-name". When the backlink
   *  points at a specific section, iOS can render this as a chip beside
   *  the path so the user sees the inbound link's intent at a glance.
   *  Empty/undefined when the wikilink form was plain (`[[Target]]`)
   *  or aliased (`[[Target|Alias]]`).
   */
  anchor?: string;
}

export interface BacklinkResult {
  matches: BacklinkMatch[];
  error?: string;
}

export interface FindBacklinksOpts {
  vaultRoot: string;
  /** Note basename without `.md` extension (e.g. `"My Project"` to
   *  find references to `My Project.md` or `Folder/My Project.md`). */
  target: string;
  /** Cap total matches returned. Default 100. */
  limit?: number;
  /** Test seam — override the rg binary path. */
  rgBin?: string;
}

/** C4 (2026-05-17) — extract the heading anchor (`#…`) from a wikilink
 *  pointing at `target`, when one appears in the supplied snippet.
 *  Returns the heading slug without the leading `#`, or undefined if
 *  the wikilink is plain or aliased. Tolerates path-prefixed and
 *  aliased forms. Exposed for tests. */
export function extractHeadingAnchor(snippet: string, target: string): string | undefined {
  const escaped = target.trim().replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
  const pattern = new RegExp(
    `\\[\\[(?:[^\\]\\|#]*/)?${escaped}#([^\\]\\|]+)(?:\\|[^\\]]+)?\\]\\]`,
  );
  const m = pattern.exec(snippet);
  if (!m || !m[1]) return undefined;
  return m[1].trim();
}

/** Build the regex pattern that captures Obsidian wikilink forms for
 *  `target`. Exposed for tests so the pattern can be inspected in
 *  isolation without spawning rg. */
export function buildBacklinkPattern(target: string): string {
  const escaped = target.trim().replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
  // Pattern breakdown:
  //   \[\[                              — literal opening
  //   (?:[^\]\|#]*/)?                   — optional path prefix (e.g. "Folder/")
  //   <escaped target>                  — the note basename, regex-escaped
  //   (?:[\|#][^\]]*)?                  — optional |alias or #heading
  //   \]\]                              — literal closing
  return `\\[\\[(?:[^\\]\\|#]*/)?${escaped}(?:[\\|#][^\\]]*)?\\]\\]`;
}

export async function findBacklinks(opts: FindBacklinksOpts): Promise<BacklinkResult> {
  const target = opts.target.trim();
  if (!target) {
    return { matches: [], error: 'target-required' };
  }
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : 100;
  const pattern = buildBacklinkPattern(target);
  const rgBin = opts.rgBin ?? 'rg';
  const selfPath = `${target}.md`; // exact filename we filter out below

  return await new Promise<BacklinkResult>((resolve) => {
    const rg = spawn(rgBin, [
      '--json',
      '--line-number',
      '--type-add', 'md:*.md',
      '--type', 'md',
      '-e', pattern,
      opts.vaultRoot,
    ]);
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    rg.stdout.on('data', (data: Buffer) => stdoutChunks.push(data));
    rg.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    rg.on('error', (err: Error) => {
      resolve({ matches: [], error: `rg-spawn: ${err.message}` });
    });
    rg.on('close', (code: number | null) => {
      // rg exits 0 when matches found, 1 when none, 2+ on error.
      if (code !== 0 && code !== 1) {
        resolve({ matches: [], error: `rg-exit-${code}: ${stderr.slice(0, 200)}` });
        return;
      }
      const output = Buffer.concat(stdoutChunks).toString('utf8');
      const matches: BacklinkMatch[] = [];
      for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type !== 'match') continue;
          const data = evt.data;
          const filePath: string = data?.path?.text ?? '';
          const lineNumber: number = data?.line_number ?? 0;
          const snippetRaw: string = data?.lines?.text ?? '';
          const snippet = snippetRaw.replace(/\n+$/, '').slice(0, 240);
          const relPath = filePath.startsWith(opts.vaultRoot + '/')
            ? filePath.slice(opts.vaultRoot.length + 1)
            : filePath;
          // Skip self-references — a note pointing at its own basename
          // isn't a "backlink" by Obsidian convention.
          if (relPath === selfPath) continue;
          if (relPath.endsWith('/' + selfPath)) continue;
          // C4 (2026-05-17) — surface heading anchor when present in
          // the matched wikilink. Re-runs a wikilink regex on the
          // snippet (cheap) so the parser stays self-contained instead
          // of asking rg for capture groups (rg's --replace mode doesn't
          // mix well with --json). Picks the FIRST anchor on the line
          // — multi-link lines with different anchors keep only the
          // headline; full per-link backlinks belong in a future
          // structured backlinks API.
          const anchor = extractHeadingAnchor(snippet, target);
          matches.push({
            path: relPath,
            lineNumber,
            snippet,
            ...(anchor ? { anchor } : {}),
          });
          if (matches.length >= limit) break;
        } catch {
          // rg occasionally emits non-JSON debug lines under load — skip.
        }
      }
      resolve({ matches });
    });
  });
}
