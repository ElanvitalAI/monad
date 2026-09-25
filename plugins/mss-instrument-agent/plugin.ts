// ── MSS Instrumentation Assistant plugin ────────────────────────────
//
// MSS M2.2 Phase C2 — `/mss-review [branch]` slash command that
// collects a git diff against a base branch (default: main) and hands
// it to the `mss-instrument-reviewer` subagent for a read-only audit
// of missing `debug.log` call sites + proposed categories / structured
// fields per PLAN §11.5.
//
// Solo-dev dogfood path: the slash command writes the diff to a temp
// file under `/tmp/mss-review-<ts>.diff` and prints a ready-to-paste
// prompt the user can hand to the primary assistant (LLM), which then
// invokes the Agent tool with `subagent_type=mss-instrument-reviewer`.
// Skipping the in-process agent spawn keeps the plugin simple — the
// Monad agent-team plugin already owns that pathway and the reviewer
// runs there identically.
//
// See `agents/mss-instrument-reviewer.md` for the reviewer prompt and
// `내부 문서` §2.3 PR #C2 for
// the surrounding M2.2 Phase C wire-up plan.

import type {
  MonadPlugin,
  PluginContext,
  SlashCommand,
} from '../../src/plugins/core/types.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

interface MssReviewResult {
  base: string;
  head: string;
  diffPath: string;
  diffBytes: number;
  changedFiles: number;
  insertions: number;
  deletions: number;
}

const DEFAULT_BASE_BRANCH = 'main';

/** Exported so tests can exercise the collector without spawning a
 *  shell. Accepts injected command runners to stay hermetic. */
export function collectMssReviewDiff(opts: {
  base?: string;
  head?: string;
  git?: (args: readonly string[]) => string;
  writeFile?: (path: string, contents: string) => void;
  now?: () => number;
  tmpDir?: string;
} = {}): MssReviewResult {
  const base = opts.base ?? DEFAULT_BASE_BRANCH;
  const head = opts.head ?? 'HEAD';
  const git = opts.git ?? ((args) => execFileSync('git', [...args], { encoding: 'utf8' }));
  const writeFile = opts.writeFile ?? ((p, c) => { writeFileSync(p, c, 'utf8'); });
  const now = opts.now ?? Date.now;
  const tmpBase = opts.tmpDir ?? tmpdir();

  const diff = git(['diff', `${base}..${head}`]);
  const statRaw = git(['diff', '--shortstat', `${base}..${head}`]).trim();
  const { changedFiles, insertions, deletions } = parseShortStat(statRaw);

  const outDir = joinPath(tmpBase, 'monad-mss-review');
  mkdirSync(outDir, { recursive: true });
  const diffPath = joinPath(outDir, `diff-${now()}.diff`);
  writeFile(diffPath, diff);

  return {
    base,
    head,
    diffPath,
    diffBytes: Buffer.byteLength(diff, 'utf8'),
    changedFiles,
    insertions,
    deletions,
  };
}

/** Parse `git diff --shortstat` — ` 3 files changed, 42 insertions(+), 7 deletions(-)`.
 *  Returns zeros for each missing component so absent additions or
 *  deletions (delete-only / insert-only diffs) don't trip the parser. */
export function parseShortStat(line: string): {
  changedFiles: number;
  insertions: number;
  deletions: number;
} {
  const filesMatch = line.match(/(\d+)\s+files?\s+changed/);
  const insMatch = line.match(/(\d+)\s+insertions?/);
  const delMatch = line.match(/(\d+)\s+deletions?/);
  return {
    changedFiles: filesMatch ? Number(filesMatch[1]) : 0,
    insertions: insMatch ? Number(insMatch[1]) : 0,
    deletions: delMatch ? Number(delMatch[1]) : 0,
  };
}

/** Render the paste-ready prompt the user hands to the primary
 *  assistant so the Agent tool picks up `subagent_type=mss-instrument
 *  -reviewer` against the captured diff. Kept as a pure function so
 *  tests can assert the exact shape without spawning a subagent. */
export function renderMssReviewPrompt(r: MssReviewResult): string[] {
  const lines: string[] = [];
  lines.push(`[mss-review] diff captured: ${r.base}..${r.head}`);
  lines.push(`[mss-review]   files=${r.changedFiles} +${r.insertions} -${r.deletions}  bytes=${r.diffBytes}`);
  lines.push(`[mss-review]   path=${r.diffPath}`);
  lines.push('');
  lines.push('[mss-review] paste this to the primary assistant to run the reviewer:');
  lines.push('');
  lines.push(`Run the Agent tool with subagent_type="mss-instrument-reviewer" against`);
  lines.push(`the diff at ${r.diffPath}. Audit the added/changed code paths for missing`);
  lines.push(`debug.log call sites at critical junctions (routing, modal, focus, picker,`);
  lines.push(`dispatch) and return a proposal per PLAN §11.5 (file, line, category,`);
  lines.push(`event name, structured fields, one-line rationale).`);
  return lines;
}

const slashCommands: SlashCommand[] = [
  {
    name: 'mss-review',
    description:
      'Audit the current branch diff for missing debug.log sites (M2.2 · mss-instrument-reviewer subagent)',
    handler: async (args, ctx) => {
      const base = (args[0] && args[0].length > 0) ? args[0] : DEFAULT_BASE_BRANCH;
      try {
        const result = collectMssReviewDiff({ base });
        if (result.changedFiles === 0) {
          ctx.log(`[mss-review] no changes between ${result.base}..${result.head} — nothing to review`);
          return;
        }
        for (const line of renderMssReviewPrompt(result)) ctx.log(line);
      } catch (err) {
        ctx.log(`[mss-review] git diff failed: ${(err as Error).message}`);
      }
    },
  },
];

const plugin: MonadPlugin<Record<string, never>> = {
  name: 'mss-instrument-agent',
  version: '0.2.0',
  description:
    'MSS Instrumentation Assistant — hosts the mss-instrument-reviewer subagent and the /mss-review slash command that captures a branch diff for review',

  initialState(): Record<string, never> {
    return {};
  },

  panes: {},
  slashCommands,

  async onActivate(ctx: PluginContext) {
    ctx.log('[mss-instrument-agent] activated · /mss-review [base-branch] to capture a diff + reviewer prompt');
  },
};

export default plugin;
