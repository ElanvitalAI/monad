// ── B4 선결 — the design-check VERDICT as data, not as stdout ──
//
// `runRepositoryDesignCheck` (src/cli/repo-cli.ts) already computed exactly the
// verdict two surfaces want to render — which craft rulebooks a DESIGN.md
// declares, and which of those cannot be found. But it returned an EXIT CODE
// and printed the lists through `deps.out.log`, so the only consumer that could
// ever use it was a terminal. Any renderer (PWA panel, TUI pane, daemon route)
// would have had to re-implement the directory scan + parse, which is how a
// second, drifting copy of a rule normally gets born in this repository.
//
// So the verdict moves here, dependency-injected and free of CLI/Commander
// imports, and the CLI becomes one of its renderers. Nothing about the CLI's
// observable behaviour changes — the strings and exit codes are asserted
// unchanged by `src/cli/repo-cli.test.ts`.
//
// ⛔ This module deliberately does NOT read the filesystem itself. The caller
//    supplies `readdir` / `readFile`, because the daemon and the CLI resolve
//    the craft directory from different roots (installation dir vs cwd), and
//    baking one of them in here is precisely the `process.cwd()` coupling that
//    `#11793` had to undo.

import { parseDesignDocument } from './design-doc.js';

export interface DesignCheckDeps {
  readFile: (path: string, encoding: 'utf8') => string;
  readdir: (path: string) => readonly string[];
}

/** A verdict that was actually computed. */
export interface DesignCheckVerdict {
  ok: true;
  documentPath: string;
  craftDirectory: string;
  /** Every rulebook the craft directory offers, whether declared or not.
   *  Renderers use this to show "available but not declared" without a
   *  second directory scan. */
  availableRulebooks: readonly string[];
  declaredRulebooks: readonly string[];
  /** Declared names with no matching file. Non-empty ⇒ the CLI exits 1. */
  unavailableRulebooks: readonly string[];
}

/** A verdict that could not be computed, naming what could not be read.
 *  ⭐ Modelled as a VALUE rather than a thrown error so a renderer can show
 *  "blocked, and here is why" instead of an empty list — an empty list and an
 *  unreadable directory look identical once the reason is thrown away. */
export interface DesignCheckBlocked {
  ok: false;
  /** Which read failed. Renderers key their message off this, not off prose. */
  blockedOn: 'craft-directory' | 'design-document';
  /** The path that could not be read. */
  path: string;
}

export type DesignCheckOutcome = DesignCheckVerdict | DesignCheckBlocked;

/** Rulebook files live as `<name>.md` in the craft directory. `NOTICE.md` is
 *  the vendoring/licence record, not a rulebook, so it never counts. */
function availableRulebooksIn(directory: string, deps: DesignCheckDeps): string[] {
  return deps.readdir(directory)
    .filter((name) => name.endsWith('.md') && name !== 'NOTICE.md')
    .map((name) => name.slice(0, -'.md'.length));
}

/** Computes the design-check verdict for one DESIGN.md against one craft
 *  directory. Pure with respect to the injected reads — no cwd, no process. */
export function resolveDesignCheck(
  documentPath: string,
  craftDirectory: string,
  deps: DesignCheckDeps,
): DesignCheckOutcome {
  let availableRulebooks: string[];
  try {
    availableRulebooks = availableRulebooksIn(craftDirectory, deps);
  } catch {
    return { ok: false, blockedOn: 'craft-directory', path: craftDirectory };
  }
  let document: string;
  try {
    document = deps.readFile(documentPath, 'utf8');
  } catch {
    return { ok: false, blockedOn: 'design-document', path: documentPath };
  }
  const parsed = parseDesignDocument(document, availableRulebooks);
  return {
    ok: true,
    documentPath,
    craftDirectory,
    availableRulebooks,
    declaredRulebooks: parsed.declaredRulebooks,
    unavailableRulebooks: parsed.unavailableRulebooks,
  };
}

/** The exit code the CLI reports for an outcome. Kept beside the verdict so a
 *  renderer that wants "is this repository healthy?" asks one question instead
 *  of re-deriving the rule from the shape. */
export function designCheckExitCode(outcome: DesignCheckOutcome): 0 | 1 {
  if (!outcome.ok) return 1;
  return outcome.unavailableRulebooks.length ? 1 : 0;
}
