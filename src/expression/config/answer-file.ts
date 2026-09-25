// Answer-file load / save for the setup wizard. JSON-encoded for
// zero new deps; the file is small + flat enough that the human-
// readability gap vs TOML is minor. Default location:
// `~/.config/monad/setup-answers.json`. Users typically edit this
// once per machine, then run `monad setup --config <path>` for
// non-interactive deploys (CI, dotfile bootstrap).
//
// Schema is open: we don't try to validate against `UserConfig`
// here — the wizard layer treats the parsed value as a partial
// override and lets the merge + later validation catch bad fields.
// An omitted, absent default file falls through to an empty partial so
// first-run bootstrap can continue. Explicit files must be readable and valid.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { migrateLegacyXdgFile } from '../../storage/legacy-monad-dir-migrate.js';

export interface AnswerFile {
  /** Schema version. Bump on breaking shape changes; old files keep
   *  parsing thanks to the partial merge. */
  schema_version?: number;
  /** Free-form partial — keys map onto `UserConfig` fields. */
  [key: string]: unknown;
}

/** Default answer-file location, overridable via env.
 *
 *  FU2 (PLAN-config-unification-monad-root-2026-05-10 closing follow-up):
 *  moved from ~/.config/monad/setup-answers.json → ~/.monad/setup-answers.json.
 *  XDG_CONFIG_HOME explicit honors legacy path (Phase 6 deprecation). */
export function defaultAnswerFilePath(): string {
  const env = process.env.MONAD_SETUP_ANSWERS;
  if (env && env.trim().length > 0) return env;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim().length > 0) return join(xdg, 'monad', 'setup-answers.json');
  migrateLegacyXdgFile('setup-answers.json', 0o600);
  return join(homedir(), '.monad', 'setup-answers.json');
}

/** Load an answer file. An absent implicit default returns `{}` so the
 *  wizard can fall through to defaults + interactive prompts. An explicit
 *  file must be readable and contain a JSON object.
 *  `path` defaults to `defaultAnswerFilePath()`. */
export function loadAnswerFile(path?: string): AnswerFile {
  const target = path ?? defaultAnswerFilePath();
  let raw: string;
  try {
    raw = readFileSync(target, 'utf8');
  } catch (error) {
    if (path === undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new Error(`Failed to read answer file ${target}`, { cause: error });
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AnswerFile;
    }
    throw new Error('expected a JSON object');
  } catch (error) {
    throw new Error(`Failed to parse answer file ${target}`, { cause: error });
  }
}

/** Save an answer file. Creates parent directory + writes pretty-
 *  printed JSON (2-space indent, newline-terminated). Ownership +
 *  perm bits stay at OS defaults — the wizard's `chmod 600` step
 *  (Bundle 2' from the setup-ergonomics arc) is applied separately
 *  to `config.json`, NOT this answer file (which often gets checked
 *  into a dotfile repo). */
export function saveAnswerFile(answers: AnswerFile, path?: string): string {
  const target = path ?? defaultAnswerFilePath();
  mkdirSync(dirname(target), { recursive: true });
  const body = JSON.stringify(answers, null, 2) + '\n';
  writeFileSync(target, body, 'utf8');
  return target;
}
